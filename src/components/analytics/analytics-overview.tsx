"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { AssumptionsPanel } from "@/components/analytics/assumptions-panel";
import { YearAccountDetail } from "@/components/analytics/year-account-detail";
import { YearAccountMatrix } from "@/components/analytics/year-account-matrix";
import { buildSeries } from "@/components/charts/account-type-series";
import { ProjectionChart } from "@/components/charts/projection-chart";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
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
import { formatCurrency, formatDate, isMarginAccount } from "@/lib/metrics";
import { buildPositions } from "@/lib/positions";
import { valueYears, withValuations } from "@/lib/price-history";
import {
	snapshotAgeDays,
	sourceLabel,
	valuedBalances,
	valueWith,
} from "@/lib/price-snapshot";
import {
	depletionYear,
	type ProjectionInputs,
	projectSeries,
	roomLimitYears,
	usablePlans,
} from "@/lib/projection";
import { useDatasetStore } from "@/stores/dataset";
import { usePriceStore } from "@/stores/prices";
import { useProjectionStore } from "@/stores/projection";

/**
 * The analytics page: what the money is assumed to do next, and what it has
 * actually done so far.
 *
 * The projection is deliberately downstream of the history rather than beside
 * it. Its starting balances come from the same roll-up the investment page
 * shows, and the assumptions fold away inside the projection card: the shape is
 * what the reader came for, the inputs are what they come back for, and a page
 * that opens on a wall of sliders buries the answer under the question.
 */

export function AnalyticsOverview() {
	const dataset = useDatasetStore((state) => state.dataset);
	const snapshot = usePriceStore((state) => state.snapshot);
	const history = usePriceStore((state) => state.history);
	const inputs = useProjectionStore((state) => state.inputs);
	const overrides = useProjectionStore((state) => state.overrides);
	const mode = useProjectionStore((state) => state.mode);
	const plans = useProjectionStore((state) => state.plans);
	const hydrateProjection = useProjectionStore((state) => state.hydrate);

	const [showAssumptions, setShowAssumptions] = useState(false);
	const assumptionsId = useId();

	// Read here rather than in the root layout: nothing outside this page cares
	// about the assumptions, so nothing else should pay to load them.
	useEffect(() => {
		hydrateProjection();
	}, [hydrateProjection]);

	// Margin is left out of this page entirely. What it holds was bought with
	// borrowed money, so its balance is a loan the reader is carrying rather than
	// capital of theirs — compounding it forward at an equity return, or counting
	// its gains as a year's earnings, would report the broker's money as their
	// own. The filter is applied to the activities rather than to each table's
	// output so every figure below is measured over the same rows: the per-type
	// columns and the "All accounts" total still reconcile.
	const activities = useMemo(
		() =>
			dataset?.activities.filter(
				(activity) => !isMarginAccount(activity.accountType),
			) ?? [],
		[dataset],
	);

	const report = useMemo(
		() =>
			dataset ? buildPositions(activities, { sources: dataset.sources }) : null,
		[activities, dataset],
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

	// Which tab is open is a question for this page, not for the model: the lib
	// stays a pure function of what to project, and simple mode reaches it as an
	// absence of plans rather than as a flag it has to interpret.
	const effective = useMemo<ProjectionInputs>(
		() =>
			mode === "advanced"
				? { ...inputs, plans: usablePlans(plans, balances) }
				: inputs,
		[balances, inputs, mode, plans],
	);

	const points = useMemo(
		() => projectSeries(balances, effective),
		[balances, effective],
	);

	const coverage = dataset?.dateRange ?? { start: "", end: "" };

	// The expensive one on this page: a walk of the activity history per year,
	// so a year-end share count is derived rather than assumed. Keyed on the
	// history so it only re-runs when new closes arrive.
	const valuations = useMemo(
		() =>
			dataset
				? valueYears(activities, history, coverage)
				: new Map<string, never>(),
		[activities, coverage, dataset, history],
	);

	const totals = useMemo(
		() =>
			dataset && report
				? withValuations(yearTotals(activities, report, coverage), valuations)
				: [],
		[activities, coverage, dataset, report, valuations],
	);
	const stats = useMemo(
		() =>
			dataset && report
				? withValuations(
						yearAccountStats(activities, report, coverage),
						valuations,
					)
				: [],
		[activities, coverage, dataset, report, valuations],
	);

	if (!dataset || !report) return null;

	const currency = dataset.currencies[0] ?? "CAD";
	const horizon = points.at(-1);
	const depleted = depletionYear(points);
	const accountTypes = dataset.accountTypes
		.filter((accountType) => !isMarginAccount(accountType))
		.sort();

	// Rooms that fill up inside the horizon, as calendar years rather than
	// "year 4" — the axis is labelled in calendar years and the reader shouldn't
	// have to count forward from today to place the moment.
	const limits = roomLimitYears(points);
	const roomYears: Record<string, string> = {};
	for (const [type, year] of Object.entries(limits)) {
		const point = points.find((candidate) => candidate.year === year);
		if (point) roomYears[type] = point.date.slice(0, 4);
	}

	const unfunded = horizon?.unfunded ?? 0;
	const roomNotices = Object.entries(roomYears).map(([type, year]) => {
		const target = effective.plans?.[type]?.overflowTo ?? null;
		return target
			? `${type} runs out of contribution room in ${year} — contributions go to ${target} from then on.`
			: `${type} runs out of contribution room in ${year} — ${formatCurrency(unfunded, currency)} of what you planned to put in isn't projected after that.`;
	});

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
			} Chequing-style and margin accounts are left out: one holds money waiting to be spent, the other holdings bought with the broker's money — neither is capital of yours at work.`
		: "Taken from what you paid for your holdings plus the cash beside them. Your export carries no prices, so anything you've gained since buying isn't in these figures — fetch live prices from the sidebar, or type over any of them with the value your account actually shows. Chequing-style and margin accounts are left out: one holds money waiting to be spent, the other holdings bought with the broker's money — neither is capital of yours at work.";

	return (
		<div className="flex flex-1 flex-col gap-6">
			{/* The fetch that unlocks half the columns on this page is in the
			sidebar, in reach from here and from every other page it feeds. */}
			<h1 className="font-semibold text-lg">Analytics</h1>

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
					<CardAction>
						<Button
							aria-controls={assumptionsId}
							aria-expanded={showAssumptions}
							onClick={() => setShowAssumptions((shown) => !shown)}
							size="sm"
							variant="outline"
						>
							<SlidersHorizontal className="size-3.5" />
							{showAssumptions ? "Hide assumptions" : "Assumptions"}
						</Button>
					</CardAction>
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

					{/* What the reader typed can't always be honoured — an account with
					a contribution room fills up, and the money has to be accounted for
					wherever it ends up. */}
					{roomNotices.map((notice) => (
						<p className="text-muted-foreground text-sm" key={notice}>
							{notice}
						</p>
					))}

					{showAssumptions && (
						<div id={assumptionsId}>
							<AssumptionsPanel
								balances={balances}
								basis={basis}
								currency={currency}
								derived={derived}
								inputs={inputs}
								roomYears={roomYears}
							/>
						</div>
					)}
				</CardContent>
			</Card>

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
