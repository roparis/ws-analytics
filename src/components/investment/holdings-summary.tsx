"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReturnPill } from "@/components/ui/figures";
import { formatCurrency, formatDate } from "@/lib/metrics";
import type { PositionsReport } from "@/lib/positions";
import {
	STALE_AFTER_DAYS,
	snapshotAgeDays,
	valueWith,
} from "@/lib/price-snapshot";
import { usePriceStore } from "@/stores/prices";

interface HoldingsSummaryProps {
	report: PositionsReport;
	currency: string;
}

export function HoldingsSummary({ report, currency }: HoldingsSummaryProps) {
	const { totals } = report;
	const snapshot = usePriceStore((state) => state.snapshot);

	const valued = useMemo(() => valueWith(report, snapshot), [report, snapshot]);

	// Measured against the book cost of the holdings that actually priced, so an
	// unresolvable ticker costs us that row rather than the whole figure — the
	// same rule the exported sheet applies to its own totals row.
	const pricedBookCost =
		valued?.byAccountType.reduce((sum, row) => sum + row.pricedBookCost, 0) ??
		0;
	const marketValue =
		valued?.byAccountType.reduce((sum, row) => sum + row.marketValue, 0) ?? 0;
	const unrealised = marketValue - pricedBookCost;

	const tiles = [
		valued && valued.pricedCount > 0
			? {
					label: "Market value",
					value: formatCurrency(marketValue, currency),
					hint: `The ${valued.pricedCount} of ${valued.holdingCount} ${valued.holdingCount === 1 ? "holding" : "holdings"} your imported sheet could price, at ${formatDate(snapshot?.asOf ?? "")} prices.`,
				}
			: {
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
			{valued && valued.pricedCount > 0 ? (
				<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
					<span>
						Unrealised on what you still hold:{" "}
						<span className="font-medium text-foreground tabular-nums">
							{formatCurrency(unrealised, currency)}
						</span>
					</span>
					{pricedBookCost > 0 && (
						<ReturnPill
							label="Market value against the book cost of the holdings that priced"
							value={unrealised / pricedBookCost}
						/>
					)}
					<span>
						· Prices from your imported sheet,{" "}
						{formatDate(snapshot?.asOf ?? "")}
						{snapshot && snapshotAgeDays(snapshot) > STALE_AFTER_DAYS
							? " — old enough that markets have moved since."
							: "."}
						{valued.missingSymbols.length > 0 &&
							` No price for ${valued.missingSymbols.join(", ")}, so ${valued.missingSymbols.length === 1 ? "it is" : "they are"} left out of both figures.`}
					</span>
				</div>
			) : (
				<p className="text-muted-foreground text-xs">
					There is no market value on this page, and that is deliberate: a
					Wealthsimple activities export contains no prices and no position
					snapshot, so anything shown here as &ldquo;what it&apos;s worth
					today&rdquo; would be invented. Everything above is reconstructed from
					your own transactions. Export to Google Sheets, let it fetch prices,
					then import that tab back to see what these holdings are worth.
				</p>
			)}
		</div>
	);
}
