"use client";

import { formatCurrency, isCashAccount, type Kpis } from "@/lib/metrics";
import { cn } from "@/lib/utils";

interface YearFiguresProps {
	kpis: Kpis;
	currency: string;
	/**
	 * Set when scoped to one account type — same role as in `HeadlineFigures`:
	 * switches Deposited/Withdrawn to a single "Net cash movement" tile for
	 * cash/chequing accounts, which `moneyIn`/`moneyOut` otherwise report as
	 * two `$0.00`s.
	 */
	accountType?: string;
}

interface Figure {
	label: string;
	value: number;
	tone: string;
}

/**
 * The five figures a year's worth of activity boils down to: what came in, what
 * went out, what was put to work in the market, what it paid in dividends, and
 * what it cost. Deliberately icon-free (unlike `HeadlineFigures`) — five-plus
 * tiles with icons reads as clutter in a bar that's pinned on screen while
 * scrolling.
 */
export function YearFigures({ kpis, currency, accountType }: YearFiguresProps) {
	const isCash = accountType !== undefined && isCashAccount(accountType);

	const figures: Figure[] = isCash
		? [
				{
					label: "Net cash movement",
					value: kpis.netDeposits,
					tone: "text-foreground",
				},
			]
		: [
				{ label: "Deposited", value: kpis.moneyIn, tone: "text-foreground" },
				{
					label: "Withdrawn",
					value: -kpis.moneyOut,
					tone: "text-destructive",
				},
			];

	figures.push(
		{
			label: "Invested",
			value: kpis.netCapitalDeployed,
			tone: "text-foreground",
		},
		{
			label: "Dividends",
			value: kpis.dividends,
			tone: "text-emerald-600 dark:text-emerald-400",
		},
		{ label: "Fees & tax", value: -kpis.costs, tone: "text-destructive" },
	);

	// Transfers between the user's own accounts net to ~zero across the whole
	// dataset, but can dominate a single scoped account — surface it only when
	// there's actually something to explain.
	if (kpis.transfersNet !== 0) {
		figures.push({
			label: "Transfers",
			value: kpis.transfersNet,
			tone: "text-foreground",
		});
	}

	return (
		<div className="grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-5">
			{figures.map(({ label, value, tone }) => (
				<div className="flex flex-col gap-0.5" key={label}>
					<span className="text-muted-foreground text-xs">{label}</span>
					<span
						className={cn(
							"font-semibold text-sm tabular-nums sm:text-base",
							value === 0 ? "text-muted-foreground" : tone,
						)}
					>
						{formatCurrency(value, currency)}
					</span>
				</div>
			))}
		</div>
	);
}
