"use client";

import { useMemo, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	XAxis,
	YAxis,
} from "recharts";
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
import type { ColumnType, ParsedColumn } from "@/lib/csv";

interface DatasetChartProps {
	columns: ParsedColumn[];
	rows: Record<string, string>[];
}

const chartConfig = {
	value: { label: "Total", color: "var(--chart-1)" },
} satisfies ChartConfig;

const MAX_POINTS = 20;

function buildChartData(
	rows: Record<string, string>[],
	xKey: string,
	yKey: string,
	xType: ColumnType,
) {
	const totals = new Map<string, number>();

	for (const row of rows) {
		const xValue = row[xKey]?.trim();
		if (!xValue) continue;
		const yValue = Number(row[yKey]);
		if (Number.isNaN(yValue)) continue;
		totals.set(xValue, (totals.get(xValue) ?? 0) + yValue);
	}

	let entries = Array.from(totals.entries()).map(([name, value]) => ({
		name,
		value,
	}));
	const truncated = entries.length > MAX_POINTS;

	if (xType === "date") {
		entries.sort((a, b) => Date.parse(a.name) - Date.parse(b.name));
		if (truncated) entries = entries.slice(-MAX_POINTS);
	} else {
		entries.sort((a, b) => b.value - a.value);
		if (truncated) entries = entries.slice(0, MAX_POINTS);
	}

	return { data: entries, truncated };
}

export function DatasetChart({ columns, rows }: DatasetChartProps) {
	const numericColumns = useMemo(
		() => columns.filter((column) => column.type === "number"),
		[columns],
	);
	const dimensionColumns = useMemo(
		() => columns.filter((column) => column.type !== "number"),
		[columns],
	);

	const [xKey, setXKey] = useState(
		dimensionColumns[0]?.name ?? columns[0]?.name ?? "",
	);
	const [yKey, setYKey] = useState(numericColumns[0]?.name ?? "");

	const xColumn = columns.find((column) => column.name === xKey);
	const isDate = xColumn?.type === "date";

	const { data, truncated } = useMemo(() => {
		if (!xKey || !yKey) return { data: [], truncated: false };
		return buildChartData(rows, xKey, yKey, xColumn?.type ?? "string");
	}, [rows, xKey, yKey, xColumn?.type]);

	if (numericColumns.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Chart</CardTitle>
				</CardHeader>
				<CardContent className="text-muted-foreground text-sm">
					No numeric columns were detected in this file, so there&apos;s nothing
					to chart.
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<CardTitle>Chart</CardTitle>
				<div className="flex flex-wrap gap-2">
					<Select
						onValueChange={(value) => value && setXKey(value)}
						value={xKey}
					>
						<SelectTrigger className="w-40" size="sm">
							<SelectValue placeholder="X axis" />
						</SelectTrigger>
						<SelectContent>
							{columns.map((column) => (
								<SelectItem key={column.name} value={column.name}>
									{column.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select
						onValueChange={(value) => value && setYKey(value)}
						value={yKey}
					>
						<SelectTrigger className="w-40" size="sm">
							<SelectValue placeholder="Y axis" />
						</SelectTrigger>
						<SelectContent>
							{numericColumns.map((column) => (
								<SelectItem key={column.name} value={column.name}>
									{column.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</CardHeader>
			<CardContent>
				{data.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No data to plot for this combination of columns.
					</p>
				) : (
					<>
						<ChartContainer
							className="aspect-auto h-72 w-full"
							config={chartConfig}
						>
							{isDate ? (
								<LineChart data={data}>
									<CartesianGrid vertical={false} />
									<XAxis
										axisLine={false}
										dataKey="name"
										tickLine={false}
										tickMargin={8}
									/>
									<YAxis axisLine={false} tickLine={false} tickMargin={8} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<Line
										dataKey="value"
										dot={false}
										stroke="var(--color-value)"
										strokeWidth={2}
										type="monotone"
									/>
								</LineChart>
							) : (
								<BarChart data={data}>
									<CartesianGrid vertical={false} />
									<XAxis
										angle={-30}
										axisLine={false}
										dataKey="name"
										height={60}
										interval={0}
										textAnchor="end"
										tickLine={false}
										tickMargin={8}
									/>
									<YAxis axisLine={false} tickLine={false} tickMargin={8} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<Bar dataKey="value" fill="var(--color-value)" radius={4} />
								</BarChart>
							)}
						</ChartContainer>
						{truncated && (
							<p className="mt-2 text-muted-foreground text-xs">
								Showing {data.length} categories.
							</p>
						)}
					</>
				)}
			</CardContent>
		</Card>
	);
}
