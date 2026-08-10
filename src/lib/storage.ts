import type { SourceFile } from "@/lib/merge";
import type { PriceSnapshot } from "@/lib/price-snapshot";
import {
	type Activity,
	PARSER_VERSION,
	parseActivities,
} from "@/lib/wealthsimple";

/**
 * Activity history lives in IndexedDB rather than localStorage: ten years of
 * exports serialize to roughly 6 MB, well past the 5 MB localStorage cap, and
 * localStorage writes would block the main thread. SQLite/WASM would buy
 * indexed querying the app never needs — filtering the whole set costs well
 * under a millisecond in plain JS.
 */

const DB_NAME = "ws-analytics";
const SOURCES = "sources";
const META = "meta";
const PRICES = "prices";
const ORDER_KEY = "order";
const SNAPSHOT_KEY = "snapshot";

interface StoredSource {
	fileName: string;
	rawText: string;
	activities: Activity[];
	parserVersion: number;
}

const STORES = [
	{ name: SOURCES, keyPath: "fileName" },
	{ name: META, keyPath: "key" },
	{ name: PRICES, keyPath: "key" },
] as const;

function openAt(version?: number): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request =
			version === undefined
				? indexedDB.open(DB_NAME)
				: indexedDB.open(DB_NAME, version);

		// Each store is created only if absent, so a version bump adds the new
		// one and leaves an existing database's activity history untouched.
		request.onupgradeneeded = () => {
			const db = request.result;
			for (const store of STORES) {
				if (!db.objectStoreNames.contains(store.name)) {
					db.createObjectStore(store.name, { keyPath: store.keyPath });
				}
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		request.onblocked = () =>
			reject(new Error("Another tab is holding the database open."));
	});
}

/**
 * Brings the database up to the schema above, once per page load.
 *
 * Deliberately not driven by a hard-coded version constant. Two things go wrong
 * with one: `onupgradeneeded` fires only when the version *changes*, so a build
 * that shipped a bumped number without the store that justified it leaves a
 * database stamped "current" and permanently missing a store; and opening at a
 * fixed version fails outright against a database that has since gone higher.
 * Asking what is actually there avoids both.
 *
 * An unversioned open creates a brand-new database at version 1 and runs the
 * upgrade handler, so a first visit gets every store without special-casing.
 */
async function ensureSchema(): Promise<void> {
	const db = await openAt();
	const missing = STORES.filter(
		(store) => !db.objectStoreNames.contains(store.name),
	);
	const version = db.version;
	db.close();

	if (missing.length === 0) return;

	// One version up from whatever this database is on, which is the only way
	// to get an upgrade transaction and therefore the only way to add a store.
	const upgraded = await openAt(version + 1);
	upgraded.close();
}

/**
 * Shared across callers so the schema check happens once. Both stores hydrate
 * on mount, and two concurrent version-change opens would block each other —
 * one would win and the other would reject, taking a page's data with it.
 */
let schemaReady: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (!schemaReady) {
		// A failed check isn't cached: the next call gets to try again rather
		// than the app staying broken for the rest of the session.
		schemaReady = ensureSchema().catch((error) => {
			schemaReady = null;
			throw error;
		});
	}

	// Unversioned, so it opens whatever `ensureSchema` settled on and can never
	// trigger an upgrade of its own.
	return schemaReady.then(() => openAt());
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

function toArray<T>(request: IDBRequest<T[]>): Promise<T[]> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function readValue<T>(request: IDBRequest<T>): Promise<T | undefined> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/**
 * Returns persisted sources in priority order. Anything parsed by an older
 * parser is re-derived from its stored raw text; `reparsed` reports how many so
 * the caller can re-persist the refreshed rows.
 */
