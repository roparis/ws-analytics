"use client";

import { AlertTriangle, Files, Trash2 } from "lucide-react";
import Link from "next/link";
import { CsvUploader } from "@/components/csv-uploader";
import { Button } from "@/components/ui/button";
import { useDatasetStore } from "@/stores/dataset";

interface DataSourceCardProps {
	/** Row of controls for the mobile header, where the card doesn't fit. */
	compact?: boolean;
}

/**
 * The one place the app talks about files. Every page reads from the same
 * merged dataset, so repeating the file list on each of them was noise —
 * this card carries the summary and is the only route into `/merge`.
 */
export function DataSourceCard({ compact = false }: DataSourceCardProps) {
	const dataset = useDatasetStore((state) => state.dataset);
	const clear = useDatasetStore((state) => state.clear);

	// Nothing loaded yet: the page itself is the dropzone, so all this needs
	// to offer is the file picker.
	if (!dataset) return <CsvUploader compact />;

	const conflicts = dataset.sources.filter(
		(source) => source.confidence === "low",
	).length;
	const skipped = dataset.sources.reduce(
		(total, source) => total + source.rowsSkipped,
		0,
	);

	const clearButton = (
		<Button
			aria-label="Clear data"
			onClick={clear}
			size="icon-sm"
			title="Removes these files from this device, including the copy saved in your browser"
			variant="ghost"
		>
			<Trash2 className="size-4" />
		</Button>
	);

	if (compact) {
		return (
			<div className="flex items-center gap-1">
				<Button
					nativeButton={false}
					render={
						<Link href="/merge">
							<Files className="size-4" />
							{dataset.sources.length}
							{conflicts > 0 && (
								<AlertTriangle className="size-3.5 text-destructive" />
							)}
						</Link>
					}
					size="sm"
					variant="ghost"
				/>
				<CsvUploader compact />
				{clearButton}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2 rounded-3xl border bg-muted/50 p-3">
			<Link
				className="flex flex-col gap-0.5 px-1 text-muted-foreground transition-colors hover:text-foreground"
				href="/merge"
			>
				<span className="truncate font-medium text-foreground text-sm">
					{dataset.fileName}
				</span>
				<span className="text-xs">
					{dataset.activities.length.toLocaleString()} activities ·{" "}
					{dataset.accounts.length} accounts
				</span>
				{conflicts > 0 ? (
					<span className="flex items-start gap-1 pt-0.5 text-destructive text-xs">
						<AlertTriangle className="mt-0.5 size-3 shrink-0" />
						{conflicts} file{conflicts === 1 ? "" : "s"} disagree with an
						earlier file
					</span>
				) : (
					skipped > 0 && (
						<span className="pt-0.5 text-xs">
							{skipped.toLocaleString()} duplicate rows skipped
						</span>
					)
				)}
			</Link>
			<div className="flex items-center gap-1">
				<CsvUploader className="flex-1 cursor-pointer" compact />
				{clearButton}
			</div>
		</div>
	);
}
