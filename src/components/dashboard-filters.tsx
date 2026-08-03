"use client";

import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ActivityFilters } from "@/lib/metrics";
import type { ActivityDataset } from "@/lib/wealthsimple";

export const DATE_PRESETS = [
	{ value: "all", label: "All dates" },
	{ value: "30d", label: "Last 30 days" },
	{ value: "3m", label: "Last 3 months" },
	{ value: "6m", label: "Last 6 months" },
	{ value: "12m", label: "Last 12 months" },
	{ value: "ytd", label: "Year to date" },
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number]["value"];

const ALL = "all";

export function resolveDateFrom(
	preset: DatePreset,
	datasetEnd: string,
): string | null {
	if (preset === ALL || !datasetEnd) return null;
	if (preset === "ytd") return `${datasetEnd.slice(0, 4)}-01-01`;

	const end = new Date(`${datasetEnd}T00:00:00`);
	if (preset === "30d") end.setDate(end.getDate() - 30);
	else if (preset === "3m") end.setMonth(end.getMonth() - 3);
	else if (preset === "6m") end.setMonth(end.getMonth() - 6);
	else if (preset === "12m") end.setMonth(end.getMonth() - 12);

	return end.toISOString().slice(0, 10);
}

interface DashboardFiltersProps {
	dataset: ActivityDataset;
	filters: ActivityFilters;
	datePreset: DatePreset;
	onFiltersChange: (filters: ActivityFilters) => void;
	onDatePresetChange: (preset: DatePreset) => void;
}

export function DashboardFilters({
	dataset,
	filters,
	datePreset,
	onFiltersChange,
	onDatePresetChange,
}: DashboardFiltersProps) {
	const selectedTypes = filters.accountTypes;
	const allTypesSelected = selectedTypes.length === 0;

	// An account stays selectable only while its type is in scope.
	const visibleAccounts = allTypesSelected
		? dataset.accounts
		: dataset.accounts.filter((account) =>
				selectedTypes.includes(account.accountType),
			);

	function toggleAccountType(accountType: string) {
		const next = selectedTypes.includes(accountType)
			? selectedTypes.filter((value) => value !== accountType)
			: [...selectedTypes, accountType];

		const stillVisible = dataset.accounts
			.filter(
				(account) => next.length === 0 || next.includes(account.accountType),
			)
			.map((account) => account.id);

		onFiltersChange({
			...filters,
			accountTypes: next,
			accountIds: filters.accountIds.filter((id) => stillVisible.includes(id)),
		});
	}

	return (
		<div className="flex flex-col gap-3 rounded-3xl bg-muted/40 p-4">
			<div className="flex flex-wrap items-center gap-2">
				<span className="mr-1 text-muted-foreground text-xs">Accounts</span>
				<Button
					onClick={() =>
						onFiltersChange({ ...filters, accountTypes: [], accountIds: [] })
					}
					size="xs"
					variant={allTypesSelected ? "default" : "outline"}
				>
					All
				</Button>
				{dataset.accountTypes.map((accountType) => (
					<Button
						key={accountType}
						onClick={() => toggleAccountType(accountType)}
						size="xs"
						variant={
							selectedTypes.includes(accountType) ? "default" : "outline"
						}
					>
						{accountType}
					</Button>
				))}
			</div>

			<div className="flex flex-wrap gap-2">
				<Select
					onValueChange={(value) =>
						value && onDatePresetChange(value as DatePreset)
					}
					value={datePreset}
				>
					<SelectTrigger className="w-44" size="sm">
						<SelectValue>
							{(value) =>
								DATE_PRESETS.find((preset) => preset.value === value)?.label
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{DATE_PRESETS.map((preset) => (
							<SelectItem key={preset.value} value={preset.value}>
								{preset.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select
					onValueChange={(value) =>
						value &&
						onFiltersChange({
							...filters,
							activityTypes: value === ALL ? [] : [value as string],
						})
					}
					value={filters.activityTypes[0] ?? ALL}
				>
					<SelectTrigger className="w-44" size="sm">
						<SelectValue>
							{(value) => (value === ALL ? "All activity types" : value)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL}>All activity types</SelectItem>
						{dataset.activityTypes.map((activityType) => (
							<SelectItem key={activityType} value={activityType}>
								{activityType}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select
					onValueChange={(value) =>
						value &&
						onFiltersChange({
							...filters,
							accountIds: value === ALL ? [] : [value as string],
						})
					}
					value={filters.accountIds[0] ?? ALL}
				>
					<SelectTrigger className="w-64" size="sm">
						<SelectValue>
							{(value) => {
								if (value === ALL) return "All accounts";
								const account = dataset.accounts.find(
									(candidate) => candidate.id === value,
								);
								return account
									? `${account.accountType} · ${account.id}`
									: value;
							}}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL}>All accounts</SelectItem>
						{visibleAccounts.map((account) => (
							<SelectItem key={account.id} value={account.id}>
								{account.accountType} · {account.id}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}
