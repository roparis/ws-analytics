import type { Page } from "@playwright/test";

/**
 * These helpers know `src/lib/storage.ts`'s IndexedDB schema directly —
 * `DB_NAME`, the store names, and the stored-source shape are hard-coded
 * below rather than imported, because this code runs inside the browser via
 * `page.evaluate` and can't reach into the app's module graph. That coupling
 * is deliberate: if `storage.ts` grows a migration or renames a store, these
 * tests should fail loudly rather than silently stop covering anything.
 */

const DB_NAME = "ws-analytics";
const SOURCES = "sources";
const META = "meta";
const PRICES = "prices";
const ORDER_KEY = "order";

/**
 * Matches `PARSER_VERSION` in `src/lib/wealthsimple.ts` (currently `2`). Not
 * imported, for the same reason as the schema constants above. `data-loss.spec.ts`
 * exists specifically to catch this kind of drift — if a future change bumps
 * `PARSER_VERSION` without this constant following it, the "valid" seeded
 * source starts looking stale and that spec starts failing, which is exactly
 * the signal wanted.
 */
export const CURRENT_PARSER_VERSION = 2;

/** Mirrors `Activity` in `src/lib/wealthsimple.ts`. Duplicated rather than
 * imported for the same browser/Node boundary reason as above. */
export interface SeedActivity {
	transactionDate: string;
	effectiveAt: string | null;
	settlementDate: string | null;
	accountId: string;
	accountType: string;
	activityType: string;
	activitySubType: string | null;
	description: string;
	symbol: string | null;
	name: string | null;
	currency: string;
	quantity: number | null;
	unitPrice: number | null;
	commission: number | null;
	netCashAmount: number;
}

/** Mirrors `StoredSource` in `src/lib/storage.ts`. */
export interface SeedSource {
	fileName: string;
	rawText: string;
	activities: SeedActivity[];
	parserVersion: number;
}

/**
 * Deletes the whole database. Belt-and-suspenders on top of Playwright's
 * default per-test browser context, which already starts from empty storage
 * — this makes the "clean origin" requirement explicit and keeps the specs
 * correct even if a future config change starts reusing storage state across
 * tests.
 */
export async function clearDatabase(page: Page): Promise<void> {
	await page.evaluate((dbName) => {
		return new Promise<void>((resolve, reject) => {
			const request = indexedDB.deleteDatabase(dbName);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
			// No open connection should exist in a fresh context, but resolve
			// rather than hang if one somehow does.
			request.onblocked = () => resolve();
		});
	}, DB_NAME);
}

/**
 * Writes `sources` records and the `meta` order record straight into
 * IndexedDB, bypassing the app entirely. Must run against a page that hasn't
 * hydrated yet — see `gotoWithoutHydrating` below — otherwise this races
 * `StoreHydrator`'s own read.
 *
 * This is the technique that makes the stale-`parserVersion` precondition in
 * `data-loss.spec.ts` testable at all: the app has no code path that
 * produces that state without shipping two builds.
 */
export async function seedSources(
	page: Page,
	sources: SeedSource[],
	order: string[],
): Promise<void> {
	await page.evaluate(
		({
			dbName,
			storesName,
			metaName,
			pricesName,
			orderKey,
			sources,
			order,
		}) => {
			return new Promise<void>((resolve, reject) => {
				const openRequest = indexedDB.open(dbName, 1);
				openRequest.onupgradeneeded = () => {
					const db = openRequest.result;
					if (!db.objectStoreNames.contains(storesName)) {
						db.createObjectStore(storesName, { keyPath: "fileName" });
					}
					if (!db.objectStoreNames.contains(metaName)) {
						db.createObjectStore(metaName, { keyPath: "key" });
					}
					if (!db.objectStoreNames.contains(pricesName)) {
						db.createObjectStore(pricesName, { keyPath: "key" });
					}
				};
				openRequest.onsuccess = () => {
					const db = openRequest.result;
					const tx = db.transaction([storesName, metaName], "readwrite");
					for (const source of sources) tx.objectStore(storesName).put(source);
					tx.objectStore(metaName).put({ key: orderKey, fileNames: order });
					tx.oncomplete = () => {
						db.close();
						resolve();
					};
					tx.onerror = () => reject(tx.error);
				};
				openRequest.onerror = () => reject(openRequest.error);
			});
		},
		{
			dbName: DB_NAME,
			storesName: SOURCES,
			metaName: META,
			pricesName: PRICES,
			orderKey: ORDER_KEY,
			sources,
			order,
		},
	);
}

/** Reads the `sources` store back. Used to assert what actually survived —
 * both bugs this plan covers were invisible on screen while the database was
 * wrong, so the UI alone never proves either fix. */
export async function readStoredSources(page: Page): Promise<SeedSource[]> {
	return page.evaluate(
		({ dbName, storesName }) => {
			return new Promise<SeedSource[]>((resolve, reject) => {
				const request = indexedDB.open(dbName);
				request.onsuccess = () => {
					const db = request.result;
					const tx = db.transaction(storesName, "readonly");
					const getAll = tx.objectStore(storesName).getAll();
					getAll.onsuccess = () => {
						db.close();
						resolve(getAll.result);
					};
					getAll.onerror = () => reject(getAll.error);
				};
				request.onerror = () => reject(request.error);
			});
		},
		{ dbName: DB_NAME, storesName: SOURCES },
	);
}

