"use client";

import { RotateCcw } from "lucide-react";
import { useRef } from "react";
import { DatasetChart } from "@/components/charts/dataset-chart";
import { DataTable } from "@/components/data-table";
import { PdfExportButton } from "@/components/pdf-export-button";
import { Button } from "@/components/ui/button";
import { useDatasetStore } from "@/stores/dataset";

export function Dashboard() {
	const dataset = useDatasetStore((state) => state.dataset);
	const reset = useDatasetStore((state) => state.reset);
	const reportRef = useRef<HTMLDivElement>(null);

	if (!dataset) return null;

	return (
		<div className="flex flex-1 flex-col gap-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-semibold text-lg">{dataset.fileName}</h1>
					<p className="text-muted-foreground text-sm">
						{dataset.rows.length} rows · {dataset.columns.length} columns
					</p>
				</div>
				<div className="flex gap-2">
					<Button onClick={reset} variant="ghost">
						<RotateCcw className="size-4" />
						Load another file
					</Button>
					<PdfExportButton
						filename={`${dataset.fileName.replace(/\.csv$/i, "")}-report.pdf`}
						targetRef={reportRef}
					/>
				</div>
			</div>

			<div className="flex flex-col gap-6 bg-background" ref={reportRef}>
				<DatasetChart columns={dataset.columns} rows={dataset.rows} />
				<DataTable columns={dataset.columns} rows={dataset.rows} />
			</div>
		</div>
	);
}
