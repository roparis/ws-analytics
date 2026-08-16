"use client";

import { useMemo, useState } from "react";
import { Area, ComposedChart, Line, YAxis } from "recharts";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
} from "@/components/ui/chart";
import { Amount, HeadlineValue } from "@/components/ui/figures";
import { type RangeOption, Segmented } from "@/components/ui/range-pills";
import { type DatePreset, resolveDateFrom } from "@/lib/date-range";
import {
	type CapitalPoint,
	capitalOverTime,
	formatCurrency,
	formatDate,
	sinceDate,
} from "@/lib/metrics";
import { buildPositions } from "@/lib/positions";
import { type ValuePoint, valueOverTime } from "@/lib/price-history";
import { sourceLabel, valueWith } from "@/lib/price-snapshot";
import type { Activity } from "@/lib/wealthsimple";
import { usePriceStore } from "@/stores/prices";

/**
 * The page's lead figure and the lines behind it.
 *
 * A brokerage app puts *market value* here, and until prices existed this app
 * could not: the activities export carries no prices and no position snapshot,
 * so a value line would have been invented. With a price history loaded it is
 * no longer invented — the shares come from re-walking the activities and the
 * prices are Yahoo's monthly closes — so the value line is drawn *beside* what
 * went in rather than instead of it. Two lines in one frame: net deposits, and
 * what they came to, with the gap between them shaded, because that gap is the
 * whole story. Net deposits rather than capital deployed on purpose: value
 * counts the cash sitting in the accounts, so the baseline has to be money
 * crossing the portfolio's boundary, not money moving inside it.
 *
 * The reading order follows the brokerage convention it is being compared
 * against: value is the solid coloured line, what you put in is a dashed grey
 * baseline, and both figures sit in a key that follows the cursor rather than
 * in a card that covers the chart.
 *
 * Without prices this renders exactly as it always did, single line and all,
 * and the caption still says why.
 */

const MEASURES = [
	{ value: "deposits", label: "Net deposits" },
	{ value: "income", label: "Income" },
] as const;

type Measure = (typeof MEASURES)[number]["value"];

const RANGES: readonly RangeOption<DatePreset>[] = [
	{ value: "30d", label: "1M" },
	{ value: "3m", label: "3M" },
	{ value: "6m", label: "6M" },
	{ value: "ytd", label: "YTD" },
	{ value: "12m", label: "1Y" },
	{ value: "all", label: "ALL" },
];

const chartConfig = {
	deposits: {
		label: "Net deposits",
		theme: { light: "#7c3aed", dark: "#8b5cf6" },
	},
	income: { label: "Income", theme: { light: "#0284c7", dark: "#2b95dd" } },
	value: { label: "Value", theme: { light: "#059669", dark: "#0aa876" } },
	// What went in, once there is a value line to read it against. It stops
	// being a headline series at that point and becomes the baseline the green
	// line is measured from, so it drops to grey and gives up its fill.
	basis: {
		label: "Net deposits",
		theme: { light: "#64748b", dark: "#94a3b8" },
	},
} satisfies ChartConfig;

const CAPTIONS: Record<Measure, string> = {
	deposits:
		"Money you've moved in from outside, net of what you've taken back out. Not a valuation — your export contains no prices, so what your holdings are worth today isn't in it.",
	income: "Distributions, interest and bonuses received, added up over time.",
};

/** A capital point that may also carry the valuation for that date. */
interface ChartPoint extends CapitalPoint {
	value?: number;
}

interface CapitalChartProps {
	activities: Activity[];
	currency: string;
	datasetEnd: string;
	label?: string;
}

