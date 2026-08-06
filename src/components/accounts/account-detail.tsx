"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { ActivitiesTable } from "@/components/activities-table";
import { ActivityChart } from "@/components/charts/activity-chart";
import { MonthBreakdownChart } from "@/components/charts/month-breakdown-chart";
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
	matchDatasetValue,
} from "@/lib/metrics";
import { useDatasetStore } from "@/stores/dataset";

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
			<YearAnalytics
				accountType={accountType}
				activities={scoped}
				currency={currency}
			/>
			<MoneyFlow activities={scoped} currency={currency} />
			<ActivityChart activities={scoped} currency={currency} />
			<MonthBreakdownChart activities={scoped} currency={currency} />
			<ActivitiesTable activities={scoped} currency={currency} />
		</main>
	);
}
