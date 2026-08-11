"use client";

import { ArrowDownUp, Coins, Receipt } from "lucide-react";
import { formatCurrency, isCashAccount, type Kpis } from "@/lib/metrics";
import { cn } from "@/lib/utils";

interface HeadlineFiguresProps {
	kpis: Kpis;
	currency: string;
	/** `sm` is the in-card size; `md` leads a page header. */
	size?: "sm" | "md";
	/**
	 * Set when the figures cover a single account type. Only the label changes:
	 * on a chequing account the same figure is salary arriving and rent leaving,
	 * not money being put to work, so calling it "Net deposits" there would
	 * overstate what it means.
	 */
	accountType?: string;
}

/**
 * `income` is the sum of dividends, interest, cash back and promos (referral
 * bonuses, giveaways). Most accounts only ever earn one of the four (a TFSA
 * holding equities gets dividends, not interest or cash back), so labelling it
 * generically as "Income" is vaguer than the data actually is — name the
 * specific source when there's only one, and fall back to "Income" only when
 * it's a genuine mix (or zero).
 */
function incomeLabel(kpis: Kpis): string {
	const sources = [
		kpis.dividends !== 0,
		kpis.interest !== 0,
		kpis.cashback !== 0,
		kpis.promo !== 0,
	].filter(Boolean).length;

	if (sources !== 1) return "Income";
	if (kpis.dividends !== 0) return "Dividends";
	if (kpis.interest !== 0) return "Interest";
	if (kpis.cashback !== 0) return "Cash back";
	return "Bonus";
}

/**
 * The three figures every summary surface leads with: how much of your own
 * money crossed the boundary, what it earned once it was there, and what it
 * cost. Buys and sells are deliberately absent — they move cash between the
 * portfolio's own pockets and say nothing about how much you put in.
 */
export function HeadlineFigures({
	kpis,
	currency,
	size = "sm",
	accountType,
}: HeadlineFiguresProps) {
	const isCash = accountType !== undefined && isCashAccount(accountType);

	const figures = [
		{
			label: isCash ? "Net cash movement" : "Net deposits",
			value: kpis.netDeposits,
			Icon: ArrowDownUp,
			tone: "text-foreground",
		},
		{
			label: incomeLabel(kpis),
			value: kpis.income,
			Icon: Coins,
			tone: "text-emerald-600 dark:text-emerald-400",
		},
		{
			label: "Fees & tax",
			value: -kpis.costs,
			Icon: Receipt,
			tone: "text-destructive",
		},
	];

	return (
		<div
			className={cn(
				"grid grid-cols-1 sm:grid-cols-3",
				size === "md" ? "gap-4" : "gap-3",
			)}
		>
			{figures.map(({ label, value, Icon, tone }) => (
				<div className="flex flex-col gap-0.5" key={label}>
					<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
						<Icon className="size-3.5" />
						{label}
					</span>
					<span
						className={cn(
							"font-semibold tabular-nums",
							size === "md" ? "text-2xl" : "text-xl",
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
