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
import { Segmented } from "@/components/ui/range-pills";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { ALL_ACCOUNT_TYPES } from "@/lib/analytics";
import { formatCurrency, formatDate } from "@/lib/metrics";
import type { ValuedYearStat } from "@/lib/price-history";

/**
 * Every figure for a year, one row at a time — the wide view the matrix can't
 * give because a cross-tab only has room for one measure.
 *
 * Two scopes: a year per row, or a year and account type per row. They are the
 * same function's output at two groupings, so the columns are identical and the
 * totals reconcile between them.
 */

const SCOPES = [
	{ value: "year", label: "By year" },
	{ value: "account", label: "By account type" },
] as const;

type Scope = (typeof SCOPES)[number]["value"];

interface YearAccountDetailProps {
	stats: ValuedYearStat[];
	totals: ValuedYearStat[];
	currency: string;
}

export function YearAccountDetail({
	currency,
	stats,
	totals,
}: YearAccountDetailProps) {
	const [scope, setScope] = useState<Scope>("year");
	const rows = scope === "year" ? totals : stats;
	const priced = totals.some((row) => row.valuation !== null);

	const columns = useMemo<DataTableColumn<ValuedYearStat>[]>(() => {
		const money = (
			key: string,
			header: string,
			pick: (row: ValuedYearStat) => number,
			className?: string,
		): DataTableColumn<ValuedYearStat> => ({
			key,
			header,
			align: "right",
			sortValue: pick,
			className: className ? `tabular-nums ${className}` : "tabular-nums",
			cell: (row) => formatCurrency(pick(row), currency),
		});

		const leading: DataTableColumn<ValuedYearStat>[] = [
			{
				key: "year",
				header: "Year",
				sortValue: (row) => row.year,
				cell: (row) => <span className="font-medium">{row.year}</span>,
			},
		];

		if (scope === "account") {
			leading.push({
				key: "accountType",
				header: "Account type",
				sortValue: (row) => row.accountType,
				cell: (row) =>
					row.accountType === ALL_ACCOUNT_TYPES ? (
						"All accounts"
					) : (
						<Link
							className="hover:underline"
							href={`/accounts/${encodeURIComponent(row.accountType)}`}
						>
							{row.accountType}
						</Link>
					),
			});
		}

		return [
			...leading,
			money("deposited", "Deposited", (row) => row.deposited),
			money("withdrawn", "Withdrawn", (row) => -row.withdrawn),
			money("invested", "Invested", (row) => row.invested),
			money(
				"medianMonthlyInvested",
				"Median invested/mo",
				(row) => row.medianMonthlyInvested,
			),
			money(
				"medianMonthlyDeposited",
				"Median deposited/mo",
				(row) => row.medianMonthlyDeposited,
			),
			{
				key: "monthsDeposited",
				header: "Months in",
				align: "right",
				sortValue: (row) =>
					row.monthsCovered === 0
						? null
						: row.monthsDeposited / row.monthsCovered,
				className: "tabular-nums",
				cell: (row) => (
					<Tooltip>
						<TooltipTrigger className="cursor-default">
							{row.monthsDeposited}/{row.monthsCovered}
						</TooltipTrigger>
						<TooltipContent>
							Months with a deposit, out of the months your loaded files cover
							for {row.year}.
						</TooltipContent>
					</Tooltip>
				),
			},
			money("dividends", "Dividends", (row) => row.dividends),
			money("costs", "Fees & tax", (row) => -row.costs),
			{
				key: "earned",
				header: "Earned",
				align: "right",
				sortValue: (row) => row.earned.total,
				className: priced ? "tabular-nums" : "font-medium tabular-nums",
				cell: (row) => (
					<Tooltip>
						<TooltipTrigger className="cursor-default">
							{formatCurrency(row.earned.total, currency)}
						</TooltipTrigger>
						<TooltipContent className="max-w-xs">
							{formatCurrency(row.earned.realized, currency)} realised ·{" "}
							{formatCurrency(row.earned.dividends, currency)} dividends ·{" "}
							{formatCurrency(row.earned.interest, currency)} interest ·{" "}
							{formatCurrency(row.earned.bonuses, currency)} bonuses · less{" "}
							{formatCurrency(row.earned.feesAndTax, currency)} fees &amp; tax
						</TooltipContent>
					</Tooltip>
				),
			},
			// The priced columns sit to the right of the cash ones, in the order a
			// reader builds the figure: what it was worth, what moved on paper, and
			// the two added together.
			...(priced
				? [
						{
							key: "value",
							header: "Value at year end",
							align: "right" as const,
							sortValue: (row: ValuedYearStat) => row.valuation?.value ?? null,
							className: "tabular-nums",
							cell: (row: ValuedYearStat) =>
								row.valuation ? (
									<Tooltip>
										<TooltipTrigger className="cursor-default">
											{formatCurrency(row.valuation.value, currency)}
										</TooltipTrigger>
										<TooltipContent className="max-w-xs">
											Holdings and cash as they stood on{" "}
											{formatDate(row.valuation.asOf)}, at that month's closing
											prices.
											{row.valuation.missingSymbols.length > 0 &&
												` No price that year for ${row.valuation.missingSymbols.join(", ")}, so ${row.valuation.missingSymbols.length === 1 ? "it is" : "they are"} counted at what you paid.`}
										</TooltipContent>
									</Tooltip>
								) : (
									"—"
								),
						},
						{
							key: "unrealisedChange",
							header: "Unrealised change",
							align: "right" as const,
							sortValue: (row: ValuedYearStat) =>
								row.valuation?.unrealisedChange ?? null,
							className: "tabular-nums",
							cell: (row: ValuedYearStat) =>
								row.valuation ? (
									<Tooltip>
										<TooltipTrigger className="cursor-default">
											{formatCurrency(row.valuation.unrealisedChange, currency)}
										</TooltipTrigger>
										<TooltipContent className="max-w-xs">
											How the paper gain on holdings you didn't sell moved over
											the year —{" "}
											{formatCurrency(row.valuation.unrealised, currency)}{" "}
											carried at the end of it. Nothing here was cash in your
											pocket.
										</TooltipContent>
									</Tooltip>
								) : (
									"—"
								),
						},
						{
							key: "totalReturn",
							header: "Total return",
							align: "right" as const,
							sortValue: (row: ValuedYearStat) => row.totalReturn,
							className: "font-medium tabular-nums",
							cell: (row: ValuedYearStat) =>
								row.totalReturn === null
									? "—"
									: formatCurrency(row.totalReturn, currency),
						},
					]
				: []),
		];
	}, [currency, priced, scope]);

	if (rows.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex flex-col gap-1.5">
						<CardTitle>What each year did</CardTitle>
						<CardDescription>
							Medians run over every month your files cover, counting the months
							you put nothing in.{" "}
							{priced
								? '"Earned" is what the year paid out in cash; "Total return" adds what your unsold holdings did on paper.'
								: '"Earned" leaves out holdings you still own — without prices, an unrealised gain isn\'t knowable.'}
						</CardDescription>
					</div>
					<Segmented
						aria-label="Grouping"
						inset
						onChange={setScope}
						options={SCOPES}
						value={scope}
					/>
				</div>
			</CardHeader>
			<CardContent>
				<DataTable
					columns={columns}
					initialSort={{ key: "year", desc: true }}
					noun={scope === "year" ? "years" : "rows"}
					rowKey={(row) => `${row.year}-${row.accountType}`}
					rows={rows}
				/>
			</CardContent>
		</Card>
	);
}
