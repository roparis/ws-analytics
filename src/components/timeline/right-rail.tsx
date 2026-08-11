"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MergedDataset } from "@/lib/merge";
import { computeKpis, formatCurrency, formatDate } from "@/lib/metrics";

export function RightRail({ dataset }: { dataset: MergedDataset }) {
	const kpis = computeKpis(dataset.activities);
	const currency = dataset.currencies[0] ?? "CAD";

	const rows = [
		{ label: "Net deposits", value: kpis.netDeposits },
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
			</div>
		</aside>
	);
}
