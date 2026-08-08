"use client";

import { useMemo } from "react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/metrics";
import type { PositionsReport, SymbolRollup } from "@/lib/positions";

interface SymbolIncomeTableProps {
	report: PositionsReport;
	currency: string;
}

export function SymbolIncomeTable({
	report,
	currency,
}: SymbolIncomeTableProps) {
	const rows = useMemo(
		() =>
			report.bySymbol
				.filter((symbol) => symbol.dividends !== 0)
				.sort((a, b) => b.dividends - a.dividends),
		[report.bySymbol],
	);

	const columns = useMemo<DataTableColumn<SymbolRollup>[]>(
		() => [
			{
				key: "symbol",
				header: "Symbol",
				sortValue: (row) => row.symbol,
				cell: (row) => (
					<div className="flex flex-col gap-0.5">
						<span className="font-medium">{row.symbol}</span>
						<span className="text-muted-foreground text-xs">
							{row.name ?? "—"}
						</span>
					</div>
				),
			},
			{
				key: "dividends",
				header: "Dividends",
				align: "right",
				sortValue: (row) => row.dividends,
				className: "tabular-nums",
				cell: (row) => formatCurrency(row.dividends, currency),
			},
			{
				key: "bookCost",
				header: "Book cost",
				align: "right",
				sortValue: (row) => row.bookCost,
				className: "tabular-nums",
				cell: (row) =>
					row.bookCost === 0 ? "—" : formatCurrency(row.bookCost, currency),
			},
			{
				key: "yieldOnCost",
				header: "Yield on cost",
				align: "right",
				sortValue: (row) =>
					row.bookCost === 0 ? null : row.dividends / row.bookCost,
				className: "tabular-nums",
				cell: (row) =>
					// Only meaningful against a position still held: a closed one has no
					// book cost left to measure against, and the dividends it collected
					// belong to a holding period the number can't express.
					row.bookCost === 0
						? "—"
						: `${((row.dividends / row.bookCost) * 100).toFixed(2)}%`,
			},
			{
				key: "accounts",
				header: "Accounts",
				align: "right",
				sortValue: (row) => row.accountIds.length,
				className: "tabular-nums",
				cell: (row) => row.accountIds.length,
			},
		],
		[currency],
	);

	if (rows.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Income by holding</CardTitle>
				<CardDescription>
					Distributions rolled up per security, across every account. Yield on
					cost is lifetime dividends over current book cost — it is not an
					annual rate. Withholding tax is missing here on purpose: those rows
					carry no symbol in the export, so tax can only be reported per
					account.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<DataTable
					columns={columns}
					initialSort={{ key: "dividends", desc: true }}
					noun="securities"
					rowKey={(row) => row.symbol}
					rows={rows}
				/>
				<div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground text-xs">
					<span>
						Withholding tax{" "}
						<span className="text-foreground tabular-nums">
							{formatCurrency(-report.totals.withholdingTax, currency)}
						</span>
					</span>
					<span>
						Fees, net of refunds{" "}
						<span className="text-foreground tabular-nums">
							{formatCurrency(-report.totals.fees, currency)}
						</span>
					</span>
				</div>
			</CardContent>
		</Card>
	);
}
