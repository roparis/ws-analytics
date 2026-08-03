"use client";

import { CsvUploader } from "@/components/csv-uploader";
import { Dashboard } from "@/components/dashboard";
import { useDatasetStore } from "@/stores/dataset";

export function DatasetWorkspace() {
	const dataset = useDatasetStore((state) => state.dataset);

	return dataset ? <Dashboard /> : <CsvUploader />;
}
