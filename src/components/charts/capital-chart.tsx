"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, YAxis } from "recharts";
import {
	type DatePreset,
	resolveDateFrom,
} from "@/components/dashboard-filters";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { HeadlineValue } from "@/components/ui/figures";
import { type RangeOption, Segmented } from "@/components/ui/range-pills";
import {
	capitalOverTime,
	formatCurrency,
	formatDate,
	sinceDate,
} from "@/lib/metrics";
import type { Activity } from "@/lib/wealthsimple";

/**
 * The page's lead figure and the line behind it.
 *
 * A brokerage app puts *market value* here. This app cannot: the activities
 * export carries no prices and no position snapshot, so a value line would be
 * invented. What the file states exactly is how much capital has been put to
 * work and what it has paid out — so that is what this plots, and the caption
 * says so rather than letting the shape imply a valuation.
 */

const MEASURES = [
	{ value: "invested", label: "Invested" },
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
	invested: {
		label: "Invested",
		theme: { light: "#059669", dark: "#0aa876" },
	},
	income: { label: "Income", theme: { light: "#0284c7", dark: "#2b95dd" } },
} satisfies ChartConfig;

const CAPTIONS: Record<Measure, string> = {
	invested:
		"Cash you've put into the market, net of what selling returned. Not a valuation — your export contains no prices, so what these holdings are worth today isn't in it.",
	income: "Distributions, interest and bonuses received, added up over time.",
};

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
	label = "Invested to date",
}: CapitalChartProps) {
	const [measure, setMeasure] = useState<Measure>("invested");
	const [range, setRange] = useState<DatePreset>("all");

	const series = useMemo(() => capitalOverTime(activities), [activities]);
	const points = useMemo(
		() => sinceDate(series, resolveDateFrom(range, datasetEnd)),
		[series, range, datasetEnd],
	);

	const latest = series.at(-1);
	if (!latest || points.length === 0) return null;

	const headline = measure === "invested" ? latest.invested : latest.income;
	const first = points[0];
	const last = points.at(-1) ?? first;
	const change = (last[measure] ?? 0) - (first[measure] ?? 0);

	return (
		<section className="flex flex-col gap-5">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<HeadlineValue
					caption={CAPTIONS[measure]}
					currency={currency}
					label={measure === "invested" ? label : "Income to date"}
					value={headline}
				/>
				<Segmented
					aria-label="Measure"
					inset
					onChange={setMeasure}
					options={MEASURES}
					value={measure}
				/>
			</div>

			{/* No axes, no gridlines: the shape is the message, and the exact figure
			is on the tooltip and in the headline above. */}
			<ChartContainer
				className="aspect-auto h-56 w-full sm:h-64"
				config={chartConfig}
			>
				<AreaChart data={points} margin={{ left: 0, right: 0, top: 8 }}>
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
					</defs>
					{/* Hidden, but it still sets the domain — without it a nearly flat
					stretch would be drawn as a dramatic climb. */}
					<YAxis domain={["dataMin", "dataMax"]} hide type="number" />
					<ChartTooltip
						content={
							<ChartTooltipContent
								formatter={(value, name) => (
									<div className="flex flex-1 items-center justify-between gap-4 leading-none">
										<span className="text-muted-foreground">
											{chartConfig[name as Measure]?.label ?? name}
										</span>
										<span className="font-medium font-mono text-foreground tabular-nums">
											{formatCurrency(Number(value), currency)}
										</span>
									</div>
								)}
								indicator="dot"
								labelFormatter={(_, payload) =>
									formatDate(String(payload?.[0]?.payload?.date ?? ""))
								}
							/>
						}
					/>
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
				</AreaChart>
			</ChartContainer>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<Segmented
					aria-label="Time range"
					onChange={setRange}
					options={RANGES}
					value={range}
				/>
				<span className="text-muted-foreground text-sm">
					{range === "all" ? "Since" : "Change since"} {formatDate(first.date)}
					{range !== "all" && (
						<span className="ml-1.5 font-medium text-foreground tabular-nums">
							{change >= 0 ? "+" : "−"}
							{formatCurrency(Math.abs(change), currency)}
						</span>
					)}
				</span>
			</div>
		</section>
	);
}
