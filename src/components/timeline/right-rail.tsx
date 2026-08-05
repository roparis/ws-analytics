"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MergedDataset } from "@/lib/merge";
import { computeKpis, formatCurrency, formatDate } from "@/lib/metrics";

export function RightRail({ dataset }: { dataset: MergedDataset }) {
	const kpis = computeKpis(dataset.activities);
	const currency = dataset.currencies[0] ?? "CAD";
	const conflicts = dataset.sources.filter(
		(source) => source.confidence === "low",
	);

	const rows = [
		{ label: "Invested", value: kpis.netCapitalDeployed },
		{ label: "Income", value: kpis.income },
		{ label: "Fees & tax", value: -kpis.costs },
		{ label: "Net change in cash", value: kpis.netCashFlow },
	];

	return (
		<aside className="hidden w-72 shrink-0 xl:block">
			<div className="sticky top-0 flex flex-col gap-4 py-6">
				<Card size="sm">
					<CardHeader>
						<CardTitle className="text-sm">All time</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-2">
						{rows.map((row) => (
							<div
								className="flex items-baseline justify-between gap-2 text-sm"
								key={row.label}
							>
								<span className="text-muted-foreground">{row.label}</span>
								<span className="font-medium tabular-nums">
									{formatCurrency(row.value, currency)}
								</span>
							</div>
						))}
						<p className="pt-1 text-muted-foreground text-xs">
							{formatDate(kpis.dateRange.start)} –{" "}
							{formatDate(kpis.dateRange.end)} · {kpis.count.toLocaleString()}{" "}
							activities
						</p>
					</CardContent>
				</Card>

				<Card size="sm">
					<CardHeader>
						<CardTitle className="text-sm">
							Sources ({dataset.sources.length})
						</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-2">
						{conflicts.length > 0 ? (
							<p className="flex items-start gap-1.5 text-destructive text-xs">
								<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
								{conflicts.length} file
								{conflicts.length === 1 ? "" : "s"} disagree with an earlier
								file over shared dates.
							</p>
						) : (
							<p className="text-muted-foreground text-xs">
								No merge conflicts.
							</p>
						)}
						<Button
							className="w-full"
							nativeButton={false}
							render={<Link href="/merge">Manage merge</Link>}
							size="sm"
							variant="outline"
						/>
					</CardContent>
				</Card>
			</div>
		</aside>
	);
}
