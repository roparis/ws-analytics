import type { SourceFile } from "@/lib/merge";
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
const DB_VERSION = 1;
const SOURCES = "sources";
const META = "meta";
const ORDER_KEY = "order";

interface StoredSource {
	fileName: string;
	rawText: string;
	activities: Activity[];
	parserVersion: number;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(SOURCES)) {
				db.createObjectStore(SOURCES, { keyPath: "fileName" });
			}
			if (!db.objectStoreNames.contains(META)) {
				db.createObjectStore(META, { keyPath: "key" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
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

export async function clearStorage(): Promise<void> {
	const db = await openDb();
	try {
		const tx = db.transaction([SOURCES, META], "readwrite");
		tx.objectStore(SOURCES).clear();
		tx.objectStore(META).clear();
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
