"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { ActivitiesTable } from "@/components/activities-table";
import { ActivityChart } from "@/components/charts/activity-chart";
import { HeadlineFigures } from "@/components/headline-figures";
import { KpiCards } from "@/components/kpi-cards";
import { MoneyFlow } from "@/components/money-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	computeKpis,
	EMPTY_FILTERS,
	filterActivities,
	formatCurrency,
	formatDate,
	groupByMonth,
	matchDatasetValue,
} from "@/lib/metrics";
import type { Activity } from "@/lib/wealthsimple";
import { useDatasetStore } from "@/stores/dataset";

/**
 * A compact, non-linking month list. `MonthCard`/`TimelineFeed` always link to
 * `/month/[key]`, the all-accounts view — reusing them here would let a click
 * silently drop the account scope, so this is a few lines of plain JSX instead.
 */
function MonthBreakdown({
	activities,
	currency,
}: {
	activities: Activity[];
	currency: string;
}) {
	const months = useMemo(() => groupByMonth(activities), [activities]);
	if (months.length === 0) return null;

	return (
		<Card size="sm">
			<CardContent className="flex flex-col gap-1">
				<h2 className="mb-2 font-heading font-medium text-base">By month</h2>
				{months.map((month) => (
					<div
						className="flex items-center justify-between gap-3 py-1 text-sm"
						key={month.key}
					>
						<span>{month.label}</span>
						<span className="flex gap-4 text-muted-foreground tabular-nums">
							<span>
								Invested{" "}
								{formatCurrency(month.kpis.netCapitalDeployed, currency)}
							</span>
							<span>Income {formatCurrency(month.kpis.income, currency)}</span>
							<span>
								Fees & tax {formatCurrency(-month.kpis.costs, currency)}
							</span>
							<span className="text-foreground">
								Net {formatCurrency(month.kpis.netCashFlow, currency)}
							</span>
						</span>
					</div>
				))}
			</CardContent>
		</Card>
	);
}

export function AccountDetail({
	typeParam,
	accountId,
}: {
	typeParam: string;
	accountId: string;
}) {
	const dataset = useDatasetStore((state) => state.dataset);

	const accountType = dataset
		? matchDatasetValue(dataset.accountTypes, typeParam)
		: undefined;
	const resolvedId =
		dataset && accountType
			? matchDatasetValue(
					dataset.accounts
						.filter((account) => account.accountType === accountType)
						.map((account) => account.id),
					accountId,
				)
			: undefined;

	const scoped = useMemo(() => {
		if (!dataset || !resolvedId) return [];
		return filterActivities(dataset.activities, {
			...EMPTY_FILTERS,
			accountIds: [resolvedId],
		});
	}, [dataset, resolvedId]);

	const kpis = useMemo(() => computeKpis(scoped), [scoped]);

	if (!dataset) return null;

	if (!accountType || !resolvedId) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
				<p className="text-muted-foreground text-sm">
					No activity for this account in the loaded files.
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
			<div className="flex flex-col gap-3">
				<Button
					className="w-fit"
					nativeButton={false}
					render={
						<Link href={`/accounts/${encodeURIComponent(accountType)}`}>
							<ArrowLeft className="size-4" />
							{accountType}
						</Link>
					}
					size="sm"
					variant="ghost"
				/>
				<div>
					<h1 className="font-semibold text-xl">{resolvedId}</h1>
					<p className="text-muted-foreground text-sm">
						{accountType} · {kpis.count.toLocaleString()} activities ·{" "}
						{formatDate(kpis.dateRange.start)} –{" "}
						{formatDate(kpis.dateRange.end)}
					</p>
				</div>
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

			<KpiCards currency={currency} isAccountFiltered kpis={kpis} />
			<MoneyFlow activities={scoped} currency={currency} />
			<ActivityChart activities={scoped} currency={currency} />
			<MonthBreakdown activities={scoped} currency={currency} />
			<ActivitiesTable activities={scoped} currency={currency} />
		</main>
	);
}
