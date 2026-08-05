"use client";

import type { ReactNode } from "react";
import { CsvUploader } from "@/components/csv-uploader";
import { Skeleton } from "@/components/ui/skeleton";
import { useDatasetStore } from "@/stores/dataset";

/**
 * Shared gate for every data-backed route: skeleton until IndexedDB has been
 * read, the uploader when nothing is loaded, the page otherwise. Hydration
 * itself runs once app-wide in `StoreHydrator`.
 */
export function RequireDataset({ children }: { children: ReactNode }) {
	const dataset = useDatasetStore((state) => state.dataset);
	const hydrated = useDatasetStore((state) => state.hydrated);

	if (!hydrated) {
		return (
			<div className="flex flex-1 flex-col gap-4 py-6">
				<Skeleton className="h-10 w-48 rounded-3xl" />
				<Skeleton className="h-40 w-full rounded-4xl" />
				<Skeleton className="h-40 w-full rounded-4xl" />
			</div>
		);
	}

	if (!dataset) {
		return (
			<div className="flex flex-1 flex-col py-6">
				<CsvUploader />
			</div>
		);
	}

	return <>{children}</>;
}
