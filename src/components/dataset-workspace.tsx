"use client";

import { useEffect } from "react";
import { CsvUploader } from "@/components/csv-uploader";
import { Dashboard } from "@/components/dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { useDatasetStore } from "@/stores/dataset";

export function DatasetWorkspace() {
	const dataset = useDatasetStore((state) => state.dataset);
	const hydrated = useDatasetStore((state) => state.hydrated);
	const hydrate = useDatasetStore((state) => state.hydrate);

	useEffect(() => {
		void hydrate();
	}, [hydrate]);

	// Avoids flashing the uploader before saved files are read back.
	if (!hydrated) {
		return (
			<div className="flex flex-1 flex-col gap-6">
				<Skeleton className="h-16 w-full rounded-3xl" />
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{["a", "b", "c", "d"].map((key) => (
						<Skeleton className="h-32 rounded-4xl" key={key} />
					))}
				</div>
				<Skeleton className="h-72 w-full rounded-4xl" />
			</div>
		);
	}

	return dataset ? <Dashboard /> : <CsvUploader />;
}
