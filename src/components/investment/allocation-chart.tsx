"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
import { formatCurrency } from "@/lib/metrics";
import type { AccountTypeRollup } from "@/lib/positions";

/**
 * Where the money sits, and what currency it is really exposed to.
 *
 * The second half is the reason this chart exists: the export marks US-listed
 * trades with an FX rate and TSX-listed ones with nothing, which makes currency
 * exposure a hard fact rather than an estimate — and it is a fact no other
 * screen in the app surfaces. Book cost, not market value: the file has no
 * prices, and the sheet export is where that gap is filled.
 *
 * Three hues at separated lightness steps, distinct under the common colour
 * vision deficiencies, and each named in the legend and the tooltip so identity
 * never rests on fill alone.
 */
const chartConfig = {
	ca: {
		label: "Canadian-listed",
		theme: { light: "#0284c7", dark: "#2b95dd" },
	},
	us: { label: "US-listed", theme: { light: "#7c3aed", dark: "#8b5cf6" } },
	crypto: { label: "Crypto", theme: { light: "#d97706", dark: "#f59e0b" } },
	unknown: { label: "Unknown", theme: { light: "#64748b", dark: "#94a3b8" } },
} satisfies ChartConfig;

const SERIES = ["ca", "us", "crypto", "unknown"] as const;

interface AllocationChartProps {
	byAccountType: AccountTypeRollup[];
	currency: string;
}

export function AllocationChart({
	byAccountType,
	currency,
}: AllocationChartProps) {
	const data = useMemo(
		() =>
			byAccountType
				.filter((row) => row.bookCost > 0)
				.map((row) => ({
					accountType: row.accountType,
					ca: row.bookCostByListing.ca,
					us: row.bookCostByListing.us,
					crypto: row.bookCostByListing.crypto,
					unknown: row.bookCostByListing.unknown,
				})),
		[byAccountType],
	);

	// Only render the segments that actually carry money — an all-Canadian
	// portfolio shouldn't get three empty legend entries.
	const series = useMemo(
		() => SERIES.filter((key) => data.some((row) => row[key] > 0)),
		[data],
	);

	// Nothing bought yet, or only cash accounts: a blank grid says less than
	// showing nothing at all.
	if (data.length === 0 || series.length === 0) return null;

	const usTotal = data.reduce((total, row) => total + row.us, 0);
	const grandTotal = data.reduce(
		(total, row) => total + row.ca + row.us + row.crypto + row.unknown,
		0,
	);
	const usShare = grandTotal > 0 ? Math.round((usTotal / grandTotal) * 100) : 0;

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
				<CardTitle>Where your money sits</CardTitle>
				<CardDescription>
					Book cost by account type, split by where each security trades.
					{usShare > 0
						? ` ${usShare}% of it is in US-listed securities, so that much is exposed to the US dollar.`
						: " Everything is Canadian-listed, so none of it carries currency risk."}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ChartContainer
					className="aspect-auto w-full"
					config={chartConfig}
					style={{ height: `${Math.max(data.length * 48 + 80, 200)}px` }}
				>
					<BarChart
						data={data}
						layout="vertical"
						margin={{ left: 12, right: 12 }}
					>
						<CartesianGrid horizontal={false} />
						<XAxis
							axisLine={false}
							tickFormatter={compact}
							tickLine={false}
							tickMargin={8}
							type="number"
						/>
						<YAxis
							axisLine={false}
							dataKey="accountType"
							tickLine={false}
							tickMargin={8}
							type="category"
							width={140}
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
						{series.map((key) => (
							<Bar
								dataKey={key}
								fill={`var(--color-${key})`}
								isAnimationActive={false}
								key={key}
								radius={2}
								stackId="listing"
							/>
						))}
					</BarChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}
