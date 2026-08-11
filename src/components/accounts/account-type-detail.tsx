"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AccountCard } from "@/components/accounts/account-card";
import { ActivitiesTable } from "@/components/activities-table";
import { CapitalChart } from "@/components/charts/capital-chart";
import { YearBreakdownChart } from "@/components/charts/year-breakdown-chart";
import { HeadlineFigures } from "@/components/headline-figures";
import { KpiCards } from "@/components/kpi-cards";
import { MoneyFlow } from "@/components/money-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { YearAnalytics } from "@/components/year-analytics";
import {
	computeKpis,
	EMPTY_FILTERS,
	filterActivities,
	formatDate,
	groupByAccount,
	matchDatasetValue,
} from "@/lib/metrics";
import { useDatasetStore } from "@/stores/dataset";

export function AccountTypeDetail({ typeParam }: { typeParam: string }) {
	const dataset = useDatasetStore((state) => state.dataset);

	const accountType = dataset
		? matchDatasetValue(dataset.accountTypes, typeParam)
		: undefined;

	// Hooks run before the early returns below, so the memo has to tolerate a
	// missing dataset rather than being skipped.
	const scoped = useMemo(() => {
		if (!dataset || !accountType) return [];
		return filterActivities(dataset.activities, {
			...EMPTY_FILTERS,
			accountTypes: [accountType],
		});
	}, [dataset, accountType]);

	const kpis = useMemo(() => computeKpis(scoped), [scoped]);
	const accounts = useMemo(() => groupByAccount(scoped), [scoped]);

	if (!dataset) return null;

	if (!accountType) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
				<p className="text-muted-foreground text-sm">
					No activity for this account type in the loaded files.
				</p>
				<Button
					nativeButton={false}
					render={<Link href="/dashboard">Back to dashboard</Link>}
				/>
			</div>
		);
	}

	const currency = dataset.currencies[0] ?? "CAD";

	return (
		<main className="flex w-full flex-1 flex-col gap-6 py-6">
			{/* No back link here — the breadcrumb in the shell is the way up. */}
			<div>
				<h1 className="font-semibold text-xl">{accountType}</h1>
				<p className="text-muted-foreground text-sm">
					{accounts.length} {accounts.length === 1 ? "account" : "accounts"} ·{" "}
					{kpis.count.toLocaleString()} activities ·{" "}
					{formatDate(kpis.dateRange.start)} – {formatDate(kpis.dateRange.end)}
				</p>
			</div>

			<Card size="sm">
				<CardContent>
					<HeadlineFigures
						accountType={accountType}
						currency={currency}
						kpis={kpis}
						size="md"
					/>
				</CardContent>
			</Card>

			<p className="text-muted-foreground text-xs">
				Scoped to one account type, so transfers from your other Wealthsimple
				accounts no longer cancel out — they count as money arriving here.
			</p>

			<CapitalChart
				activities={scoped}
				currency={currency}
				datasetEnd={dataset.dateRange.end}
				label="Net deposits into this account type"
			/>

			<KpiCards currency={currency} isAccountFiltered kpis={kpis} />

			<section className="flex flex-col gap-3">
				<h2 className="font-heading font-medium text-base">Accounts</h2>
				<div className="grid gap-4 sm:grid-cols-2">
					{accounts.map((group) => (
						<AccountCard currency={currency} group={group} key={group.id} />
					))}
				</div>
			</section>

			<YearAnalytics
				accountType={accountType}
				activities={scoped}
				currency={currency}
			/>

			<YearBreakdownChart activities={scoped} currency={currency} />

			<MoneyFlow activities={scoped} currency={currency} />
			<ActivitiesTable activities={scoped} currency={currency} />
		</main>
	);
}
