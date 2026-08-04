import { create } from "zustand";
import { type MergedDataset, mergeSources, type SourceFile } from "@/lib/merge";
import {
	clearStorage,
	loadSources,
	saveOrder,
	saveSources,
} from "@/lib/storage";

interface DatasetState {
	/** Raw per-file activities, in the order added — earlier files win overlaps. */
	sources: SourceFile[];
	/** Derived from `sources`; recomputed on every mutation. */
	dataset: MergedDataset | null;
	/** False until IndexedDB has been read, so the UI can avoid flashing empty. */
	hydrated: boolean;
	hydrate: () => Promise<void>;
	addSources: (sources: SourceFile[]) => void;
	removeSource: (fileName: string) => void;
	/** Priority is order — moving a file up makes it win more overlaps. */
	moveSource: (fileName: string, direction: "up" | "down") => void;
	clear: () => void;
}

function withSources(sources: SourceFile[]) {
	return { sources, dataset: mergeSources(sources) };
}

// Persistence is best-effort: private browsing and quota limits shouldn't take
// the app down, so failures are logged and the in-memory session continues.
function persist(promise: Promise<unknown>) {
	promise.catch((error) => {
		console.warn("Could not save to local storage:", error);
	});
}

export const useDatasetStore = create<DatasetState>((set, get) => ({
	sources: [],
	dataset: null,
	hydrated: false,
	hydrate: async () => {
		if (get().hydrated) return;
		try {
			const { sources, reparsed } = await loadSources();
			set({ ...withSources(sources), hydrated: true });
			// Rows re-derived under a newer parser are written back so the next
			// load is a straight read.
			if (reparsed > 0) persist(saveSources(sources));
		} catch (error) {
			console.warn("Could not read local storage:", error);
			set({ hydrated: true });
		}
	},
	addSources: (incoming) =>
		set((state) => {
			// File name is the source identity, so collapse repeats within the batch
			// as well as against what is already loaded — re-adding a file replaces
			// it rather than double-counting, and never yields two sources with the
			// same name.
			const deduped = [
				...new Map(
					incoming.map((source) => [source.fileName, source]),
				).values(),
			];
			const names = new Set(deduped.map((source) => source.fileName));
			const kept = state.sources.filter(
				(source) => !names.has(source.fileName),
			);
			const next = [...kept, ...deduped];
			persist(saveSources(next));
			return withSources(next);
		}),
	removeSource: (fileName) =>
		set((state) => {
			const next = state.sources.filter(
				(source) => source.fileName !== fileName,
			);
			persist(saveSources(next));
			return withSources(next);
		}),
	moveSource: (fileName, direction) =>
		set((state) => {
			const index = state.sources.findIndex(
				(source) => source.fileName === fileName,
			);
			const target = direction === "up" ? index - 1 : index + 1;
			if (index === -1 || target < 0 || target >= state.sources.length) {
				return state;
			}
			const next = [...state.sources];
			[next[index], next[target]] = [next[target], next[index]];
			// Only the order changed, so skip rewriting every row.
			persist(saveOrder(next.map((source) => source.fileName)));
			return withSources(next);
		}),
	clear: () => {
		persist(clearStorage());
		set({ sources: [], dataset: null });
	},
}));
