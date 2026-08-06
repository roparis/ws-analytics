"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ActivitiesTable } from "@/components/activities-table";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	EMPTY_FILTERS,
	filterActivities,
	formatCurrency,
	formatDate,
} from "@/lib/metrics";
import type { Activity } from "@/lib/wealthsimple";

const ALL = "all";

type Direction = "all" | "in" | "out";

interface TableFilters {
	search: string;
	accountId: string;
	activityType: string;
	subType: string;
	direction: Direction;
	minAmount: string;
	maxAmount: string;
	dateFrom: string;
	dateTo: string;
}

const EMPTY_TABLE_FILTERS: TableFilters = {
	search: "",
	accountId: ALL,
	activityType: ALL,
	subType: ALL,
	direction: ALL,
	minAmount: "",
	maxAmount: "",
	dateFrom: "",
	dateTo: "",
};

const DIRECTIONS: { value: Direction; label: string }[] = [
	{ value: "all", label: "In and out" },
	{ value: "in", label: "Money in" },
	{ value: "out", label: "Money out" },
];

/**
 * Amount bounds are compared against the *magnitude* so one pair of inputs
 * works for both directions — "over $1,000" should surface a $2,000 withdrawal
 * as readily as a $2,000 deposit. Direction is its own filter.
 */
function matchesAmount(activity: Activity, min: number, max: number): boolean {
	const magnitude = Math.abs(activity.netCashAmount);
	return magnitude >= min && magnitude <= max;
}

function matchesSearch(activity: Activity, needle: string): boolean {
	return (
		activity.description.toLowerCase().includes(needle) ||
		(activity.symbol ?? "").toLowerCase().includes(needle) ||
		(activity.name ?? "").toLowerCase().includes(needle)
	);
}

interface ActivitiesDialogProps {
	activities: Activity[];
	currency: string;
	/** Names the period the rows cover — the dialog heading, e.g. `2026`. */
	title: string;
	/** Optional scope note under the heading, e.g. the account type. */
	subtitle?: string;
}

/**
 * The activity count on a year card, as a button that opens the underlying rows
 * in a filterable table. The card answers "how much"; this answers "which
 * ones", without navigating away from the summary that prompted the question.
 */
