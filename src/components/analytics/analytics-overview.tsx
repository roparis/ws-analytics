"use client";

import { useEffect, useMemo } from "react";
import { AssumptionsPanel } from "@/components/analytics/assumptions-panel";
import { YearAccountDetail } from "@/components/analytics/year-account-detail";
import { YearAccountMatrix } from "@/components/analytics/year-account-matrix";
import { buildSeries } from "@/components/charts/account-type-series";
import { ProjectionChart } from "@/components/charts/projection-chart";
import { LivePricesButton } from "@/components/investment/live-prices-button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { HeadlineValue } from "@/components/ui/figures";
import {
	applyOverrides,
	startingBalances,
	yearAccountStats,
	yearTotals,
} from "@/lib/analytics";
import { formatCurrency, formatDate } from "@/lib/metrics";
import { buildPositions } from "@/lib/positions";
import { valueYears, withValuations } from "@/lib/price-history";
import {
	snapshotAgeDays,
	sourceLabel,
	valuedBalances,
	valueWith,
} from "@/lib/price-snapshot";
import { depletionYear, projectSeries } from "@/lib/projection";
import { useDatasetStore } from "@/stores/dataset";
import { usePriceStore } from "@/stores/prices";
import { useProjectionStore } from "@/stores/projection";

/**
 * The analytics page: what the money is assumed to do next, and what it has
 * actually done so far.
 *
 * The projection is deliberately downstream of the history rather than beside
 * it. Its starting balances come from the same roll-up the investment page
 * shows, and the assumption panel sits under the chart so the shape is read
 * first and the inputs second.
 */

