"use client";

import { SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { ConfidenceTag } from "@/components/confidence-tag";
import { Button } from "@/components/ui/button";
import type { SourceSummary } from "@/lib/merge";
import { formatDate } from "@/lib/metrics";
import { useDatasetStore } from "@/stores/dataset";

interface SourcesPanelProps {
	sources: SourceSummary[];
}

export function SourcesPanel({ sources }: SourcesPanelProps) {
	const removeSource = useDatasetStore((state) => state.removeSource);

	if (sources.length <= 1) return null;

	const overlapping = sources.filter((source) => source.rowsSkipped > 0);

	return (
		<div className="flex flex-col gap-2 rounded-3xl bg-muted/40 p-4">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span className="text-muted-foreground text-xs">
					Sources ({sources.length})
				</span>
				{overlapping.length > 0 && (
					<span className="text-muted-foreground text-xs">
						·{" "}
						{overlapping
							.reduce((total, source) => total + source.rowsSkipped, 0)
							.toLocaleString()}{" "}
						rows skipped as already covered by an earlier file
					</span>
				)}
				<Button
					className="ml-auto"
					nativeButton={false}
					render={
						<Link href="/merge">
							<SlidersHorizontal className="size-3" />
							Manage merge
						</Link>
					}
					size="xs"
					variant="outline"
				/>
			</div>
			<ul className="flex flex-col gap-1">
				{sources.map((source) => (
					<li
						className="flex items-center justify-between gap-3 text-sm"
						key={source.fileName}
					>
						<span className="min-w-0 flex-1 truncate">{source.fileName}</span>
						<ConfidenceTag
							confidence={source.confidence}
							title={source.confidenceReason}
						/>
						<span className="whitespace-nowrap text-muted-foreground text-xs">
							{formatDate(source.dateRange.start)} –{" "}
							{formatDate(source.dateRange.end)} ·{" "}
							{source.rowsUsed.toLocaleString()} used
							{source.rowsSkipped > 0
								? ` · ${source.rowsSkipped.toLocaleString()} skipped`
								: ""}
						</span>
						<Button
							aria-label={`Remove ${source.fileName}`}
							onClick={() => removeSource(source.fileName)}
							size="icon-xs"
							variant="ghost"
						>
							<X className="size-3" />
						</Button>
					</li>
				))}
			</ul>
		</div>
	);
}
