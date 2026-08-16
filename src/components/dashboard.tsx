"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AccountGroupList } from "@/components/accounts/account-group-list";
import { ActivitiesTable } from "@/components/activities-table";
import { CapitalChart } from "@/components/charts/capital-chart";
import { DashboardFilters } from "@/components/dashboard-filters";
import { KpiCards } from "@/components/kpi-cards";
import { MoneyFlow } from "@/components/money-flow";
import { PdfExportButton } from "@/components/pdf-export-button";
import { type Earned, earnedFrom, NO_EARNINGS } from "@/lib/analytics";
import { type DatePreset, resolveDateFrom } from "@/lib/date-range";
import {
	type ActivityFilters,
	computeKpis,
	EMPTY_FILTERS,
	filterActivities,
} from "@/lib/metrics";
import { buildPositions } from "@/lib/positions";
import { useDatasetStore } from "@/stores/dataset";

export function Dashboard() {
	const dataset = useDatasetStore((state) => state.dataset);
	const reportRef = useRef<HTMLDivElement>(null);
	const [filters, setFilters] = useState<ActivityFilters>(EMPTY_FILTERS);
	const [datePreset, setDatePreset] = useState<DatePreset>("all");

	const datasetEnd = dataset?.dateRange.end ?? "";

	const filtered = useMemo(() => {
		if (!dataset) return [];
		return filterActivities(dataset.activities, {
			...filters,
			dateFrom: resolveDateFrom(datePreset, datasetEnd),
		});
	}, [dataset, filters, datePreset, datasetEnd]);

	const kpis = useMemo(() => computeKpis(filtered), [filtered]);

	const report = useMemo(
		() =>
			dataset
				? buildPositions(dataset.activities, { sources: dataset.sources })
				: null,
		[dataset],
	);
	// Every cash movement across the account's boundary, netted — deposits from
	// your bank and transfers from your other Wealthsimple accounts alike. This
	// is your own money, which is the figure the row leads with.
	const addedTo = useCallback(
		(accountId: string) => {
			if (!dataset) return 0;
			return computeKpis(
				filterActivities(dataset.activities, {
					...EMPTY_FILTERS,
					accountIds: [accountId],
				}),
			).netDeposits;
		},
		[dataset],
	);

	// What the account made on top of that. Built from its parts rather than as
	// `value − added`, so the tooltip's breakdown is the figure itself and can't
	// drift from it — the two agree to the cent on every account in a real export.
	//
	// The decomposition itself lives in `earnedFrom` so the analytics page's
	// per-year rows and this per-account one can't answer "earned" differently.
	const earnedIn = useCallback(
		(accountId: string): Earned => {
			const account = report?.byAccount.find(
				(candidate) => candidate.accountId === accountId,
			);
			if (!account || !dataset) return NO_EARNINGS;

			const kpis = computeKpis(
				filterActivities(dataset.activities, {
					...EMPTY_FILTERS,
					accountIds: [accountId],
				}),
			);
			return earnedFrom(kpis, account.realizedPnl);
		},
		[dataset, report],
	);

	if (!dataset) return null;

	const currency = dataset.currencies[0] ?? "CAD";
	const isAccountFiltered =
		filters.accountTypes.length > 0 || filters.accountIds.length > 0;

	return (
		<div className="flex flex-1 flex-col gap-6">
			{/* The files themselves are the sidebar's business — this header only
			carries the one action that belongs to the dashboard. */}
			<div className="flex items-center justify-between gap-3">
				<h1 className="font-semibold text-lg">Dashboard</h1>
				<PdfExportButton
					filename={`${dataset.fileName.replace(/\.csv$/i, "")}-report.pdf`}
					targetRef={reportRef}
				/>
			</div>

			<div className="flex flex-col gap-8 bg-background" ref={reportRef}>
				<CapitalChart
					activities={dataset.activities}
					currency={currency}
					datasetEnd={datasetEnd}
				/>

				<AccountGroupList
					activities={dataset.activities}
					amountFor={addedTo}
					caption="The money you put in — from your bank or from your other accounts, net of anything moved back out. Underneath, what the account made on top of it."
					currency={currency}
					earnedFor={earnedIn}
				/>

				<DashboardFilters
					dataset={dataset}
					datePreset={datePreset}
					filters={filters}
					onDatePresetChange={setDatePreset}
					onFiltersChange={setFilters}
				/>
				<KpiCards
					currency={currency}
					isAccountFiltered={isAccountFiltered}
					kpis={kpis}
				/>
				<MoneyFlow activities={filtered} currency={currency} />
				<ActivitiesTable activities={filtered} currency={currency} />
			</div>
		</div>
	);
}
