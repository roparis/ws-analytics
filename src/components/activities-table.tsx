"use client";

import { useMemo } from "react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatCurrency, formatDate } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { Activity } from "@/lib/wealthsimple";

interface ActivitiesTableProps {
	activities: Activity[];
	currency: string;
}

export function ActivitiesTable({
	activities,
	currency,
}: ActivitiesTableProps) {
	const columns = useMemo<DataTableColumn<Activity>[]>(
		() => [
			{
				key: "transactionDate",
				header: "Date",
				sortValue: (row) => row.transactionDate,
				cell: (row) => (
					<span className="whitespace-nowrap">
						{formatDate(row.transactionDate)}
					</span>
				),
			},
			{
				key: "accountType",
				header: "Account",
				sortValue: (row) => row.accountType,
				cell: (row) => (
					<span className="whitespace-nowrap">{row.accountType}</span>
				),
			},
			{
				key: "activityType",
				header: "Activity",
				sortValue: (row) => row.activityType,
				cell: (row) => (
					<span className="whitespace-nowrap">
						{row.activityType}
						{row.activitySubType ? ` · ${row.activitySubType}` : ""}
					</span>
				),
			},
			{
				key: "symbol",
				header: "Symbol",
				sortValue: (row) => row.symbol,
				cell: (row) => row.symbol ?? "—",
			},
			{
				key: "description",
				header: "Description",
				className: "whitespace-normal",
				cell: (row) => (
					<span className="line-clamp-2 max-w-md text-muted-foreground">
						{row.description}
					</span>
				),
			},
			{
				key: "quantity",
				header: "Quantity",
				align: "right",
				sortValue: (row) => row.quantity ?? null,
				cell: (row) => <span className="tabular-nums">{row.quantity}</span>,
			},
			{
				key: "netCashAmount",
				header: "Amount",
				align: "right",
				sortValue: (row) => row.netCashAmount,
				cell: (row) => (
					<span
						className={cn(
							"tabular-nums",
							row.netCashAmount < 0 && "text-destructive",
						)}
					>
						{formatCurrency(row.netCashAmount, currency)}
					</span>
				),
			},
		],
		[currency],
	);

	return (
		<DataTable
			columns={columns}
			emptyMessage="No activities match the current filters."
			initialSort={{ key: "transactionDate", desc: true }}
			noun="activities"
			rowKey={(row, index) =>
				// Byte-identical rows are real data in this export (see the CSV format
				// doc), so the index is the only stable discriminator.
				`${row.transactionDate}-${row.accountId}-${index}`
			}
			rows={activities}
		/>
	);
}