export function CapitalChart({
	activities,
	currency,
	datasetEnd,
	label = "Net deposits to date",
}: CapitalChartProps) {
	const [measure, setMeasure] = useState<Measure>("deposits");
	const [range, setRange] = useState<DatePreset>("all");
	const [hovered, setHovered] = useState<number | null>(null);
	const history = usePriceStore((state) => state.history);
	const snapshot = usePriceStore((state) => state.snapshot);

	const series = useMemo(() => capitalOverTime(activities), [activities]);

	// A hundred-odd walks of the activity history on a decade-long export, so it
	// is computed once per dataset and price history, never per render.
	const values = useMemo(
		() => valueOverTime(activities, history),
		[activities, history],
	);

	// Today's quote, valued the same way the investment page's tiles are, so the
	// line ends on the number they show.
	const today = useMemo(() => {
		if (!snapshot || values.length === 0) return null;
		const valued = valueWith(buildPositions(activities), snapshot);
		if (!valued || valued.pricedCount === 0) return null;

		return {
			date: snapshot.asOf,
			value: valued.byAccountType.reduce(
				(sum, row) =>
					sum + row.marketValue + row.unpricedBookCost + row.cashBalance,
				0,
			),
			// Today's quote and the monthly history are two requests, and either can
			// come back short. A holding the quote missed sits at book cost in the
			// final point alone, which is a visible step the reader is owed.
			missing: valued.missingSymbols,
		};
	}, [activities, snapshot, values.length]);

	const merged = useMemo(
		() => mergeValues(series, values, today),
		[series, values, today],
	);

	const points = useMemo(
		() => sinceDate(merged, resolveDateFrom(range, datasetEnd)),
		[merged, range, datasetEnd],
	);

	const latest = series.at(-1);
	if (!latest || points.length === 0) return null;

	// Only the deposits view gains the second line: income is a cash figure with
	// no valuation to compare it against.
	const valued = measure === "deposits" && values.length > 0;
	const latestValue = today?.value ?? values.at(-1)?.value ?? 0;
	// Read off the end of the line, not the whole series: Yahoo's monthly bars
	// start at the month *after* the range opens, so every history is missing its
	// first month and saying so every time would be noise. What matters is a
	// holding the line still can't price.
	const missing = valued
		? [
				...new Set([
					...(values.at(-1)?.missingSymbols ?? []),
					...(today?.missing ?? []),
				]),
			].sort()
		: [];

	const headline = measure === "deposits" ? latest.deposits : latest.income;
	const first = points[0];
	const last = points.at(-1) ?? first;
	// The figure above the chart is what the window's change should be measured
	// in: quoting the change in net deposits under a "Worth today" headline would
	// read as the change in value.
	const window = valued ? valueWindow(points) : null;
	const change = window
		? window.change
		: (last[measure] ?? 0) - (first[measure] ?? 0);

	// The key reads the point under the cursor, and the latest one otherwise —
	// which is why the chart needs no tooltip card sitting over the line.
	const at = hovered === null ? points.length - 1 : hovered;
	const cursor = points[at] ?? last;
	const keys = valued
		? [
				// The value line is anchored monthly and drawn across the gaps, so the
				// key reads the same way: the last close on or before the cursor,
				// rather than a blank on every day that isn't a month end.
				{ key: "value" as const, label: "Value", value: valueAt(points, at) },
				{
					key: "basis" as const,
					label: "Net deposits",
					value: cursor.deposits,
				},
			]
		: [];

	return (
		<section className="flex flex-col gap-5">
			<div className="flex flex-wrap items-start justify-between gap-4">
				{valued ? (
					<HeadlineValue
						caption={`Your holdings and the cash beside them, priced against ${snapshot ? sourceLabel(snapshot) : "the closes"}. You've put in ${formatCurrency(latest.deposits, currency)} — the green line is what that came to.`}
						currency={currency}
						label={today ? "Worth today" : "Worth at the last close"}
						value={latestValue}
					/>
				) : (
					<HeadlineValue
						caption={CAPTIONS[measure]}
						currency={currency}
						label={measure === "deposits" ? label : "Income to date"}
						value={headline}
					/>
				)}
				<div className="flex flex-col items-end gap-3">
					<Segmented
						aria-label="Measure"
						inset
						onChange={setMeasure}
						options={MEASURES}
						value={measure}
					/>
					{/* Only with two lines to tell apart: on its own the deposits line
					is already named by the headline right beside it. */}
					{keys.length > 0 && (
						<ChartKey
							currency={currency}
							date={hovered === null ? null : cursor.date}
							items={keys}
						/>
					)}
				</div>
			</div>

			{/* No axes, no gridlines: the shape is the message, and the figures are
			in the key above, which the cursor keeps up to date. */}
			<ChartContainer
				className="aspect-auto h-56 w-full sm:h-64"
				config={chartConfig}
			>
				<ComposedChart
					data={points}
					margin={{ left: 0, right: 0, top: 8 }}
					onMouseLeave={() => setHovered(null)}
					onMouseMove={(state) => {
						// Recharts hands this back as a number, a string index or null
						// depending on where the pointer is, so it is narrowed rather
						// than trusted.
						const active = state?.activeTooltipIndex;
						const index =
							active === null || active === undefined
								? Number.NaN
								: Number(active);
						setHovered(Number.isInteger(index) ? index : null);
					}}
				>
					<defs>
						<linearGradient id="capital-fill" x1="0" x2="0" y1="0" y2="1">
							<stop
								offset="5%"
								stopColor={`var(--color-${measure})`}
								stopOpacity={0.25}
							/>
							<stop
								offset="95%"
								stopColor={`var(--color-${measure})`}
								stopOpacity={0}
							/>
						</linearGradient>
						{/* Hung off the value line and fading all the way down, the way an
						area chart's fill does. */}
						<linearGradient id="value-fill" x1="0" x2="0" y1="0" y2="1">
							<stop
								offset="5%"
								stopColor="var(--color-value)"
								stopOpacity={0.3}
							/>
							<stop
								offset="95%"
								stopColor="var(--color-value)"
								stopOpacity={0}
							/>
						</linearGradient>
					</defs>
					{/* Hidden, but it still sets the domain — without it a nearly flat
					stretch would be drawn as a dramatic climb. */}
					<YAxis domain={["dataMin", "dataMax"]} hide type="number" />
					{/* Renders nothing: it is here for the cursor line and the dots it
					puts on each series, while the figures go to the key above. */}
					<ChartTooltip
						content={() => null}
						cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
					/>
					{valued ? (
						<>
							{/* The value line's own fill, running all the way to the floor and
							fading as it goes. The dashed baseline is drawn over the top of
							it rather than cutting it off — the gradient is the value line's,
							not the gap's. */}
							<Area
								connectNulls
								dataKey="value"
								fill="url(#value-fill)"
								fillOpacity={1}
								isAnimationActive={false}
								stroke="none"
								type="monotone"
							/>
							<Line
								activeDot={{ r: 4, strokeWidth: 0 }}
								dataKey="deposits"
								dot={false}
								isAnimationActive={false}
								stroke="var(--color-basis)"
								strokeDasharray="5 4"
								strokeWidth={1.5}
								type="monotone"
							/>
							{/* One value per month against one point per active day, so the
							gaps are bridged rather than drawn as a dotted mess. */}
							<Line
								activeDot={{ r: 4, strokeWidth: 0 }}
								connectNulls
								dataKey="value"
								dot={false}
								isAnimationActive={false}
								stroke="var(--color-value)"
								strokeWidth={2}
								type="monotone"
							/>
						</>
					) : (
						<Area
							activeDot={{ r: 4, strokeWidth: 0 }}
							dataKey={measure}
							dot={false}
							fill="url(#capital-fill)"
							isAnimationActive={false}
							stroke={`var(--color-${measure})`}
							strokeWidth={2}
							type="monotone"
						/>
					)}
				</ComposedChart>
			</ChartContainer>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<Segmented
					aria-label="Time range"
					onChange={setRange}
					options={RANGES}
					value={range}
				/>
				<span className="text-muted-foreground text-sm">
					{range === "all" ? "Since" : "Change since"}{" "}
					{formatDate(
						range === "all" ? first.date : (window?.from ?? first.date),
					)}
					{range !== "all" && (
						<span className="ml-1.5 font-medium text-foreground tabular-nums">
							{change >= 0 ? "+" : "−"}
							{formatCurrency(Math.abs(change), currency)}
						</span>
					)}
				</span>
			</div>

			{missing.length > 0 && (
				<p className="text-muted-foreground text-xs">
					No price for {missing.join(", ")}, so the line carries{" "}
					{missing.length === 1 ? "it" : "them"} at what you paid rather than at
					zero.
				</p>
			)}
		</section>
	);
}

