"use client";

import { useId, useMemo } from "react";
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	XAxis,
	YAxis,
} from "recharts";
import {
	type AccountTypeSeries,
	compactCurrency,
	seriesConfig,
} from "@/components/charts/account-type-series";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/metrics";
import type { ProjectionPoint } from "@/lib/projection";

/**
 * The projection itself: each account type stacked on the ones below it, so the
 * bands add up to the total the reader is actually asking about, and a dashed
 * line marking how much of that total is their own money rather than growth.
 *
 * Areas are stacked rather than overlaid — unlike the year breakdown, these
 * series are parts of one sum, and drawing them from zero would hide the
 * smaller accounts behind the largest.
 */

const CONTRIBUTED_KEY = "contributed";

interface ProjectionChartProps {
	points: ProjectionPoint[];
	series: AccountTypeSeries[];
	currency: string;
}

export function ProjectionChart({
	currency,
	points,
	series,
}: ProjectionChartProps) {
	const gradientId = useId().replace(/:/g, "");

	const chartConfig = useMemo<ChartConfig>(() => {
		return {
			...seriesConfig(series),
			[CONTRIBUTED_KEY]: {
				label: "Money you put in",
				theme: { light: "#64748b", dark: "#94a3b8" },
			},
		};
	}, [series]);

	// Recharts wants one flat object per row, so the per-type map is spread out
	// into the positional keys the config was built with.
	const data = useMemo(
		() =>
			points.map((point) => {
				const row: Record<string, number | string> = {
					year: point.date.slice(0, 4),
					total: point.total,
					[CONTRIBUTED_KEY]: point.contributed,
				};
				for (const item of series) {
					row[item.key] = point.byType[item.accountType] ?? 0;
				}
				return row;
			}),
		[points, series],
	);

	if (data.length === 0 || series.length === 0) return null;

	const compact = compactCurrency(currency);

	return (
		<ChartContainer className="aspect-auto h-72 w-full" config={chartConfig}>
			<ComposedChart data={data} margin={{ left: 12, right: 12 }}>
				<defs>
					{series.map((item) => (
						<linearGradient
							id={`${gradientId}-${item.key}`}
							key={item.key}
							x1="0"
							x2="0"
							y1="0"
							y2="1"
						>
							<stop
								offset="5%"
								stopColor={`var(--color-${item.key})`}
								stopOpacity={0.7}
							/>
							<stop
								offset="95%"
								stopColor={`var(--color-${item.key})`}
								stopOpacity={0.25}
							/>
						</linearGradient>
					))}
				</defs>
				<CartesianGrid vertical={false} />
				<XAxis
					axisLine={false}
					dataKey="year"
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
							formatter={(value, name, item) => (
								<>
									<div
										className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
										style={{ backgroundColor: item?.color }}
									/>
									<div className="flex flex-1 items-center justify-between gap-4 leading-none">
										<span className="text-muted-foreground">
											{chartConfig[name as string]?.label ?? name}
										</span>
										<span className="font-medium font-mono text-foreground tabular-nums">
											{formatCurrency(Number(value), currency)}
										</span>
									</div>
								</>
							)}
							indicator="dot"
							labelFormatter={(label) => `In ${label}`}
						/>
					}
				/>
				<ChartLegend content={<ChartLegendContent />} />
				{series.map((item) => (
					<Area
						activeDot={{ r: 4, strokeWidth: 0 }}
						dataKey={item.key}
						dot={false}
						fill={`url(#${gradientId}-${item.key})`}
						isAnimationActive={false}
						key={item.key}
						stackId="balance"
						stroke={`var(--color-${item.key})`}
						strokeWidth={2}
						type="monotone"
					/>
				))}
				{/* The honest counterweight to a climbing stack: everything above this
				line is growth the reader assumed, not money they have. */}
				<Line
					dataKey={CONTRIBUTED_KEY}
					dot={false}
					isAnimationActive={false}
					stroke={`var(--color-${CONTRIBUTED_KEY})`}
					strokeDasharray="4 4"
					strokeWidth={2}
					type="monotone"
				/>
			</ComposedChart>
		</ChartContainer>
	);
}
