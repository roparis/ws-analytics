"use client";

import { ArrowLeft, ChevronDown, ChevronUp, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ConfidenceTag } from "@/components/confidence-tag";
import { CoverageBar, sourceColor } from "@/components/coverage-bar";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { analyzeMerge, type CoverageSegment } from "@/lib/merge";
import { formatCurrency, formatDate } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { Activity } from "@/lib/wealthsimple";
import { useDatasetStore } from "@/stores/dataset";

// Static: these rows are read-only and never re-render against new props.
const SKIPPED_COLUMNS: DataTableColumn<Activity>[] = [
	{
		key: "transactionDate",
		header: "Date",
		sortValue: (row) => row.transactionDate,
		cell: (row) => formatDate(row.transactionDate),
	},
	{
		key: "accountType",
		header: "Account",
		sortValue: (row) => row.accountType,
		cell: (row) => row.accountType,
	},
	{
		key: "activityType",
		header: "Activity",
		sortValue: (row) => row.activityType,
		cell: (row) => row.activityType,
	},
	{
		key: "description",
		header: "Description",
		className: "whitespace-normal",
		cell: (row) => (
			<span className="line-clamp-1 text-muted-foreground">
				{row.description}
			</span>
		),
	},
	{
		key: "netCashAmount",
		header: "Amount",
		align: "right",
		sortValue: (row) => row.netCashAmount,
		cell: (row) => (
			<span
				className={cn(
					"tabular-nums",
					row.netCashAmount < 0 && "text-destructive",
				)}
			>
				{formatCurrency(row.netCashAmount, row.currency)}
			</span>
		),
	},
];

