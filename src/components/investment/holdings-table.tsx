"use client";

import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/metrics";
import { LISTING_LABELS, type Position } from "@/lib/positions";

/** Share counts run to 8 decimals on crypto and 4 on fractional ETF units. */
function formatShares(shares: number): string {
	return new Intl.NumberFormat("en-CA", {
		maximumFractionDigits: shares < 1 ? 8 : 4,
	}).format(shares);
}

interface HoldingsTableProps {
	positions: Position[];
	currency: string;
}

export function HoldingsTable({ positions, currency }: HoldingsTableProps) {
	const columns = useMemo<DataTableColumn<Position>[]>(
		() => [
			{
				key: "symbol",
				header: "Symbol",
				sortValue: (position) => position.symbol,
				cell: (position) => (
					<div className="flex flex-col gap-0.5">
						<span className="flex items-center gap-1.5 font-medium">
							{position.symbol}
							{position.issues.length > 0 && (
								<AlertTriangle
									aria-label={position.issues
										.map((issue) => issue.message)
										.join(" ")}
									className="size-3.5 text-amber-600 dark:text-amber-400"
								/>
							)}
						</span>
						<span className="text-muted-foreground text-xs">
							{position.name ?? "—"}
						</span>
					</div>
				),
			},
			{
				key: "listing",
				header: "Listing",
				sortValue: (position) => position.listing,
				cell: (position) => (
					<Badge variant="secondary">{LISTING_LABELS[position.listing]}</Badge>
				),
			},
			{
				key: "account",
				header: "Account",
				sortValue: (position) => position.accountType,
				cell: (position) => (
					<div className="flex flex-col gap-0.5">
						<span>{position.accountType}</span>
						<span className="text-muted-foreground text-xs">
							{position.accountId}
						</span>
					</div>
				),
			},
			{
				key: "shares",
				header: "Shares",
				align: "right",
				sortValue: (position) => position.shares,
				className: "tabular-nums",
				cell: (position) => formatShares(position.shares),
			},
			{
				key: "bookCost",
				header: "Book cost",
				align: "right",
				sortValue: (position) => position.bookCost,
				className: "tabular-nums",
				cell: (position) => formatCurrency(position.bookCost, currency),
			},
			{
				key: "averageCost",
				header: "Avg cost/share",
				align: "right",
				sortValue: (position) => position.averageCost,
				className: "tabular-nums",
				cell: (position) =>
					position.averageCost === null
						? "—"
						: formatCurrency(position.averageCost, currency),
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
				key: "firstTradeDate",
				header: "First buy",
				sortValue: (position) => position.firstTradeDate,
				cell: (position) =>
					position.firstTradeDate ? formatDate(position.firstTradeDate) : "—",
			},
		],
		[currency],
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Holdings</CardTitle>
				<CardDescription>
					One row per security per account, because cost is pooled per account —
					the same ticker held in two accounts has two separate book costs.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<DataTable
					columns={columns}
					emptyMessage="No open holdings in the loaded files."
					initialSort={{ key: "bookCost", desc: true }}
					noun="holdings"
					rowKey={(position) => `${position.accountId}:${position.symbol}`}
					rows={positions}
				/>
			</CardContent>
		</Card>
	);
}