export async function loadSources(): Promise<{
	sources: SourceFile[];
	reparsed: number;
}> {
	const db = await openDb();
	try {
		const tx = db.transaction([SOURCES, META], "readonly");
		const stored = await toArray<StoredSource>(
			tx.objectStore(SOURCES).getAll(),
		);
		const meta = await readValue<{ key: string; fileNames: string[] }>(
			tx.objectStore(META).get(ORDER_KEY),
		);

		if (stored.length === 0) return { sources: [], reparsed: 0 };

		const order = meta?.fileNames ?? [];
		const byName = new Map(stored.map((entry) => [entry.fileName, entry]));
		const ordered = [
			...order.flatMap((name) => byName.get(name) ?? []),
			// Anything missing from the order list (interrupted write) goes last.
			...stored.filter((entry) => !order.includes(entry.fileName)),
		];

		let reparsed = 0;
		const sources: SourceFile[] = [];
		for (const entry of ordered) {
			if (entry.parserVersion === PARSER_VERSION) {
				sources.push({
					fileName: entry.fileName,
					rawText: entry.rawText,
					activities: entry.activities,
				});
				continue;
			}
			try {
				sources.push(await parseActivities(entry.rawText, entry.fileName));
				reparsed++;
			} catch {
				// A file that no longer parses is dropped rather than blocking startup.
			}
		}

		return { sources, reparsed };
	} finally {
		db.close();
	}
}

export async function saveSources(sources: SourceFile[]): Promise<void> {
	const db = await openDb();
	try {
		const tx = db.transaction([SOURCES, META], "readwrite");
		const store = tx.objectStore(SOURCES);
		store.clear();
		for (const source of sources) {
			store.put({
				fileName: source.fileName,
				rawText: source.rawText,
				activities: source.activities,
				parserVersion: PARSER_VERSION,
			} satisfies StoredSource);
		}
		tx.objectStore(META).put({
			key: ORDER_KEY,
			fileNames: sources.map((source) => source.fileName),
		});
		await done(tx);
	} finally {
		db.close();
	}
}

/** Reorder only — avoids rewriting megabytes of rows to move one row up. */
export async function saveOrder(fileNames: string[]): Promise<void> {
	const db = await openDb();
	try {
		const tx = db.transaction(META, "readwrite");
		tx.objectStore(META).put({ key: ORDER_KEY, fileNames });
		await done(tx);
	} finally {
		db.close();
	}
}

/**
 * The most recent price snapshot, or null if none has been imported.
 *
 * A single record rather than a history: the app values holdings as of now, and
 * keeping every sheet anyone ever dropped in would only raise the question of
 * which one is live.
 */
export async function loadPriceSnapshot(): Promise<PriceSnapshot | null> {
	const db = await openDb();
	try {
		const tx = db.transaction(PRICES, "readonly");
		const stored = await readValue<{ key: string; snapshot: PriceSnapshot }>(
			tx.objectStore(PRICES).get(SNAPSHOT_KEY),
		);
		return stored?.snapshot ?? null;
	} finally {
		db.close();
	}
}

export async function savePriceSnapshot(
	snapshot: PriceSnapshot | null,
): Promise<void> {
	const db = await openDb();
	try {
		const tx = db.transaction(PRICES, "readwrite");
		if (snapshot) {
			tx.objectStore(PRICES).put({ key: SNAPSHOT_KEY, snapshot });
		} else {
			tx.objectStore(PRICES).delete(SNAPSHOT_KEY);
		}
		await done(tx);
	} finally {
		db.close();
	}
}

export async function clearStorage(): Promise<void> {
	const db = await openDb();
	try {
		const tx = db.transaction([SOURCES, META, PRICES], "readwrite");
		tx.objectStore(SOURCES).clear();
		tx.objectStore(META).clear();
		// Prices describe the holdings in those files; keeping them after a
		// "clear data" would leave the app valuing a portfolio it no longer has.
		tx.objectStore(PRICES).clear();
		await done(tx);
	} finally {
		db.close();
	}
}

export async function estimateUsage(): Promise<number | null> {
	if (!navigator.storage?.estimate) return null;
	const { usage } = await navigator.storage.estimate();
	return usage ?? null;
}
