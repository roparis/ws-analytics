"use client";

import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { DATE_PRESETS, type DatePreset } from "@/lib/date-range";
import type { ActivityFilters } from "@/lib/metrics";
import type { ActivityDataset } from "@/lib/wealthsimple";

// The sentinel value for "no filter selected" in the activity-type and
// account selects below. Unrelated to date-range.ts's own "all" preset —
// coincidentally the same string, kept local since it never leaves this file.
const ALL = "all";

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
