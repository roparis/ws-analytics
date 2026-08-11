"use client";

import { useMemo, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	ReferenceLine,
	XAxis,
	YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
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
	ChartTooltip,
} from "@/components/ui/chart";
import { formatCurrency, groupByMonth } from "@/lib/metrics";
import type { Activity } from "@/lib/wealthsimple";

/**
 * Deposits run to thousands while income and fees run to tens, so the three
 * can't share a y-axis without flattening the smaller two into the baseline —
 * and a second axis would invent a correlation that isn't in the data. Small
 * multiples instead: one panel per measure, each with its own scale, stacked on
 * a shared month axis so the periods still line up for comparison.
 */
const chartConfig = {
	deposits: {
		label: "Net deposits",
		theme: { light: "#0284c7", dark: "#2b95dd" },
	},
	income: { label: "Income", theme: { light: "#059669", dark: "#0aa876" } },
	fees: { label: "Fees & tax", theme: { light: "#dc2626", dark: "#ef4444" } },
} satisfies ChartConfig;

/**
 * Heights are per-panel, not uniform. A single rebalance month can be ten times
 * a routine contribution, so at a shared height the regular monthly funding —
 * the thing you actually want to read — collapses into a hairline against the
 * outlier. Deposits get the most room and an extra tick because it is the only
 * measure that swings both ways; the last panel carries the month labels and
 * needs the extra band for them.
 */
const PANELS = [
	{
		key: "deposits",
		height: "h-32",
		ticks: 4,
		// `--color-*` is scoped to ChartContainer, and this swatch sits outside it
		// in the label row, so it carries the same two steps explicitly.
		swatch: "bg-[#0284c7] dark:bg-[#2b95dd]",
	},
	{
		key: "income",
		height: "h-24",
		ticks: 3,
		swatch: "bg-[#059669] dark:bg-[#0aa876]",
	},
	{
		key: "fees",
		height: "h-32",
		ticks: 3,
		swatch: "bg-[#dc2626] dark:bg-[#ef4444]",
	},
] as const;
type PanelKey = (typeof PANELS)[number]["key"];

interface MonthRow {
	key: string;
	label: string;
	tick: string;
	deposits: number;
	income: number;
	fees: number;
	net: number;
}

/** `2026-06` -> `Jun 26`, short enough to sit under a bar. */
function tickLabel(key: string): string {
	const date = new Date(`${key}-01T00:00:00`);
	return `${date.toLocaleDateString("en-CA", { month: "short" })} ${key.slice(2, 4)}`;
}

function MonthTooltip({
	active,
	payload,
	currency,
}: {
	active?: boolean;
	payload?: { payload: MonthRow }[];
	currency: string;
}) {
	const row = payload?.[0]?.payload;
	if (!active || !row) return null;

	// Every panel shows the same four figures, so hovering anywhere gives the
	// whole month rather than just the measure under the cursor.
	const lines: { key: PanelKey | "net"; label: string; value: number }[] = [
		{ key: "deposits", label: "Net deposits", value: row.deposits },
		{ key: "income", label: "Income", value: row.income },
		{ key: "fees", label: "Fees & tax", value: row.fees },
		{ key: "net", label: "Net", value: row.net },
	];

	return (
		<div className="grid min-w-44 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
			<span className="font-medium">{row.label}</span>
			{lines.map((line) => (
				<div className="flex items-center gap-2 leading-none" key={line.key}>
					{line.key === "net" ? (
						<span className="size-2.5 shrink-0" />
					) : (
						<span
							className="size-2.5 shrink-0 rounded-[2px]"
							style={{ backgroundColor: `var(--color-${line.key})` }}
						/>
					)}
					<span className="flex flex-1 items-center justify-between gap-4">
						<span className="text-muted-foreground">{line.label}</span>
						<span className="font-medium font-mono tabular-nums">
							{formatCurrency(line.value, currency)}
						</span>
					</span>
				</div>
			))}
		</div>
	);
}

interface MonthBreakdownChartProps {
	activities: Activity[];
	currency: string;
}

