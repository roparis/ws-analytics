"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ActivitiesTable } from "@/components/activities-table";
import { SectorBreakdown } from "@/components/analytics/sector-breakdown";
import { CapitalChart } from "@/components/charts/capital-chart";
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
import { buildPositions } from "@/lib/positions";
import { useDatasetStore } from "@/stores/dataset";
import { usePriceStore } from "@/stores/prices";

export function AccountDetail({
	typeParam,
	accountId,
}: {
	typeParam: string;
	accountId: string;
}) {
	const dataset = useDatasetStore((state) => state.dataset);
	const snapshot = usePriceStore((state) => state.snapshot);
	const profiles = usePriceStore((state) => state.profiles);

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
	// This account's own holdings — `scoped` is already narrowed to one
	// account, so the report `breakdownBySector` reads from is too. Skipped
	// (the cheap empty-activities call instead) when no profile has ever been
	// fetched: `SectorBreakdown` renders only its empty-state paragraph in
	// that case, so walking every activity to build a report nobody reads
	// would be pure waste on every visit to this page.
	const report = useMemo(
		() =>
			profiles
				? buildPositions(scoped, { sources: dataset?.sources })
				: buildPositions([], {}),
		[scoped, dataset, profiles],
	);

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
			{/* No back link here — the breadcrumb in the shell is the way up. */}
			<div>
				<h1 className="font-semibold text-xl">{resolvedId}</h1>
				<p className="text-muted-foreground text-sm">
					{accountType} · {kpis.count.toLocaleString()} activities ·{" "}
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

			<CapitalChart
				activities={scoped}
				currency={currency}
				datasetEnd={dataset.dateRange.end}
				label="Net deposits into this account"
			/>

			<KpiCards currency={currency} isAccountFiltered kpis={kpis} />

			<SectorBreakdown
				currency={currency}
				profiles={profiles}
				report={report}
				snapshot={snapshot}
			/>

			<YearAnalytics
				accountType={accountType}
				activities={scoped}
				currency={currency}
			/>
			<MoneyFlow activities={scoped} currency={currency} />
			<MonthBreakdownChart activities={scoped} currency={currency} />
			<ActivitiesTable activities={scoped} currency={currency} />
		</main>
	);
}
