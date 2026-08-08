"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/metrics";
import type { PositionsReport } from "@/lib/positions";

interface HoldingsSummaryProps {
	report: PositionsReport;
	currency: string;
}

export function HoldingsSummary({ report, currency }: HoldingsSummaryProps) {
	const { totals } = report;

	const tiles = [
		{
			label: "Book cost of holdings",
			value: formatCurrency(totals.bookCost, currency),
			hint: `What you paid for the ${totals.openCount} ${totals.openCount === 1 ? "holding" : "holdings"} you still own, commission included.`,
		},
		{
			label: "Realised gain",
			value: formatCurrency(totals.realizedPnl, currency),
			hint: `Proceeds minus book cost on everything you've sold, across ${totals.closedCount} closed ${totals.closedCount === 1 ? "position" : "positions"}.`,
		},
		{
			label: "Dividends received",
			value: formatCurrency(totals.dividends, currency),
			hint: "Distributions paid by your holdings, before withholding tax.",
		},
		{
			label: "Idle cash",
			value: formatCurrency(totals.cashBalance, currency),
			hint: "Uninvested cash across your accounts — every movement in, minus everything spent.",
		},
	];

	return (
		<div className="flex flex-col gap-3">
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{tiles.map((tile) => (
					<Card key={tile.label} size="sm">
						<CardHeader>
							<CardTitle className="text-muted-foreground text-sm">
								{tile.label}
							</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-1.5">
							<span className="font-semibold text-2xl tabular-nums">
								{tile.value}
							</span>
							<span className="text-muted-foreground text-xs">{tile.hint}</span>
						</CardContent>
					</Card>
				))}
			</div>
			<p className="text-muted-foreground text-xs">
				There is no market value on this page, and that is deliberate: a
				Wealthsimple activities export contains no prices and no position
				snapshot, so anything shown here as &ldquo;what it&apos;s worth
				today&rdquo; would be invented. Everything above is reconstructed from
				your own transactions. Export to Google Sheets to add live prices and
				see what these holdings are actually worth.
			</p>
		</div>
	);
}