export function ActivitiesDialog({
	activities,
	currency,
	title,
	subtitle,
}: ActivitiesDialogProps) {
	const [filters, setFilters] = useState<TableFilters>(EMPTY_TABLE_FILTERS);

	const set = <K extends keyof TableFilters>(key: K, value: TableFilters[K]) =>
		setFilters((current) => ({ ...current, [key]: value }));

	// Options come from the rows in scope, not the whole dataset, so the selects
	// never offer a value that would empty the table.
	const options = useMemo(() => {
		const accountIds = new Set<string>();
		const activityTypes = new Set<string>();
		const subTypes = new Set<string>();
		let start = "";
		let end = "";

		for (const activity of activities) {
			accountIds.add(activity.accountId);
			activityTypes.add(activity.activityType);
			if (activity.activitySubType) subTypes.add(activity.activitySubType);
			const date = activity.transactionDate;
			if (start === "" || date < start) start = date;
			if (end === "" || date > end) end = date;
		}

		return {
			accountIds: [...accountIds].sort(),
			activityTypes: [...activityTypes].sort(),
			subTypes: [...subTypes].sort(),
			start,
			end,
		};
	}, [activities]);

	const filtered = useMemo(() => {
		// Everything `filterActivities` already knows how to do runs through it,
		// so this dialog can't drift from the filtering the rest of the app does.
		const scoped = filterActivities(activities, {
			...EMPTY_FILTERS,
			accountIds: filters.accountId === ALL ? [] : [filters.accountId],
			activityTypes: filters.activityType === ALL ? [] : [filters.activityType],
			dateFrom: filters.dateFrom || null,
			dateTo: filters.dateTo || null,
		});

		const needle = filters.search.trim().toLowerCase();
		const min = Number.parseFloat(filters.minAmount);
		const max = Number.parseFloat(filters.maxAmount);
		const lower = Number.isNaN(min) ? 0 : min;
		const upper = Number.isNaN(max) ? Number.POSITIVE_INFINITY : max;

		return scoped.filter((activity) => {
			if (needle && !matchesSearch(activity, needle)) return false;
			if (
				filters.subType !== ALL &&
				activity.activitySubType !== filters.subType
			) {
				return false;
			}
			if (filters.direction === "in" && activity.netCashAmount <= 0) {
				return false;
			}
			if (filters.direction === "out" && activity.netCashAmount >= 0) {
				return false;
			}
			return matchesAmount(activity, lower, upper);
		});
	}, [activities, filters]);

	const dateBounds = `${formatDate(options.start)} – ${formatDate(options.end)}`;
	const isFiltered = filtered.length !== activities.length;
	const net = filtered.reduce((sum, row) => sum + row.netCashAmount, 0);
	const count = activities.length;

	return (
		<Dialog>
			<DialogTrigger className="rounded-full text-muted-foreground text-xs underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/30">
				{count.toLocaleString()} {count === 1 ? "activity" : "activities"}
			</DialogTrigger>

			<DialogContent className="flex max-h-[85dvh] w-full flex-col gap-4 sm:max-w-5xl">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>
						{subtitle ? `${subtitle} · ` : ""}
						{count.toLocaleString()} {count === 1 ? "activity" : "activities"}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3 rounded-3xl bg-muted/40 p-4">
					<div className="relative">
						<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							className="pl-9"
							onChange={(event) => set("search", event.target.value)}
							placeholder="Search description, symbol or name"
							value={filters.search}
						/>
					</div>

					<div className="flex flex-wrap gap-2">
						<Select
							onValueChange={(value) =>
								value && set("accountId", value as string)
							}
							value={filters.accountId}
						>
							<SelectTrigger className="w-52" size="sm">
								<SelectValue>
									{(value) => (value === ALL ? "All accounts" : String(value))}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>All accounts</SelectItem>
								{options.accountIds.map((id) => (
									<SelectItem key={id} value={id}>
										{id}
									</SelectItem>
								))}
							</SelectContent>
						</Select>

						<Select
							onValueChange={(value) =>
								value && set("activityType", value as string)
							}
							value={filters.activityType}
						>
							<SelectTrigger className="w-44" size="sm">
								<SelectValue>
									{(value) =>
										value === ALL ? "All activity types" : String(value)
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>All activity types</SelectItem>
								{options.activityTypes.map((activityType) => (
									<SelectItem key={activityType} value={activityType}>
										{activityType}
									</SelectItem>
								))}
							</SelectContent>
						</Select>

						{options.subTypes.length > 0 && (
							<Select
								onValueChange={(value) =>
									value && set("subType", value as string)
								}
								value={filters.subType}
							>
								<SelectTrigger className="w-40" size="sm">
									<SelectValue>
										{(value) =>
											value === ALL ? "All sub-types" : String(value)
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL}>All sub-types</SelectItem>
									{options.subTypes.map((subType) => (
										<SelectItem key={subType} value={subType}>
											{subType}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}

						<Select
							onValueChange={(value) =>
								value && set("direction", value as Direction)
							}
							value={filters.direction}
						>
							<SelectTrigger className="w-36" size="sm">
								<SelectValue>
									{(value) =>
										DIRECTIONS.find((option) => option.value === value)?.label
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{DIRECTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<span className="text-muted-foreground text-xs">Amount</span>
						<Input
							className="h-8 w-28"
							inputMode="decimal"
							onChange={(event) => set("minAmount", event.target.value)}
							placeholder="Min"
							type="number"
							value={filters.minAmount}
						/>
						<Input
							className="h-8 w-28"
							inputMode="decimal"
							onChange={(event) => set("maxAmount", event.target.value)}
							placeholder="Max"
							type="number"
							value={filters.maxAmount}
						/>

						{/* Bounded to the rows in scope: a date outside them could only
						ever return nothing. Spelling the window out because a picker that
						silently refuses a date reads as broken. */}
						<span
							className="ml-2 text-muted-foreground text-xs"
							title={dateBounds}
						>
							Dates <span className="opacity-70">({dateBounds})</span>
						</span>
						<Input
							className="h-8 w-40"
							max={options.end}
							min={options.start}
							onChange={(event) => set("dateFrom", event.target.value)}
							title={`Selectable range: ${dateBounds}`}
							type="date"
							value={filters.dateFrom}
						/>
						<Input
							className="h-8 w-40"
							max={options.end}
							min={options.start}
							onChange={(event) => set("dateTo", event.target.value)}
							title={`Selectable range: ${dateBounds}`}
							type="date"
							value={filters.dateTo}
						/>

						<Button
							className="ml-auto"
							disabled={filters === EMPTY_TABLE_FILTERS}
							onClick={() => setFilters(EMPTY_TABLE_FILTERS)}
							size="sm"
							variant="ghost"
						>
							Clear filters
						</Button>
					</div>
				</div>

				<p className="text-muted-foreground text-xs">
					{isFiltered
						? `${filtered.length.toLocaleString()} of ${count.toLocaleString()} activities`
						: `${count.toLocaleString()} activities`}{" "}
					· net{" "}
					<span className="tabular-nums">{formatCurrency(net, currency)}</span>
				</p>

				{/* The table paginates internally; this scrolls the dialog body so a
				long description column can't push the filter bar off-screen. */}
				<div className="min-h-0 flex-1 overflow-y-auto">
					<ActivitiesTable activities={filtered} currency={currency} />
				</div>
			</DialogContent>
		</Dialog>
	);
}
