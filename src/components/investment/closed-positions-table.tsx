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
import { ReturnPill } from "@/components/ui/figures";
import { formatCurrency, formatDate } from "@/lib/metrics";
import type { Position } from "@/lib/positions";
import { cn } from "@/lib/utils";

interface ClosedPositionsTableProps {
	positions: Position[];
	currency: string;
}

export function ClosedPositionsTable({
	positions,
	currency,
}: ClosedPositionsTableProps) {
	const columns = useMemo<DataTableColumn<Position>[]>(
		() => [
			{
				key: "symbol",
				header: "Symbol",
				sortValue: (position) => position.symbol,
				cell: (position) => (
					<div className="flex flex-col gap-0.5">
						<span className="font-medium">{position.symbol}</span>
						<span className="text-muted-foreground text-xs">
							{position.name ?? "—"}
						</span>
					</div>
				),
			},
			{
				key: "account",
				header: "Account",
				sortValue: (position) => position.accountType,
				cell: (position) => position.accountType,
			},
			{
				key: "invested",
				header: "Invested",
				align: "right",
				sortValue: (position) => position.invested,
				className: "tabular-nums",
				cell: (position) => formatCurrency(position.invested, currency),
			},
			{
				key: "proceeds",
				header: "Proceeds",
				align: "right",
				sortValue: (position) => position.proceeds,
				className: "tabular-nums",
				cell: (position) => formatCurrency(position.proceeds, currency),
			},
			{
				key: "realizedPnl",
				header: "Realised gain",
				align: "right",
				sortValue: (position) => position.realizedPnl,
				className: "tabular-nums",
				cell: (position) => (
					<span
						className={cn(
							position.realizedPnl > 0 &&
								"text-emerald-700 dark:text-emerald-400",
							position.realizedPnl < 0 && "text-destructive",
						)}
					>
						{formatCurrency(position.realizedPnl, currency)}
					</span>
				),
			},
			{
				key: "realizedPct",
				header: "Return",
				align: "right",
				sortValue: (position) =>
					position.invested === 0
						? null
						: position.realizedPnl / position.invested,
				className: "tabular-nums",
				cell: (position) =>
					position.invested === 0 ? (
						"—"
					) : (
						<ReturnPill
							label="Realised return on what you paid, excluding dividends"
							value={position.realizedPnl / position.invested}
						/>
					),
			},
			{
				key: "dividends",
				header: "Dividends",
				align: "right",
				sortValue: (position) => position.dividends,
				className: "tabular-nums",
				cell: (position) =>
					position.dividends === 0
						? "—"
						: formatCurrency(position.dividends, currency),
			},
			{
				key: "lastTradeDate",
				header: "Closed",
				sortValue: (position) => position.lastTradeDate,
				cell: (position) =>
					position.lastTradeDate ? formatDate(position.lastTradeDate) : "—",
			},
		],
		[currency],
	);

	if (positions.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Closed positions</CardTitle>
				<CardDescription>
					Securities you sold out of completely. Return is measured against what
					you paid, and excludes dividends. Book cost is pooled per account for
					reporting — this is not a tax document, and registered accounts have
					no cost-basis significance.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<DataTable
					columns={columns}
					initialSort={{ key: "lastTradeDate", desc: true }}
					noun="closed positions"
					rowKey={(position) => `${position.accountId}:${position.symbol}`}
					rows={positions}
				/>
			</CardContent>
		</Card>
	);
}