export function AnalyticsOverview() {
	const dataset = useDatasetStore((state) => state.dataset);
	const snapshot = usePriceStore((state) => state.snapshot);
	const history = usePriceStore((state) => state.history);
	const inputs = useProjectionStore((state) => state.inputs);
	const overrides = useProjectionStore((state) => state.overrides);
	const hydrateProjection = useProjectionStore((state) => state.hydrate);

	// Read here rather than in the root layout: nothing outside this page cares
	// about the assumptions, so nothing else should pay to load them.
	useEffect(() => {
		hydrateProjection();
	}, [hydrateProjection]);

	const report = useMemo(
		() =>
			dataset
				? buildPositions(dataset.activities, { sources: dataset.sources })
				: null,
		[dataset],
	);

	// Real market value when a price snapshot has been imported, book cost plus
	// cash otherwise. Cash accounts are dropped either way — `startingBalances`
	// explains why, and the valued path filters the same set.
	const valued = useMemo(
		() => (report ? valueWith(report, snapshot) : null),
		[report, snapshot],
	);

	const derived = useMemo(() => {
		if (!report) return {};
		const bookCost = startingBalances(report);
		if (!valued) return bookCost;

		const priced = valuedBalances(valued);
		return Object.fromEntries(
			Object.keys(bookCost).map((type) => [
				type,
				priced[type] ?? bookCost[type],
			]),
		);
	}, [report, valued]);
	const balances = useMemo(
		() => applyOverrides(derived, overrides),
		[derived, overrides],
	);

	const series = useMemo(
		() => buildSeries(Object.keys(balances).sort()),
		[balances],
	);

	const points = useMemo(
		() => projectSeries(balances, inputs),
		[balances, inputs],
	);

	const coverage = dataset?.dateRange ?? { start: "", end: "" };

	// The expensive one on this page: a walk of the activity history per year,
	// so a year-end share count is derived rather than assumed. Keyed on the
	// history so it only re-runs when new closes arrive.
	const valuations = useMemo(
		() =>
			dataset
				? valueYears(dataset.activities, history, coverage)
				: new Map<string, never>(),
		[coverage, dataset, history],
	);

	const totals = useMemo(
		() =>
			dataset && report
				? withValuations(
						yearTotals(dataset.activities, report, coverage),
						valuations,
					)
				: [],
		[coverage, dataset, report, valuations],
	);
	const stats = useMemo(
		() =>
			dataset && report
				? withValuations(
						yearAccountStats(dataset.activities, report, coverage),
						valuations,
					)
				: [],
		[coverage, dataset, report, valuations],
	);

	if (!dataset || !report) return null;

	const currency = dataset.currencies[0] ?? "CAD";
	const horizon = points.at(-1);
	const depleted = depletionYear(points);
	const accountTypes = [...dataset.accountTypes].sort();

	// The one sentence that says where the starting figures came from. It has to
	// change with the answer: a projection off book cost and a projection off
	// live prices are different claims, and the page shouldn't make them look
	// like the same one.
	const priceAge = snapshot ? snapshotAgeDays(snapshot) : 0;
	const basis = valued
		? `Your holdings at the prices from ${snapshot ? sourceLabel(snapshot) : "your import"}${priceAge > 0 ? `, ${priceAge} ${priceAge === 1 ? "day" : "days"} ago` : " today"}, plus the cash beside them.${
				valued.missingSymbols.length > 0
					? ` ${valued.missingSymbols.join(", ")} had no price and ${valued.missingSymbols.length === 1 ? "is" : "are"} counted at what you paid.`
					: ""
			} Chequing-style accounts are left out: that balance is money waiting to be spent, not capital at work.`
		: "Taken from what you paid for your holdings plus the cash beside them. Your export carries no prices, so anything you've gained since buying isn't in these figures — fetch live prices above, or type over any of them with the value your account actually shows. Chequing-style accounts are left out: that balance is money waiting to be spent, not capital at work.";

	return (
		<div className="flex flex-1 flex-col gap-6">
			{/* The fetch lives here as well as on Investments: this is the page that
			needs the years behind the prices, and sending someone to another page to
			unlock half the columns on this one is a poor trade. */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="font-semibold text-lg">Analytics</h1>
				<LivePricesButton
					currency={currency}
					range={dataset.dateRange}
					report={report}
					variant={history ? "outline" : "default"}
				/>
			</div>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-4">
						<HeadlineValue
							caption={
								horizon
									? `Projected for ${inputs.years} ${inputs.years === 1 ? "year" : "years"} at ${(inputs.annualReturn * 100).toFixed(1)}% a year — ${formatCurrency(horizon.totalReal, currency)} in today's money. An assumption, not a forecast.`
									: undefined
							}
							currency={currency}
							label="Projected balance"
							value={horizon?.total ?? 0}
						/>
					</div>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<ProjectionChart
						currency={currency}
						points={points}
						series={series}
					/>

					{depleted !== null && (
						<p className="text-destructive text-sm">
							At this withdrawal rate the balance runs out in year {depleted}.
						</p>
					)}
				</CardContent>
			</Card>

			<AssumptionsPanel
				balances={balances}
				basis={basis}
				currency={currency}
				derived={derived}
				inputs={inputs}
			/>

			<YearAccountMatrix
				accountTypes={accountTypes}
				currency={currency}
				stats={stats}
				totals={totals}
			/>

			<YearAccountDetail currency={currency} stats={stats} totals={totals} />

			<Card>
				<CardHeader>
					<CardTitle>What this page can't tell you</CardTitle>
					<CardDescription>
						{valued
							? `A Wealthsimple activities export contains no prices, so the figures above rest on the ${valued.pricedCount} of ${valued.holdingCount} holdings ${snapshot ? sourceLabel(snapshot) : "your import"} could price — as they stood on ${formatDate(snapshot?.asOf ?? "")}, not this moment. ${
									history
										? "The year-by-year value and total return use each year's closing prices and the share count you held at the time, so a year you added to counts what the new shares did too — but a price is one number a day, and nothing here knows what you were charged in spreads. "
										: "The year columns still count only what was sold, because a year-end value needs that year's prices — fetch them above. "
								}Everything left of the projection is measured; everything right of it is an assumption you made.`
							: "A Wealthsimple activities export contains no prices and no position snapshot, so the app knows what you paid and what you received, never what your holdings are worth. That means no portfolio value, no total return, and no unrealised gain — and it means the projection above starts from book cost until you fetch prices or type in the real figures. Everything left of the projection is measured; everything right of it is an assumption you made."}
					</CardDescription>
				</CardHeader>
			</Card>
		</div>
	);
}