/** Reads the `meta` store's `order` record back. */
export async function readStoredOrder(page: Page): Promise<string[]> {
	return page.evaluate(
		({ dbName, metaName, orderKey }) => {
			return new Promise<string[]>((resolve, reject) => {
				const request = indexedDB.open(dbName);
				request.onsuccess = () => {
					const db = request.result;
					const tx = db.transaction(metaName, "readonly");
					const get = tx.objectStore(metaName).get(orderKey);
					get.onsuccess = () => {
						db.close();
						resolve(get.result?.fileNames ?? []);
					};
					get.onerror = () => reject(get.error);
				};
				request.onerror = () => reject(request.error);
			});
		},
		{ dbName: DB_NAME, metaName: META, orderKey: ORDER_KEY },
	);
}

/**
 * Navigates to `path` with every `_next/*` request aborted, so none of the
 * app's own JavaScript ever runs — no hydration, no `StoreHydrator` effect,
 * nothing touching IndexedDB. The document itself still loads (it isn't
 * under `_next/`), which is enough for `page.evaluate` — that runs over CDP,
 * independent of whether the page's own `<script>` tags executed.
 *
 * This is what lets `seedSources` write a precondition without racing the
 * app for it. Pair with `unblockAndReload` once seeding is done.
 */
export async function gotoWithoutHydrating(
	page: Page,
	path = "/",
): Promise<void> {
	await page.route("**/_next/**", (route) => route.abort());
	await page.goto(path);
}

/** Undoes `gotoWithoutHydrating`'s network block and reloads, so the app's
 * real JavaScript runs against whatever was seeded in the meantime. */
export async function unblockAndReload(page: Page): Promise<void> {
	await page.unroute("**/_next/**");
	await page.reload();
}

/**
 * Wraps `indexedDB.open` so the *result* of every open — the point at which
 * `storage.ts`'s callers see their data — is held back until the test calls
 * `releaseIndexedDbOpen`. `onupgradeneeded` still fires immediately (schema
 * creation can't be delayed without corrupting the database); only
 * `onsuccess`/`onerror`/`onblocked` wait on the gate.
 *
 * Must be installed with `page.addInitScript` *before* the navigation whose
 * read should be delayed — it re-applies on every subsequent navigation of
 * this page, so use a fresh `page` (new browser context, e.g. via
 * `context.newPage()`) for anything after the delayed read that should
 * proceed at normal speed.
 *
 * Trade-off worth being explicit about: this instruments the *environment*
 * (how long an IndexedDB open takes) rather than the app. That's acceptable
 * here — the instrumentation is a delay, not a behaviour change — but it's
 * exactly the kind of thing a reader should be able to spot at a glance,
 * hence this comment.
 */
export async function installIndexedDbOpenDelay(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const nativeOpen = indexedDB.open.bind(indexedDB);
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		// Exposed so the test can choose exactly when the delayed read
		// completes — a controlled gate, not a guessed timeout.
		(window as unknown as Record<string, unknown>).__e2eReleaseIndexedDbOpen =
			release;

		Object.defineProperty(indexedDB, "open", {
			value: (...args: Parameters<typeof indexedDB.open>) => {
				const real = nativeOpen(...args);
				// Handlers the app assigns (`request.onsuccess = ...`, etc.) are
				// captured here instead of being wired to the real request, so we
				// control exactly when they fire.
				const handlers: Record<string, ((event: Event) => void) | null> = {
					onsuccess: null,
					onupgradeneeded: null,
					onerror: null,
					onblocked: null,
				};

				const proxy = new Proxy(real, {
					set(target, prop, value) {
						if (typeof prop === "string" && prop in handlers) {
							handlers[prop] = value;
							return true;
						}
						(target as unknown as Record<string, unknown>)[prop as string] =
							value;
						return true;
					},
					get(target, prop) {
						if (typeof prop === "string" && prop in handlers) {
							return handlers[prop];
						}
						const value = (target as unknown as Record<string, unknown>)[
							prop as string
						];
						return typeof value === "function" ? value.bind(target) : value;
					},
				});

				real.addEventListener("upgradeneeded", (event) => {
					handlers.onupgradeneeded?.(event);
				});
				real.addEventListener("success", (event) => {
					void gate.then(() => handlers.onsuccess?.(event));
				});
				real.addEventListener("error", (event) => {
					void gate.then(() => handlers.onerror?.(event));
				});
				real.addEventListener("blocked", (event) => {
					void gate.then(() => handlers.onblocked?.(event));
				});

				return proxy;
			},
		});
	});
}

/** Releases the gate installed by `installIndexedDbOpenDelay`, letting any
 * pending and future `indexedDB.open` calls on this page complete. */
export async function releaseIndexedDbOpen(page: Page): Promise<void> {
	await page.evaluate(() => {
		(
			window as unknown as { __e2eReleaseIndexedDbOpen?: () => void }
		).__e2eReleaseIndexedDbOpen?.();
	});
}
