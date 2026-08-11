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

/** Where a series' net deposits ride along in the row, unplotted. */
const depositKey = (key: string) => `${key}__in`;

/**
 * The tooltip's two money columns. Fixed minimums rather than content widths,
 * so the figures line up down the column instead of stepping in and out with
 * the length of each account's name.
 */
const IN_COLUMN = "min-w-24 shrink-0 text-right tabular-nums";
const VALUE_COLUMN = "min-w-28 shrink-0 text-right tabular-nums";

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
	// into the positional keys the config was built with. Each series carries a
	// second key holding what went into that account, which nothing plots — the
	// tooltip reads it to show growth beside the money that bought it.
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
					row[depositKey(item.key)] =
						point.contributedByType[item.accountType] ?? 0;
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
							formatter={(value, name, item) =>
								// The dashed line's row carries the two columns' totals and
								// nothing else: the rule above it and the column headings have
								// already said what they are, and a label would only repeat
								// the heading a row later.
								name === CONTRIBUTED_KEY ? (
									<div className="flex w-full items-center gap-4 border-border/60 border-t pt-1.5 leading-none">
										<span className="flex-1" />
										<span
											className={`${IN_COLUMN} font-mono text-muted-foreground`}
										>
											{formatCurrency(Number(value), currency)}
										</span>
										<span
											className={`${VALUE_COLUMN} font-medium font-mono text-foreground`}
										>
											{formatCurrency(
												Number(item?.payload?.total ?? 0),
												currency,
											)}
										</span>
									</div>
								) : (
									<>
										<div
											className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
											style={{ backgroundColor: item?.color }}
										/>
										<div className="flex flex-1 items-center gap-4 leading-none">
											<span className="flex-1 text-muted-foreground">
												{chartConfig[name as string]?.label ?? name}
											</span>
											<span
												className={`${IN_COLUMN} font-mono text-muted-foreground`}
											>
												{formatCurrency(
													Number(
														item?.payload?.[depositKey(String(name))] ?? 0,
													),
													currency,
												)}
											</span>
											<span
												className={`${VALUE_COLUMN} font-medium font-mono text-foreground`}
											>
												{formatCurrency(Number(value), currency)}
											</span>
										</div>
									</>
								)
							}
							indicator="dot"
							labelFormatter={(label) => (
								// The captions ride on the label row: they name both columns
								// once, and "estimated" belongs on the heading rather than on
								// every figure under it.
								<div className="flex w-full items-center gap-4">
									<span className="flex-1">In {label}</span>
									<span
										className={`${IN_COLUMN} font-normal text-muted-foreground text-xs`}
									>
										Put in
									</span>
									<span
										className={`${VALUE_COLUMN} font-normal text-muted-foreground text-xs`}
									>
										Estimated value
									</span>
								</div>
							)}
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
				line is growth the reader assumed, not money they have. Its tooltip row
				is the totals line, because what it plots is exactly the sum of the
				deposit column. */}
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
