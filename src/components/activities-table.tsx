"use client";

import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { Activity } from "@/lib/wealthsimple";

const PAGE_SIZE = 10;

interface ActivitiesTableProps {
	activities: Activity[];
	currency: string;
}

type SortKey =
	| "transactionDate"
	| "accountType"
	| "activityType"
	| "symbol"
	| "netCashAmount";

function compare(a: Activity, b: Activity, key: SortKey): number {
	if (key === "netCashAmount") return a.netCashAmount - b.netCashAmount;
	return String(a[key] ?? "").localeCompare(String(b[key] ?? ""));
}

export function ActivitiesTable({
	activities,
	currency,
}: ActivitiesTableProps) {
	const [sorting, setSorting] = useState<SortingState>([
		{ id: "transactionDate", desc: true },
	]);
	const [pageIndex, setPageIndex] = useState(0);

	// Sorting and pagination run over plain objects here so TanStack only ever
	// builds row models for the visible page. Handing it the full array made
	// every filter change rebuild tens of thousands of rows to show ten.
	const pageRows = useMemo(() => {
		const sort = sorting[0];
		const sorted = sort
			? [...activities].sort((a, b) => {
					const result = compare(a, b, sort.id as SortKey);
					return sort.desc ? -result : result;
				})
			: activities;
		const start = pageIndex * PAGE_SIZE;
		return sorted.slice(start, start + PAGE_SIZE);
	}, [activities, sorting, pageIndex]);

	const pageCount = Math.max(1, Math.ceil(activities.length / PAGE_SIZE));
	const safePage = Math.min(pageIndex, pageCount - 1);
	if (safePage !== pageIndex) setPageIndex(safePage);

	const columns = useMemo<ColumnDef<Activity>[]>(
		() => [
			{
				accessorKey: "transactionDate",
				header: "Date",
				cell: ({ row }) => (
					<span className="whitespace-nowrap">
						{formatDate(row.original.transactionDate)}
					</span>
				),
			},
			{
				accessorKey: "accountType",
				header: "Account",
				cell: ({ row }) => (
					<span className="whitespace-nowrap">{row.original.accountType}</span>
				),
			},
			{
				accessorKey: "activityType",
				header: "Activity",
				cell: ({ row }) => (
					<span className="whitespace-nowrap">
						{row.original.activityType}
						{row.original.activitySubType
							? ` · ${row.original.activitySubType}`
							: ""}
					</span>
				),
			},
			{
				accessorKey: "symbol",
				header: "Symbol",
				cell: ({ row }) => row.original.symbol ?? "—",
			},
			{
				accessorKey: "description",
				header: "Description",
				enableSorting: false,
				cell: ({ row }) => (
					<span className="line-clamp-2 max-w-md text-muted-foreground">
						{row.original.description}
					</span>
				),
			},
			{
				accessorKey: "netCashAmount",
				header: "Amount",
				cell: ({ row }) => (
					<span
						className={cn(
							"block whitespace-nowrap text-right tabular-nums",
							row.original.netCashAmount < 0 && "text-destructive",
						)}
					>
						{formatCurrency(row.original.netCashAmount, currency)}
					</span>
				),
			},
		],
		[currency],
	);

	const table = useReactTable({
		data: pageRows,
		columns,
		state: { sorting },
		onSortingChange: setSorting,
		manualSorting: true,
		manualPagination: true,
		pageCount,
		getCoreRowModel: getCoreRowModel(),
	});

	const toggleSort = (id: string) =>
		setSorting((current) =>
			current[0]?.id === id
				? [{ id, desc: !current[0].desc }]
				: [{ id, desc: false }],
		);

	return (
		<div className="space-y-3">
			<div className="overflow-auto rounded-lg border">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const sortable =
										header.column.columnDef.enableSorting !== false;
									const isAmount = header.column.id === "netCashAmount";
									return (
										<TableHead
											className={isAmount ? "text-right" : undefined}
											key={header.id}
										>
											{sortable ? (
												<Button
													className={cn("h-8", isAmount ? "-mr-3" : "-ml-3")}
													onClick={() => toggleSort(header.column.id)}
													variant="ghost"
												>
													{flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
													<ArrowUpDown className="ml-2 size-3.5" />
												</Button>
											) : (
												flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)
											)}
										</TableHead>
									);
								})}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow key={row.id}>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									className="h-24 text-center text-muted-foreground"
									colSpan={columns.length}
								>
									No activities match the current filters.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			<div className="flex items-center justify-between text-muted-foreground text-sm">
				<span>
					Page {safePage + 1} of {pageCount} ·{" "}
					{activities.length.toLocaleString()} activities
				</span>
				<div className="flex gap-2">
					<Button
						disabled={safePage === 0}
						onClick={() => setPageIndex((page) => page - 1)}
						size="sm"
						variant="outline"
					>
						Previous
					</Button>
					<Button
						disabled={safePage >= pageCount - 1}
						onClick={() => setPageIndex((page) => page + 1)}
						size="sm"
						variant="outline"
					>
						Next
					</Button>
				</div>
			</div>
		</div>
	);
}
