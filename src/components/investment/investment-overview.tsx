"use client";

import { useCallback, useMemo } from "react";
import { AccountGroupList } from "@/components/accounts/account-group-list";
import { CapitalChart } from "@/components/charts/capital-chart";
import { AccountBreakdown } from "@/components/investment/account-breakdown";
import { AccountTypeBreakdown } from "@/components/investment/account-type-breakdown";
import { AllocationChart } from "@/components/investment/allocation-chart";
import { ClosedPositionsTable } from "@/components/investment/closed-positions-table";
import { ExportSheetDialog } from "@/components/investment/export-sheet-dialog";
import { HistoryWarning } from "@/components/investment/history-warning";
import { HoldingsSummary } from "@/components/investment/holdings-summary";
import { HoldingsTable } from "@/components/investment/holdings-table";
import { ImportPricesDialog } from "@/components/investment/import-prices-dialog";
import { SymbolIncomeTable } from "@/components/investment/symbol-income-table";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/metrics";
import { buildPositions } from "@/lib/positions";
import { useDatasetStore } from "@/stores/dataset";

export function InvestmentOverview() {
	const dataset = useDatasetStore((state) => state.dataset);

	// The whole page derives from one walk of the activity history.
	const report = useMemo(() => {
		if (!dataset) return null;
		return buildPositions(dataset.activities, { sources: dataset.sources });
	}, [dataset]);

	const currency = dataset?.currencies[0] ?? "CAD";
	const suspectAccounts =
		report?.byAccount.filter(
			(account) => account.historyConfidence === "suspect",
		) ?? [];
	// Stable across renders: `AccountGroupList` keys a memo on this, so a fresh
	// arrow each time would re-group and re-sort the whole list for nothing.
	const bookCostFor = useCallback(
		(accountId: string) =>
			report?.byAccount.find((account) => account.accountId === accountId)
				?.bookCost ?? 0,
		[report],
	);

	if (!dataset || !report) return null;

	const exportProps = {
		activities: dataset.activities,
		dataThrough: dataset.dateRange.end,
		fileName: dataset.fileName,
		report,
	};

	return (
		<main className="flex w-full flex-1 flex-col gap-6 py-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="font-semibold text-xl">Investments</h1>
					<p className="text-muted-foreground text-sm">
						{report.totals.openCount}{" "}
						{report.totals.openCount === 1 ? "holding" : "holdings"} across{" "}
						{report.byAccount.length}{" "}
						{report.byAccount.length === 1 ? "account" : "accounts"} ·{" "}
						{formatDate(dataset.dateRange.start)} –{" "}
						{formatDate(dataset.dateRange.end)}
					</p>
				</div>
				{/* Export and re-import are two halves of one loop, so they sit
				together rather than the second hiding somewhere else. The live fetch
				is the same answer without the loop, and lives in the sidebar because
				the prices it lands feed every page, not this one. */}
				<div className="flex flex-wrap items-center gap-2">
					<ImportPricesDialog currency={currency} report={report} />
					<ExportSheetDialog {...exportProps} />
				</div>
			</div>

			<HistoryWarning accounts={suspectAccounts} />

			<CapitalChart
				activities={dataset.activities}
				currency={currency}
				datasetEnd={dataset.dateRange.end}
				label="Net deposits into the market"
			/>

			<HoldingsSummary currency={currency} report={report} />

			<AllocationChart
				byAccountType={report.byAccountType}
				currency={currency}
			/>

			<HoldingsTable currency={currency} positions={report.open} />

			<AccountGroupList
				activities={dataset.activities}
				amountFor={bookCostFor}
				caption="Book cost of the holdings in each account."
				currency={currency}
			/>

			<AccountBreakdown accounts={report.byAccount} currency={currency} />

			<AccountTypeBreakdown
				byAccountType={report.byAccountType}
				currency={currency}
			/>

			<ClosedPositionsTable currency={currency} positions={report.closed} />

			<SymbolIncomeTable currency={currency} report={report} />

			{/* Placed here on purpose: this is the point in the page where a reader
			has seen every figure the export can support and is wondering what the
			holdings are actually worth. */}
			<Card size="sm">
				<CardContent className="flex flex-wrap items-center justify-between gap-4">
					<div className="flex flex-col gap-1">
						<h2 className="font-heading font-medium text-base">
							See what these are worth today
						</h2>
						<p className="max-w-prose text-muted-foreground text-sm">
							The sheet carries your {report.totals.openCount} holdings with a
							live <code className="text-xs">GOOGLEFINANCE</code> price on each
							row, converts US-listed prices through a live USD→CAD rate, and
							works out market value, unrealised gain and what share of the
							portfolio each position is.
						</p>
					</div>
					<ExportSheetDialog {...exportProps} />
				</CardContent>
			</Card>
		</main>
	);
}
