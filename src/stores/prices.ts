"use client";

import { create } from "zustand";
import type { PriceHistory } from "@/lib/price-history";
import type { PriceSnapshot } from "@/lib/price-snapshot";
import {
	loadPriceHistory,
	loadPriceSnapshot,
	savePriceHistory,
	savePriceSnapshot,
} from "@/lib/storage";

/**
 * The imported price snapshot and the monthly history behind it, kept beside
 * the dataset rather than inside it.
 *
 * They have different lifetimes: activity files are the record and change when
 * you export again, while prices go stale in days and are replaced wholesale.
 * Folding them together would mean re-merging megabytes of rows every time
 * someone refreshed a quote.
 *
 * Snapshot and history are two fields for the same reason: a quote is one fast
 * request and a history is one request per holding, so the pages that only need
 * today's value should never wait on the years behind it.
 */

interface PriceState {
	snapshot: PriceSnapshot | null;
	/** Monthly closes for the years the export covers. Null until fetched. */
	history: PriceHistory | null;
	/** False until IndexedDB has been read, so the UI can avoid flashing empty. */
	hydrated: boolean;
	/** Set when the snapshot couldn't be written — it won't survive a reload. */
	persistFailed: boolean;
	hydrate: () => Promise<void>;
	setSnapshot: (snapshot: PriceSnapshot) => void;
	setHistory: (history: PriceHistory) => void;
	clear: () => void;
	/**
	 * Drops the snapshot from memory without writing. For callers that have
	 * already wiped the database themselves — `clearStorage` takes the prices
	 * with it, and a second delete would race the first.
	 */
	reset: () => void;
}

export const usePriceStore = create<PriceState>((set, get) => ({
	snapshot: null,
	history: null,
	hydrated: false,
	persistFailed: false,

	hydrate: async () => {
		if (get().hydrated) return;
		try {
			const [snapshot, history] = await Promise.all([
				loadPriceSnapshot(),
				loadPriceHistory(),
			]);
			set({ hydrated: true, history, snapshot });
		} catch {
			// A refused or corrupt database shouldn't stop the app loading; the
			// page falls back to book cost, which is what it did before.
			set({ hydrated: true, history: null, snapshot: null });
		}
	},

	setSnapshot: (snapshot) => {
		set({ snapshot });
		// The write is best-effort, as it is in `dataset.ts` — the session keeps
		// working either way. But it is *reported*: swallowing the error would
		// leave someone believing their prices are saved when they will be gone
		// on reload, which is worse than losing them loudly.
		void savePriceSnapshot(snapshot).catch((error) => {
			console.warn("Could not save prices to local storage:", error);
			set({ persistFailed: true });
		});
	},

	setHistory: (history) => {
		set({ history });
		void savePriceHistory(history).catch((error) => {
			console.warn("Could not save price history to local storage:", error);
			set({ persistFailed: true });
		});
	},

	clear: () => {
		set({ history: null, persistFailed: false, snapshot: null });
		void savePriceSnapshot(null).catch((error) => {
			console.warn("Could not clear stored prices:", error);
		});
		void savePriceHistory(null).catch((error) => {
			console.warn("Could not clear stored price history:", error);
		});
	},

	reset: () => {
		set({ history: null, persistFailed: false, snapshot: null });
	},
}));
