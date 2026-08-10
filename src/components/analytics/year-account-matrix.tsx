"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { type RangeOption, Segmented } from "@/components/ui/range-pills";
import type { YearAccountStat } from "@/lib/analytics";
import { formatCurrency } from "@/lib/metrics";

/**
 * Every year against every account type, for one measure at a time.
 *
 * A cross-tab can only show one number per cell, and which number matters
 * changes with the question — so the measure is a toggle rather than six tables.
 * The app has built exactly this grid before, but only inside the Google Sheets
 * export; this is the same view without leaving the page.
 */

const MEASURES = [
	{ value: "invested", label: "Invested" },
	{ value: "deposited", label: "Deposited" },
	{ value: "withdrawn", label: "Withdrawn" },
	{ value: "medianMonthlyInvested", label: "Median/mo" },
	{ value: "earned", label: "Earned" },
] as const;

type Measure = (typeof MEASURES)[number]["value"];

const CAPTIONS: Record<Measure, string> = {
	invested:
		"Cash put into the market that year, net of what selling returned. Not a valuation.",
	deposited:
		"Money that arrived from your bank. Transfers between your own accounts are excluded.",
	withdrawn: "Money that left for your bank, shown as a positive amount.",
	medianMonthlyInvested:
		"The typical month's investing, taken across every month the loaded files cover — including the months you invested nothing, which is the point of a median.",
	earned:
		"Realised gains, distributions, interest and bonuses, less fees and tax. Holdings you still own aren't in it: without prices, an unrealised gain can't be known.",
};

function measureOf(row: YearAccountStat, measure: Measure): number {
	switch (measure) {
		case "invested":
			return row.invested;
		case "deposited":
			return row.deposited;
		case "withdrawn":
			return row.withdrawn;
		case "medianMonthlyInvested":
			return row.medianMonthlyInvested;
		case "earned":
			return row.earned.total;
		default:
			return 0;
	}
}

interface MatrixRow {
	year: string;
	total: number;
	byType: Record<string, number>;
}

interface YearAccountMatrixProps {
	stats: YearAccountStat[];
	totals: YearAccountStat[];
	accountTypes: string[];
	currency: string;
}

export function YearAccountMatrix({
	accountTypes,
	currency,
	stats,
	totals,
}: YearAccountMatrixProps) {
	const [measure, setMeasure] = useState<Measure>("invested");

	const rows = useMemo<MatrixRow[]>(() => {
		const byYear = new Map<string, MatrixRow>();

		for (const total of totals) {
			byYear.set(total.year, {
				year: total.year,
				// Taken from the year's own row rather than by adding the cells up,
				// so the total column can't quietly disagree with the rest of the app.
				total: measureOf(total, measure),
				byType: {},
			});
		}

		for (const stat of stats) {
			const row = byYear.get(stat.year);
			if (row) row.byType[stat.accountType] = measureOf(stat, measure);
		}

		return [...byYear.values()];
	}, [measure, stats, totals]);

	const columns = useMemo<DataTableColumn<MatrixRow>[]>(
		() => [
			{
				key: "year",
				header: "Year",
				sortValue: (row) => row.year,
				cell: (row) => <span className="font-medium">{row.year}</span>,
			},
			...accountTypes.map<DataTableColumn<MatrixRow>>((accountType) => ({
				key: accountType,
				header: (
					<Link
						className="hover:underline"
						href={`/accounts/${encodeURIComponent(accountType)}`}
					>
						{accountType}
					</Link>
				),
				align: "right",
				sortValue: (row) => row.byType[accountType] ?? null,
				className: "tabular-nums",
				cell: (row) =>
					// An account that didn't exist yet reads as a dash, not a $0.00 —
					// "nothing happened" and "no account" are different facts.
					accountType in row.byType
						? formatCurrency(row.byType[accountType], currency)
						: "—",
			})),
			{
				key: "total",
				header: "All accounts",
				align: "right",
				sortValue: (row) => row.total,
				className: "font-medium tabular-nums",
				cell: (row) => formatCurrency(row.total, currency),
			},
		],
		[accountTypes, currency],
	);

	if (rows.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex flex-col gap-1.5">
						<CardTitle>By year and account type</CardTitle>
						<CardDescription>{CAPTIONS[measure]}</CardDescription>
					</div>
					<Segmented
						aria-label="Measure"
						inset
						onChange={setMeasure}
						options={MEASURES satisfies readonly RangeOption<Measure>[]}
						value={measure}
					/>
				</div>
			</CardHeader>
			<CardContent>
				<DataTable
					columns={columns}
					initialSort={{ key: "year", desc: true }}
					noun="years"
					rowKey={(row) => row.year}
					rows={rows}
				/>
			</CardContent>
		</Card>
	);
}