interface KeyItem {
	/** A `chartConfig` key, so the swatch is drawn in the series' own colour. */
	key: keyof typeof chartConfig;
	label: string;
	value: number | undefined;
}

/**
 * What each line is worth, at the cursor or at the end of the window.
 *
 * This is the tooltip, moved somewhere it never covers the line it describes.
 * The date only appears while the cursor is on the chart — with it gone, these
 * are the latest figures and saying so twice would be noise.
 */
function ChartKey({
	currency,
	date,
	items,
}: {
	currency: string;
	date: string | null;
	items: KeyItem[];
}) {
	return (
		<div className="flex flex-col items-end gap-0.5">
			<div className="flex flex-wrap justify-end gap-x-6 gap-y-2">
				{items.map((item) => (
					<div className="flex flex-col gap-0.5" key={item.key}>
						<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
							<Swatch dashed={item.key === "basis"} name={item.key} />
							{item.label}
						</span>
						{item.value === undefined ? (
							// Before the first close the history reaches. A dash, because
							// there is genuinely no answer — not a zero.
							<span className="font-medium text-muted-foreground text-sm">
								—
							</span>
						) : (
							<Amount
								className="font-medium text-foreground text-sm"
								currency={currency}
								value={item.value}
							/>
						)}
					</div>
				))}
			</div>
			{/* Held in the layout rather than mounted on hover, so the key doesn't
			jump a line the moment the cursor touches the chart. */}
			<span className="h-4 text-muted-foreground text-xs">
				{date ? formatDate(date) : ""}
			</span>
		</div>
	);
}

