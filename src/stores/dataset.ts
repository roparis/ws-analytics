import { create } from "zustand";
import type { ParsedDataset } from "@/lib/csv";

interface DatasetState {
	dataset: ParsedDataset | null;
	setDataset: (dataset: ParsedDataset) => void;
	reset: () => void;
}

export const useDatasetStore = create<DatasetState>((set) => ({
	dataset: null,
	setDataset: (dataset) => set({ dataset }),
	reset: () => set({ dataset: null }),
}));
