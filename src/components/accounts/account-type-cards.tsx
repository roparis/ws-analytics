"use client";

import Link from "next/link";
import { useMemo } from "react";
import { HeadlineFigures } from "@/components/headline-figures";
import { Card, CardContent } from "@/components/ui/card";
import type { MergedDataset } from "@/lib/merge";
import { computeKpis, formatCurrency } from "@/lib/metrics";

interface AccountTypeCardsProps {
	dataset: MergedDataset;
	currency: string;
}

/**
 * Entry point into the per-account-type pages. The desktop sidebar links each
 * type directly, but the mobile bottom bar keeps its fixed three tabs, so this
 * grid is what gets a phone user there — and it doubles as signposting on
 * desktop.
 */
export function AccountTypeCards({ dataset, currency }: AccountTypeCardsProps) {
	const types = useMemo(() => {
		return [...dataset.accountTypes].sort().map((accountType) => {
			const activities = dataset.activities.filter(
				(activity) => activity.accountType === accountType,
			);
			const accountCount = dataset.accounts.filter(
				(account) => account.accountType === accountType,
			).length;
			return {
				accountType,
				accountCount,
				kpis: computeKpis(activities),
			};
		});
	}, [dataset]);

	if (types.length === 0) return null;

	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-heading font-medium text-base">Accounts</h2>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{types.map(({ accountType, accountCount, kpis }) => (
					<Card
						className="transition-colors hover:bg-muted/40"
						key={accountType}
						size="sm"
					>
						<CardContent className="flex flex-col gap-4">
							<Link
								className="flex flex-col gap-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
								href={`/accounts/${encodeURIComponent(accountType)}`}
							>
								<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
									<h3 className="font-heading font-semibold text-lg">
										{accountType}
									</h3>
									<span className="text-muted-foreground text-xs">
										{accountCount} {accountCount === 1 ? "account" : "accounts"}
									</span>
								</div>

								<HeadlineFigures
									accountType={accountType}
									currency={currency}
									kpis={kpis}
								/>

								<span className="text-muted-foreground text-xs tabular-nums">
									{kpis.count.toLocaleString()} activities · Net{" "}
									{formatCurrency(kpis.netCashFlow, currency)}
								</span>
							</Link>
						</CardContent>
					</Card>
				))}
			</div>
		</section>
	);
}
