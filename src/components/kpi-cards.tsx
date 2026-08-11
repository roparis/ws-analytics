"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, type Kpis } from "@/lib/metrics";

interface KpiCardsProps {
	kpis: Kpis;
	currency: string;
	isAccountFiltered: boolean;
}

export function KpiCards({ kpis, currency, isAccountFiltered }: KpiCardsProps) {
	const tiles = [
		{
			label: "Net deposits",
			value: kpis.netDeposits,
			hint: isAccountFiltered
				? "Cash moved into the selected accounts, including transfers from your other Wealthsimple accounts."
				: "Every cash movement, net. Bank deposits fund the accounts; transfers between your own accounts cancel out.",
		},
		{
			label: "Dividends & income",
			value: kpis.income,
			hint: "Dividend distributions, interest, cash back and bonuses.",
		},
		{
			label: "Fees, interest & tax",
			value: kpis.costs,
			hint: "Management fees, margin interest and withholding tax, net of refunds.",
		},
	];

	return (
		<div className="flex flex-col gap-3">
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{tiles.map((tile) => (
					<Card key={tile.label} size="sm">
						<CardHeader>
							<CardTitle className="text-muted-foreground text-sm">
								{tile.label}
							</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-1.5">
							<span className="font-semibold text-2xl tabular-nums">
								{formatCurrency(tile.value, currency)}
							</span>
							<span className="text-muted-foreground text-xs">{tile.hint}</span>
						</CardContent>
					</Card>
				))}
			</div>
			<p className="text-muted-foreground text-xs">
				{kpis.count} activities from {formatDate(kpis.dateRange.start)} to{" "}
				{formatDate(kpis.dateRange.end)} · net cash flow{" "}
				<span className="tabular-nums">
					{formatCurrency(kpis.netCashFlow, currency)}
				</span>
				. These are cash-flow totals for the selected period — an activities
				export contains no prices or positions, so portfolio value and returns
				can&apos;t be derived from it.
			</p>
		</div>
	);
}