/** The last close on or before a point, since only month ends carry one. */
function valueAt(points: ChartPoint[], index: number): number | undefined {
	for (let i = Math.min(index, points.length - 1); i >= 0; i -= 1) {
		const value = points[i].value;
		if (value !== undefined) return value;
	}
	return undefined;
}

/** The line sample the key names each series by. */
function Swatch({ dashed, name }: { dashed: boolean; name: string }) {
	return (
		<svg
			aria-hidden="true"
			className="h-2 w-4 overflow-visible"
			style={{ color: `var(--color-${name})` }}
			viewBox="0 0 16 8"
		>
			<line
				stroke="currentColor"
				strokeDasharray={dashed ? "3 2" : undefined}
				strokeWidth={dashed ? 1.5 : 2}
				x1="0"
				x2="16"
				y1="4"
				y2="4"
			/>
			<circle
				cx="8"
				cy="4"
				fill="var(--card, var(--background))"
				r="2.5"
				stroke="currentColor"
				strokeWidth={dashed ? 1.5 : 2}
			/>
		</svg>
	);
}

/**
 * Folds the monthly valuations into the daily capital series.
 *
 * The two run at different rhythms — one point per day that had activity, one
 * value per month end — so the union of their dates is plotted and the running
 * totals are carried onto the dates they don't have of their own. Without that
 * carry, a month end with no activity would break the deposits line.
 */
function mergeValues(
	series: CapitalPoint[],
	values: ValuePoint[],
	today: { date: string; value: number } | null,
): ChartPoint[] {
	if (values.length === 0) return series;

	const byDate = new Map<string, number>();
	for (const point of values) byDate.set(point.date, point.value);
	if (today) byDate.set(today.date, today.value);

	const dates = [...new Set([...series.map((p) => p.date), ...byDate.keys()])]
		.sort()
		// A valuation before the first activity would be an empty portfolio, and
		// a line running along zero to reach it says nothing.
		.filter((date) => date >= (series[0]?.date ?? date));

	const merged: ChartPoint[] = [];
	let index = 0;
	let carried: CapitalPoint | null = null;

	for (const date of dates) {
		while (index < series.length && series[index].date <= date) {
			carried = series[index];
			index += 1;
		}
		if (!carried) continue;

		const value = byDate.get(date);
		merged.push(
			value === undefined ? { ...carried, date } : { ...carried, date, value },
		);
	}

	return merged;
}

/**
 * How much the value line moved across the window, and the date it moved from.
 *
 * That date is reported rather than assumed to be the window's first day: the
 * value line is anchored monthly, so a range usually opens before its first
 * anchor. Null when the window holds fewer than two anchors — one point is a
 * level, not a change.
 */
function valueWindow(
	points: ChartPoint[],
): { from: string; change: number } | null {
	const anchors = points.filter((point) => point.value !== undefined);
	if (anchors.length < 2) return null;

	return {
		from: anchors[0].date,
		change: (anchors.at(-1)?.value ?? 0) - (anchors[0].value ?? 0),
	};
}
