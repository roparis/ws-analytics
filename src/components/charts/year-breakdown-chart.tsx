"use client";

import { useId, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { breakdownByYear, formatCurrency } from "@/lib/metrics";
import type { Activity } from "@/lib/wealthsimple";

/**
 * Light and dark steps are the same four hues at different points on their ramp,
 * each chosen against its own surface rather than flipped, and checked for
 * colour-vision separation across every pair — the areas overlap, so any two of
 * them can end up adjacent. Green for income and red for cost are fixed by the
 * rest of the app and are the tightest pair, so each series also carries a solid
 * 2px stroke and is named in the legend and the tooltip; identity never rests on
 * fill colour alone.
 */
const chartConfig = {
	bought: {
		label: "Bought",
		theme: { light: "#0284c7", dark: "#2b95dd" },
	},
	sold: { label: "Sold", theme: { light: "#7c3aed", dark: "#8b5cf6" } },
	dividends: {
		label: "Dividends",
		theme: { light: "#059669", dark: "#0aa876" },
	},
	fees: { label: "Fees & tax", theme: { light: "#dc2626", dark: "#ef4444" } },
} satisfies ChartConfig;

const SERIES = ["bought", "sold", "dividends", "fees"] as const;
type SeriesKey = (typeof SERIES)[number];

interface YearBreakdownChartProps {
	activities: Activity[];
	currency: string;
}

export function YearBreakdownChart({
	activities,
	currency,
}: YearBreakdownChartProps) {
	// Gradient ids are document-wide, so namespace them — this chart renders on a
	// page that already has another one.
	const gradientId = useId().replace(/:/g, "");
	const data = useMemo(() => breakdownByYear(activities), [activities]);

	// Each area is drawn from zero and overlaps the others, so whichever is
	// painted last sits on top. Fees and dividends are an order of magnitude
	// smaller than trades, and would be buried under them at a fixed order —
	// painting biggest first keeps every series visible whatever the data does.
	const paintOrder = useMemo(() => {
		const total = (key: SeriesKey) =>
			data.reduce((sum, row) => sum + row[key], 0);
		return [...SERIES].sort((a, b) => total(b) - total(a));
	}, [data]);

	// A chequing-style account type has no trades, dividends or fees at all —
	// four empty series would render as a blank grid, so show nothing instead.
	const hasValues = data.some(
		(row) => row.bought || row.sold || row.dividends || row.fees,
	);
	if (!hasValues) return null;

	const range =
		data.length > 1
			? `${data[0].year} – ${data[data.length - 1].year}`
			: data[0].year;

	// Axis ticks are compact ($19.6K) so the scale stays readable; the tooltip
	// carries the exact amount.
	const compact = (value: number) =>
		new Intl.NumberFormat("en-CA", {
			style: "currency",
			currency,
			notation: "compact",
			maximumFractionDigits: 1,
		}).format(value);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Bought, sold and earned by year</CardTitle>
				<CardDescription>
					Gross buys and sells, not netted against each other — trading
					activity, not money added · {range}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ChartContainer
					className="aspect-auto h-72 w-full"
					config={chartConfig}
				>
					<AreaChart data={data} margin={{ left: 12, right: 12 }}>
						<defs>
							{SERIES.map((key) => (
								<linearGradient
									id={`${gradientId}-${key}`}
									key={key}
									x1="0"
									x2="0"
									y1="0"
									y2="1"
								>
									<stop
										offset="5%"
										stopColor={`var(--color-${key})`}
										stopOpacity={0.5}
									/>
									<stop
										offset="95%"
										stopColor={`var(--color-${key})`}
										stopOpacity={0.05}
									/>
								</linearGradient>
							))}
						</defs>
						<CartesianGrid vertical={false} />
						<XAxis
							axisLine={false}
							dataKey="year"
							// Recharts drops the first tick by default, which loses the
							// earliest year in the export.
							interval="preserveStartEnd"
							tickLine={false}
							tickMargin={8}
						/>
						<YAxis
							axisLine={false}
							tickFormatter={compact}
							tickLine={false}
							tickMargin={8}
							width={64}
						/>
						<ChartTooltip
							content={
								<ChartTooltipContent
									// The default row prints a bare number, so rebuild it to keep
									// each series' swatch and name beside a formatted amount.
									formatter={(value, name, item) => (
										<>
											<div
												className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
												style={{ backgroundColor: item?.color }}
											/>
											<div className="flex flex-1 items-center justify-between gap-4 leading-none">
												<span className="text-muted-foreground">
													{chartConfig[name as keyof typeof chartConfig]
														?.label ?? name}
												</span>
												<span className="font-medium font-mono text-foreground tabular-nums">
													{formatCurrency(Number(value), currency)}
												</span>
											</div>
										</>
									)}
									indicator="dot"
								/>
							}
						/>
						<ChartLegend content={<ChartLegendContent />} />
						{paintOrder.map((key) => (
							<Area
								activeDot={{ r: 4, strokeWidth: 0 }}
								dataKey={key}
								dot={false}
								fill={`url(#${gradientId}-${key})`}
								isAnimationActive={false}
								key={key}
								stroke={`var(--color-${key})`}
								strokeWidth={2}
								type="natural"
							/>
						))}
					</AreaChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}
