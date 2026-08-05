"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { AccountTypeCards } from "@/components/accounts/account-type-cards";
import { ActivitiesTable } from "@/components/activities-table";
import { ActivityChart } from "@/components/charts/activity-chart";
import { CsvUploader } from "@/components/csv-uploader";
import {
	DashboardFilters,
	type DatePreset,
	resolveDateFrom,
} from "@/components/dashboard-filters";
import { KpiCards } from "@/components/kpi-cards";
import { MoneyFlow } from "@/components/money-flow";
import { PdfExportButton } from "@/components/pdf-export-button";
import { SourcesPanel } from "@/components/sources-panel";
import { Button } from "@/components/ui/button";
import {
	type ActivityFilters,
	computeKpis,
	EMPTY_FILTERS,
	filterActivities,
} from "@/lib/metrics";
import { useDatasetStore } from "@/stores/dataset";

export function Dashboard() {
	const dataset = useDatasetStore((state) => state.dataset);
	const clear = useDatasetStore((state) => state.clear);
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

	if (!dataset) return null;

	const currency = dataset.currencies[0] ?? "CAD";
	const isAccountFiltered =
		filters.accountTypes.length > 0 || filters.accountIds.length > 0;

	return (
		<div className="flex flex-1 flex-col gap-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-semibold text-lg">{dataset.fileName}</h1>
					<p className="text-muted-foreground text-sm">
						{dataset.activities.length.toLocaleString()} activities ·{" "}
						{dataset.accounts.length} accounts
					</p>
				</div>
				<div className="flex gap-2">
					<CsvUploader compact />
					<Button
						onClick={clear}
						title="Removes these files from this device, including the copy saved in your browser"
						variant="ghost"
					>
						<Trash2 className="size-4" />
						Clear data
					</Button>
					<PdfExportButton
						filename={`${dataset.fileName.replace(/\.csv$/i, "")}-report.pdf`}
						targetRef={reportRef}
					/>
				</div>
			</div>

			<div className="flex flex-col gap-6 bg-background" ref={reportRef}>
				<SourcesPanel sources={dataset.sources} />
				<AccountTypeCards currency={currency} dataset={dataset} />
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
				<ActivityChart activities={filtered} currency={currency} />
				<ActivitiesTable activities={filtered} currency={currency} />
			</div>
		</div>
	);
}