export function MonthBreakdownChart({
	activities,
	currency,
}: MonthBreakdownChartProps) {
	const [showTable, setShowTable] = useState(false);

	// `groupByMonth` is newest-first for the timeline feed; a time axis reads
	// oldest-left.
	const data = useMemo<MonthRow[]>(
		() =>
			groupByMonth(activities)
				.map((month) => ({
					key: month.key,
					label: month.label,
					tick: tickLabel(month.key),
					deposits: month.kpis.netDeposits,
					income: month.kpis.income,
					// `costs` is a positive magnitude; show it as money leaving.
					fees: -month.kpis.costs,
					net: month.kpis.netCashFlow,
				}))
				.reverse(),
		[activities],
	);

	if (data.length === 0) return null;

	const totals = {
		deposits: data.reduce((sum, row) => sum + row.deposits, 0),
		income: data.reduce((sum, row) => sum + row.income, 0),
		fees: data.reduce((sum, row) => sum + row.fees, 0),
	};

	const range =
		data.length > 1
			? `${data[0].label} – ${data[data.length - 1].label}`
			: data[0].label;

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
				<div className="flex items-start justify-between gap-4">
					<div className="flex flex-col gap-1.5">
						<CardTitle>By month</CardTitle>
						<CardDescription>
							Each measure on its own scale · {range}
						</CardDescription>
					</div>
					<Button
						className="shrink-0"
						onClick={() => setShowTable((shown) => !shown)}
						size="sm"
						variant="outline"
					>
						{showTable ? "Show chart" : "Show table"}
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{showTable ? (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-muted-foreground text-xs">
									<th className="py-1 text-left font-medium">Month</th>
									<th className="py-1 text-right font-medium">Net deposits</th>
									<th className="py-1 text-right font-medium">Income</th>
									<th className="py-1 text-right font-medium">Fees & tax</th>
									<th className="py-1 text-right font-medium">Net</th>
								</tr>
							</thead>
							<tbody>
								{[...data].reverse().map((row) => (
									<tr key={row.key}>
										<td className="py-1">{row.label}</td>
										<td className="py-1 text-right tabular-nums">
											{formatCurrency(row.deposits, currency)}
										</td>
										<td className="py-1 text-right tabular-nums">
											{formatCurrency(row.income, currency)}
										</td>
										<td className="py-1 text-right tabular-nums">
											{formatCurrency(row.fees, currency)}
										</td>
										<td className="py-1 text-right tabular-nums">
											{formatCurrency(row.net, currency)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="flex flex-col gap-1">
						{PANELS.map(({ key, height, ticks, swatch }, index) => {
							const isLast = index === PANELS.length - 1;
							return (
								<div key={key}>
									<div className="flex items-baseline justify-between gap-4 pl-1">
										<span className="flex items-center gap-2 font-medium text-sm">
											<span
												className={`size-2.5 shrink-0 rounded-[2px] ${swatch}`}
											/>
											{chartConfig[key].label}
										</span>
										<span className="text-muted-foreground text-xs tabular-nums">
											{formatCurrency(totals[key], currency)} total
										</span>
									</div>
									<ChartContainer
										className={`aspect-auto ${height} w-full`}
										config={chartConfig}
									>
										<BarChart
											barCategoryGap={2}
											data={data}
											margin={{ left: 12, right: 12, top: 4 }}
										>
											<CartesianGrid vertical={false} />
											<XAxis
												axisLine={false}
												dataKey="tick"
												hide={!isLast}
												interval="preserveStartEnd"
												minTickGap={28}
												tickLine={false}
												tickMargin={8}
											/>
											<YAxis
												axisLine={false}
												tickCount={ticks}
												tickFormatter={compact}
												tickLine={false}
												tickMargin={8}
												width={64}
											/>
											<ReferenceLine stroke="var(--border)" y={0} />
											<ChartTooltip
												content={<MonthTooltip currency={currency} />}
												cursor={{ fill: "var(--muted)", opacity: 0.5 }}
											/>
											<Bar
												dataKey={key}
												fill={`var(--color-${key})`}
												isAnimationActive={false}
												radius={2}
											/>
										</BarChart>
									</ChartContainer>
								</div>
							);
						})}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
