"use client";

import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
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
import type { ParsedColumn } from "@/lib/csv";

interface DataTableProps {
	columns: ParsedColumn[];
	rows: Record<string, string>[];
}

export function DataTable({ columns, rows }: DataTableProps) {
	const [sorting, setSorting] = useState<SortingState>([]);

	const tableColumns = useMemo<ColumnDef<Record<string, string>>[]>(
		() =>
			columns.map((column) => ({
				accessorKey: column.name,
				header: ({ column: col }) => (
					<Button
						className="-ml-3 h-8"
						onClick={() => col.toggleSorting(col.getIsSorted() === "asc")}
						variant="ghost"
					>
						{column.name}
						<ArrowUpDown className="ml-2 size-3.5" />
					</Button>
				),
				sortingFn:
					column.type === "number"
						? (rowA, rowB, id) =>
								Number(rowA.getValue(id)) - Number(rowB.getValue(id))
						: "alphanumeric",
			})),
		[columns],
	);

	const table = useReactTable({
		data: rows,
		columns: tableColumns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		initialState: { pagination: { pageSize: 10 } },
	});

	return (
		<div className="space-y-3">
			<div className="overflow-auto rounded-lg border">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead key={header.id}>
										{header.isPlaceholder
											? null
											: flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)}
									</TableHead>
								))}
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
									No rows.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			<div className="flex items-center justify-between text-muted-foreground text-sm">
				<span>
					Page {table.getState().pagination.pageIndex + 1} of{" "}
					{table.getPageCount() || 1} · {rows.length} rows
				</span>
				<div className="flex gap-2">
					<Button
						disabled={!table.getCanPreviousPage()}
						onClick={() => table.previousPage()}
						size="sm"
						variant="outline"
					>
						Previous
					</Button>
					<Button
						disabled={!table.getCanNextPage()}
						onClick={() => table.nextPage()}
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
