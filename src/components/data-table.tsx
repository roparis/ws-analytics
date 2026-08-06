"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Distance from the end, in px, at which the next batch is revealed. */
const NEAR_END = 300;

export interface DataTableColumn<T> {
	key: string;
	header: ReactNode;
	cell: (row: T) => ReactNode;
	align?: "left" | "right";
	/** Providing this makes the column sortable; omit for a display-only column. */
	sortValue?: (row: T) => string | number | null;
	/** Applied to the `td`, for per-column width or wrapping rules. */
	className?: string;
}

interface DataTableProps<T> {
	rows: T[];
	columns: DataTableColumn<T>[];
	rowKey: (row: T, index: number) => string;
	initialSort?: { key: string; desc?: boolean };
	emptyMessage?: string;
	/** Rows revealed per batch as the sentinel scrolls into view. */
	batchSize?: number;
	/** Noun for the row counter under the table. */
	noun?: string;
	/** Compact row padding, for tables that sit inside a card alongside a chart. */
	dense?: boolean;
	/** Tailwind max-height for the scroll viewport. */
	maxHeightClass?: string;
}

function compare<T>(a: T, b: T, sortValue: (row: T) => string | number | null) {
	const left = sortValue(a);
	const right = sortValue(b);

	// Nulls sort last in ascending order regardless of the other value's type,
	// so an empty symbol column doesn't interleave with the populated rows.
	if (left === null || right === null) {
		if (left === right) return 0;
		return left === null ? 1 : -1;
	}
	if (typeof left === "number" && typeof right === "number") {
		return left - right;
	}
	return String(left).localeCompare(String(right));
}

/**
 * A sortable table that reveals rows as you scroll instead of paginating.
 *
 * Everything is already in memory, so "infinite scroll" here is purely about
 * how much is put in the DOM at once: a full export is thousands of rows, and
 * rendering them all costs far more than the handful anyone reads.
 */
export function DataTable<T>({
	rows,
	columns,
	rowKey,
	initialSort,
	emptyMessage = "No rows to show.",
	batchSize = 50,
	noun = "rows",
	dense = false,
	maxHeightClass = "max-h-[32rem]",
}: DataTableProps<T>) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(
		initialSort
			? { key: initialSort.key, desc: initialSort.desc ?? false }
			: null,
	);
	const [visible, setVisible] = useState(batchSize);

	const sorted = useMemo(() => {
		if (!sort) return rows;
		const column = columns.find((candidate) => candidate.key === sort.key);
		if (!column?.sortValue) return rows;

		const { sortValue } = column;
		return [...rows].sort((a, b) => {
			const result = compare(a, b, sortValue);
			return sort.desc ? -result : result;
		});
	}, [rows, columns, sort]);

	// A new result set or a new ordering means the rows already revealed are no
	// longer the ones the reader was looking at, so start the batch over.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resetting on the row *count* and ordering, not on the array identity — an unmemoized `rows` prop would otherwise clamp the batch back every render and break scrolling entirely.
	useEffect(() => {
		setVisible(batchSize);
	}, [rows.length, sort, batchSize]);

	const loadMore = useCallback(() => {
		setVisible((current) => Math.min(current + batchSize, sorted.length));
	}, [batchSize, sorted.length]);

	// Reveal the next batch shortly before the last row, so scrolling stays
	// continuous instead of stopping at a blank edge. Driven by the scroll event
	// rather than an IntersectionObserver: the table owns its scroll box, so the
	// distance to the end is a direct read, with no observer lifecycle to keep in
	// sync and nothing that goes quiet while the tab is in the background.
	function handleScroll(event: React.UIEvent<HTMLDivElement>) {
		if (visible >= sorted.length) return;
		const box = event.currentTarget;
		if (box.scrollHeight - box.scrollTop - box.clientHeight <= NEAR_END) {
			loadMore();
		}
	}

	// Tops up whenever a batch doesn't fill the box. Without this a table whose
	// rows are shorter than the viewport could never scroll, so the handler above
	// would never get a chance to run and the rest would stay unreachable.
	useEffect(() => {
		const box = scrollRef.current;
		if (!box || visible >= sorted.length) return;
		if (box.scrollHeight <= box.clientHeight) loadMore();
	}, [visible, sorted.length, loadMore]);

	const page = sorted.slice(0, visible);
	const remaining = sorted.length - page.length;

	function toggleSort(key: string) {
		setSort((current) =>
			current?.key === key
				? { key, desc: !current.desc }
				: { key, desc: false },
		);
	}

	return (
		<div className="flex flex-col gap-3">
			{/* Its own scroll box, so the header can stick and the sentinel is
			measured against a bounded viewport instead of the whole page. The
			explicit surface matters in dark mode, where `--card`/`--popover` are
			lighter than `--background` — a sticky header inheriting "transparent"
			would let rows show through it. */}
			<div
				className={cn(
					"relative overflow-auto rounded-lg border bg-background",
					maxHeightClass,
				)}
				onScroll={handleScroll}
				ref={scrollRef}
			>
				<table className="w-full caption-bottom text-sm">
					<TableHeader className="sticky top-0 z-10 bg-background">
						<TableRow className="hover:bg-transparent">
							{columns.map((column) => {
								const isSorted = sort?.key === column.key;
								const isRight = column.align === "right";
								const SortIcon = !isSorted
									? ArrowUpDown
									: sort.desc
										? ArrowDown
										: ArrowUp;

								return (
									<TableHead
										aria-sort={
											isSorted
												? sort.desc
													? "descending"
													: "ascending"
												: undefined
										}
										className={cn(
											// Tailwind's preflight collapses table borders, which
											// drops the header's bottom border once it is sticky —
											// an inset shadow survives the scroll.
											"shadow-[inset_0_-1px_0_var(--border)]",
											isRight && "text-right",
											dense && "h-9",
										)}
										key={column.key}
									>
										{column.sortValue ? (
											<Button
												className={cn("h-8", isRight ? "-mr-3" : "-ml-3")}
												onClick={() => toggleSort(column.key)}
												variant="ghost"
											>
												{column.header}
												<SortIcon
													className={cn(
														"ml-2 size-3.5",
														!isSorted && "text-muted-foreground",
													)}
												/>
											</Button>
										) : (
											column.header
										)}
									</TableHead>
								);
							})}
						</TableRow>
					</TableHeader>
					<TableBody>
						{page.length > 0 ? (
							page.map((row, index) => (
								<TableRow key={rowKey(row, index)}>
									{columns.map((column) => (
										<TableCell
											className={cn(
												column.align === "right" && "text-right",
												dense && "p-1.5",
												column.className,
											)}
											key={column.key}
										>
											{column.cell(row)}
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
									{emptyMessage}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</table>
			</div>

			{sorted.length > 0 && (
				<p className="text-muted-foreground text-sm" role="status">
					Showing {page.length.toLocaleString()} of{" "}
					{sorted.length.toLocaleString()} {noun}
					{remaining > 0 ? " · scroll for more" : ""}
				</p>
			)}
		</div>
	);
}
