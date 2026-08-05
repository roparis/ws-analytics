"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { formatCurrency, isExternalMoneyMovement } from "@/lib/metrics";
import type { Activity } from "@/lib/wealthsimple";

/**
 * `filter` narrows a measure beyond its activity types. It exists so the
 * deposits measure can apply exactly the same exclusions as `computeKpis`'s
 * `moneyIn`/`moneyOut` — the KPI tiles and this chart render from the same
 * filtered array, so a looser rule here would show two numbers for one period.
 * Every entry declares the key (`null` when unused) to keep the union indexable.
 */
const MEASURES = {
	netCashFlow: { label: "Net cash flow", types: null, filter: null },
	deposits: {
		label: "Deposits & withdrawals",
		types: ["MoneyMovement"],
		filter: isExternalMoneyMovement,
	},
	trades: { label: "Trades", types: ["Trade"], filter: null },
	income: {
		label: "Dividends & income",
		types: ["Dividend", "BonusPayment", "Interest"],
		filter: null,
	},
	costs: {
		label: "Fees, interest & tax",
		types: ["Fee", "InterestCharged", "Tax", "AdministrativePayment"],
		filter: null,
	},
} as const;

type Measure = keyof typeof MEASURES;

const chartConfig = {
	value: { label: "Amount", color: "var(--chart-1)" },
} satisfies ChartConfig;

type Bucket = "day" | "month" | "quarter" | "year";

/**
 * Keeps the bar count readable at both ends: a 10-year export is 120 months,
 * while a single-month view would otherwise collapse into one bar.
 */
function pickBucket(activities: Activity[]): Bucket {
	if (activities.length === 0) return "month";
	let start = activities[0].transactionDate;
	let end = start;
	for (const activity of activities) {
		if (activity.transactionDate < start) start = activity.transactionDate;
		if (activity.transactionDate > end) end = activity.transactionDate;
	}
	const months =
		(Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
		(Number(end.slice(5, 7)) - Number(start.slice(5, 7)));

	// Only a one- or two-month window goes daily; a full quarter reads better as
	// months than as ~90 bars.
	if (months <= 1) return "day";
	if (months <= 36) return "month";
	if (months <= 96) return "quarter";
	return "year";
}

function bucketKey(date: string, bucket: Bucket): string {
	if (bucket === "day") return date;
	if (bucket === "year") return date.slice(0, 4);
	if (bucket === "month") return date.slice(0, 7);
	const quarter = Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
	return `${date.slice(0, 4)} Q${quarter}`;
}

function buildChartData(
	activities: Activity[],
	measure: Measure,
	bucket: Bucket,
) {
	const types: readonly string[] | null = MEASURES[measure].types;
	const filter: ((activity: Activity) => boolean) | null =
		MEASURES[measure].filter;
	const totals = new Map<string, number>();

	for (const activity of activities) {
		if (types && !types.includes(activity.activityType)) continue;
		if (filter && !filter(activity)) continue;
		const key = bucketKey(activity.transactionDate, bucket);
		if (!key) continue;
		totals.set(key, (totals.get(key) ?? 0) + activity.netCashAmount);
	}

	return [...totals.entries()]
		.map(([month, value]) => ({ month, value }))
		.sort((a, b) => a.month.localeCompare(b.month));
}

interface ActivityChartProps {
	activities: Activity[];
	currency: string;
}

export function ActivityChart({ activities, currency }: ActivityChartProps) {
	const [measure, setMeasure] = useState<Measure>("netCashFlow");

	const bucket = useMemo(() => pickBucket(activities), [activities]);
	const data = useMemo(
		() => buildChartData(activities, measure, bucket),
		[activities, measure, bucket],
	);

	return (
		<Card>
			<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<CardTitle>
					{
						{
							day: "Daily",
							month: "Monthly",
							quarter: "Quarterly",
							year: "Yearly",
						}[bucket]
					}{" "}
					cash flow
				</CardTitle>
				<Select
					onValueChange={(value) => value && setMeasure(value as Measure)}
					value={measure}
				>
					<SelectTrigger className="w-52" size="sm">
						<SelectValue>
							{(value) => MEASURES[value as Measure]?.label}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{Object.entries(MEASURES).map(([value, { label }]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</CardHeader>
			<CardContent>
				{data.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No activities match the current filters.
					</p>
				) : (
					<ChartContainer
						className="aspect-auto h-72 w-full"
						config={chartConfig}
					>
						<BarChart data={data}>
							<CartesianGrid vertical={false} />
							<XAxis
								axisLine={false}
								dataKey="month"
								tickLine={false}
								tickMargin={8}
							/>
							<YAxis
								axisLine={false}
								tickFormatter={(value: number) =>
									formatCurrency(value, currency)
								}
								tickLine={false}
								tickMargin={8}
								width={90}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										formatter={(value) =>
											formatCurrency(Number(value), currency)
										}
									/>
								}
							/>
							{/* Bars redraw on every filter change; animating them also breaks PDF capture. */}
							<Bar
								dataKey="value"
								fill="var(--color-value)"
								isAnimationActive={false}
								radius={4}
							/>
						</BarChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}