export default function MergePage() {
	const sources = useDatasetStore((state) => state.sources);
	const hydrated = useDatasetStore((state) => state.hydrated);
	const moveSource = useDatasetStore((state) => state.moveSource);
	const removeSource = useDatasetStore((state) => state.removeSource);
	const [expanded, setExpanded] = useState<string | null>(null);

	const analysis = useMemo(() => analyzeMerge(sources), [sources]);

	if (!hydrated) {
		return (
			<div className="flex flex-1 flex-col gap-4">
				<Skeleton className="h-12 w-64 rounded-3xl" />
				<Skeleton className="h-56 w-full rounded-4xl" />
			</div>
		);
	}

	if (sources.length === 0) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
				<p className="text-muted-foreground text-sm">No files loaded yet.</p>
				<Button
					nativeButton={false}
					render={<Link href="/">Load a file</Link>}
				/>
			</div>
		);
	}

	// One row per account, showing which source owns which slice of its history.
	const accounts = new Map<
		string,
		{
			accountType: string;
			segments: (CoverageSegment & {
				sourceIndex: number;
				fileName: string;
			})[];
		}
	>();

	analysis.summaries.forEach((summary, sourceIndex) => {
		for (const segment of summary.segments) {
			const entry = accounts.get(segment.accountId) ?? {
				accountType: segment.accountType,
				segments: [],
			};
			entry.segments.push({
				...segment,
				sourceIndex,
				fileName: summary.fileName,
			});
			accounts.set(segment.accountId, entry);
		}
	});

	const totalSkipped = analysis.summaries.reduce(
		(total, summary) => total + summary.rowsSkipped,
		0,
	);

	return (
		<main className="flex flex-1 flex-col gap-6 py-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-semibold text-lg">Merge sources</h1>
					<p className="text-muted-foreground text-sm">
						{analysis.totalRows.toLocaleString()} activities kept ·{" "}
						{totalSkipped.toLocaleString()} skipped as already covered
					</p>
				</div>
				<Button
					nativeButton={false}
					render={
						<Link href="/">
							<ArrowLeft className="size-4" />
							Back to timeline
						</Link>
					}
					variant="ghost"
				/>
			</div>

			<Card size="sm">
				<CardHeader>
					<CardTitle>Priority</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-3">
					<p className="text-muted-foreground text-xs">
						Files higher in this list win overlapping dates. Where two exports
						cover the same account and period, only the higher one contributes —
						so the same transaction is never counted twice. Move a file up to
						make it authoritative for the periods it shares with others.
					</p>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[58rem] text-sm">
							<thead>
								<tr className="border-b text-left text-muted-foreground text-xs">
									<th className="py-2 pr-3 font-normal">#</th>
									<th className="py-2 pr-3 font-normal">File</th>
									<th className="py-2 pr-3 font-normal">Covers</th>
									<th className="py-2 pr-3 font-normal">Exported</th>
									<th className="py-2 pr-3 text-right font-normal">Used</th>
									<th className="py-2 pr-3 text-right font-normal">Skipped</th>
									<th className="py-2 pr-3 font-normal">Confidence</th>
									<th className="py-2 font-normal">
										<span className="sr-only">Actions</span>
									</th>
								</tr>
							</thead>
							<tbody>
								{analysis.summaries.map((summary, index) => (
									<tr className="border-b last:border-0" key={summary.fileName}>
										<td className="py-2 pr-3 text-muted-foreground tabular-nums">
											<span className="inline-flex items-center gap-2">
												<span
													aria-hidden
													className={cn(
														"size-2.5 shrink-0 rounded-full",
														sourceColor(index),
													)}
												/>
												{index + 1}
											</span>
										</td>
										<td className="max-w-[16rem] py-2 pr-3">
											<span className="block truncate font-medium">
												{summary.fileName}
											</span>
										</td>
										<td className="whitespace-nowrap py-2 pr-3 text-muted-foreground text-xs">
											{formatDate(summary.dateRange.start)} –{" "}
											{formatDate(summary.dateRange.end)}
										</td>
										{/* The date the file says it was produced. A file with no
											footer is normal, so an em dash rather than a warning. */}
										<td className="whitespace-nowrap py-2 pr-3 text-muted-foreground text-xs">
											{summary.exportedOn
												? formatDate(summary.exportedOn)
												: "—"}
										</td>
										<td className="py-2 pr-3 text-right tabular-nums">
											{summary.rowsUsed.toLocaleString()}
										</td>
										<td
											className={cn(
												"py-2 pr-3 text-right tabular-nums",
												summary.rowsSkipped > 0 && "text-muted-foreground",
											)}
										>
											{summary.rowsSkipped.toLocaleString()}
										</td>
										<td className="py-2 pr-3">
											<ConfidenceTag
												confidence={summary.confidence}
												title={summary.confidenceReason}
											/>
										</td>
										<td className="py-2">
											<div className="flex items-center justify-end gap-1">
												{summary.rowsSkipped > 0 && (
													<Button
														onClick={() =>
															setExpanded(
																expanded === summary.fileName
																	? null
																	: summary.fileName,
															)
														}
														size="xs"
														variant="outline"
													>
														{expanded === summary.fileName ? "Hide" : "Review"}
													</Button>
												)}
												<Button
													aria-label={`Move ${summary.fileName} up`}
													disabled={index === 0}
													onClick={() => moveSource(summary.fileName, "up")}
													size="icon-xs"
													variant="ghost"
												>
													<ChevronUp className="size-3" />
												</Button>
												<Button
													aria-label={`Move ${summary.fileName} down`}
													disabled={index === analysis.summaries.length - 1}
													onClick={() => moveSource(summary.fileName, "down")}
													size="icon-xs"
													variant="ghost"
												>
													<ChevronDown className="size-3" />
												</Button>
												<Button
													aria-label={`Remove ${summary.fileName}`}
													onClick={() => removeSource(summary.fileName)}
													size="icon-xs"
													variant="ghost"
												>
													<X className="size-3" />
												</Button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{analysis.summaries.some(
						(summary) =>
							summary.confidence !== "high" || summary.problems.length > 0,
					) && (
						<ul className="flex flex-col gap-1 text-xs">
							{analysis.summaries
								.filter((summary) => summary.confidence !== "high")
								.map((summary) => (
									<li className="flex gap-2" key={summary.fileName}>
										<ConfidenceTag confidence={summary.confidence} />
										<span className="text-muted-foreground">
											{summary.fileName} — {summary.confidenceReason}
										</span>
									</li>
								))}
							{analysis.summaries
								.filter((summary) => summary.problems.length > 0)
								.map((summary) => (
									<li
										className="flex flex-col gap-1"
										key={`${summary.fileName}-problems`}
									>
										<span className="text-muted-foreground">
											{summary.fileName} — data-invariant violations:
										</span>
										<ul className="flex flex-col gap-1 pl-4">
											{summary.problems.slice(0, 20).map((problem) => (
												<li key={`${summary.fileName}-${problem}`}>
													{problem}
												</li>
											))}
											{summary.problems.length > 20 && (
												<li>…and {summary.problems.length - 20} more</li>
											)}
										</ul>
									</li>
								))}
						</ul>
					)}
				</CardContent>
			</Card>

			{accounts.size > 0 && (
				<Card size="sm">
					<CardHeader>
						<CardTitle>Coverage by account</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						<p className="text-muted-foreground text-xs">
							{formatDate(analysis.dateRange.start)} –{" "}
							{formatDate(analysis.dateRange.end)}. Each bar shows which file
							supplied which stretch of an account&apos;s history; gaps are
							periods no file covers.
						</p>
						{[...accounts.entries()]
							.sort(
								(a, b) =>
									a[1].accountType.localeCompare(b[1].accountType) ||
									a[0].localeCompare(b[0]),
							)
							.map(([accountId, entry]) => (
								<div className="flex flex-col gap-1" key={accountId}>
									<span className="text-muted-foreground text-xs">
										{entry.accountType} · {accountId}
									</span>
									<CoverageBar
										range={analysis.dateRange}
										segments={entry.segments}
									/>
								</div>
							))}
					</CardContent>
				</Card>
			)}

			{expanded && (
				<Card size="sm">
					<CardHeader>
						<CardTitle>Skipped rows in {expanded}</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-2">
						<p className="text-muted-foreground text-xs">
							These rows fall inside a period an earlier file already covers, so
							they were dropped to avoid double-counting. If this file is the
							more complete export for these dates, move it up instead of
							including rows individually — picking rows by hand would
							double-count transactions that appear in both files.
						</p>
						<DataTable
							columns={SKIPPED_COLUMNS}
							dense
							maxHeightClass="max-h-80"
							noun="skipped rows"
							rowKey={(_activity, index) => String(index)}
							rows={analysis.skippedBySource[expanded] ?? []}
						/>
					</CardContent>
				</Card>
			)}
		</main>
	);
}
