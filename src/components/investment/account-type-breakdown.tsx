"use client";

import Link from "next/link";
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
import type { AccountTypeRollup } from "@/lib/positions";

interface AccountTypeBreakdownProps {
	byAccountType: AccountTypeRollup[];
	currency: string;
}

export function AccountTypeBreakdown({
	byAccountType,
	currency,
}: AccountTypeBreakdownProps) {
	const columns = useMemo<DataTableColumn<AccountTypeRollup>[]>(
		() => [
			{
				key: "accountType",
				header: "Account type",
				sortValue: (row) => row.accountType,
				cell: (row) => (
					<Link
						className="font-medium hover:underline"
						href={`/accounts/${encodeURIComponent(row.accountType)}`}
					>
						{row.accountType}
					</Link>
				),
			},
			{
				key: "accounts",
				header: "Accounts",
				align: "right",
				sortValue: (row) => row.accountIds.length,
				className: "tabular-nums",
				cell: (row) => row.accountIds.length,
			},
			{
				key: "openCount",
				header: "Holdings",
				align: "right",
				sortValue: (row) => row.openCount,
				className: "tabular-nums",
				cell: (row) => row.openCount,
			},
			{
				key: "bookCost",
				header: "Book cost",
				align: "right",
				sortValue: (row) => row.bookCost,
				className: "tabular-nums",
				cell: (row) => formatCurrency(row.bookCost, currency),
			},
			{
				key: "realizedPnl",
				header: "Realised gain",
				align: "right",
				sortValue: (row) => row.realizedPnl,
				className: "tabular-nums",
				cell: (row) => formatCurrency(row.realizedPnl, currency),
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
				key: "fees",
				header: "Fees & tax",
				align: "right",
				sortValue: (row) => row.fees + row.withholdingTax,
				className: "tabular-nums",
				cell: (row) =>
					formatCurrency(-(row.fees + row.withholdingTax), currency),
			},
			{
				key: "cashBalance",
				header: "Cash",
				align: "right",
				sortValue: (row) => row.cashBalance,
				className: "tabular-nums",
				cell: (row) => formatCurrency(row.cashBalance, currency),
			},
		],
		[currency],
	);

	if (byAccountType.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>By account type</CardTitle>
				<CardDescription>
					A roll-up, not an account — several accounts can share one type, and
					three TFSAs roll into one row here while staying three above.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<DataTable
					columns={columns}
					initialSort={{ key: "bookCost", desc: true }}
					noun="account types"
					rowKey={(row) => row.accountType}
					rows={byAccountType}
				/>
			</CardContent>
		</Card>
	);
}
