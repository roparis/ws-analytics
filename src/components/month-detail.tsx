"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ActivitiesTable } from "@/components/activities-table";
import { ActivityChart } from "@/components/charts/activity-chart";
import { HeadlineFigures } from "@/components/headline-figures";
import { KpiCards } from "@/components/kpi-cards";
import { MoneyFlow } from "@/components/money-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { computeKpis, groupByMonth } from "@/lib/metrics";
import { useDatasetStore } from "@/stores/dataset";

const ALL = "__all__";

export function MonthDetail({ monthKey }: { monthKey: string }) {
	const dataset = useDatasetStore((state) => state.dataset);
	const [accountType, setAccountType] = useState<string>(ALL);

	const group = useMemo(
		() =>
			dataset
				? groupByMonth(dataset.activities).find((g) => g.key === monthKey)
				: undefined,
		[dataset, monthKey],
	);

	// Drill-down is local state, not a URL param, so browser back is a single hop
	// straight to the timeline rather than unwinding filter changes first.
	const scoped = useMemo(() => {
		if (!group) return [];
		return accountType === ALL
			? group.activities
			: group.activities.filter(
					(activity) => activity.accountType === accountType,
				);
	}, [group, accountType]);

	const kpis = useMemo(() => computeKpis(scoped), [scoped]);

	if (!dataset) return null;

	if (!group) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
				<p className="text-muted-foreground text-sm">
					No activity for this month in the loaded files.
				</p>
				<Button
					nativeButton={false}
					render={<Link href="/">Back to timeline</Link>}
				/>
			</div>
		);
	}

	const currency = dataset.currencies[0] ?? "CAD";
	const isScoped = accountType !== ALL;

	return (
		<main className="flex w-full flex-1 flex-col gap-6 py-6">
			<div className="flex flex-col gap-3">
				<Button
					className="w-fit"
					nativeButton={false}
					render={
						<Link href="/">
							<ArrowLeft className="size-4" />
							Timeline
						</Link>
					}
					size="sm"
					variant="ghost"
				/>
				<div>
					<h1 className="font-semibold text-xl">{group.label}</h1>
					<p className="text-muted-foreground text-sm">
						{kpis.count.toLocaleString()} activities
						{isScoped ? ` in ${accountType}` : " across all accounts"}
					</p>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<span className="mr-1 text-muted-foreground text-xs">Accounts</span>
				<Button
					onClick={() => setAccountType(ALL)}
					size="xs"
					variant={accountType === ALL ? "default" : "outline"}
				>
					All
				</Button>
				{group.accountTypes.map((type) => (
					<Button
						key={type}
						onClick={() => setAccountType(type)}
						size="xs"
						variant={accountType === type ? "default" : "outline"}
					>
						{type}
					</Button>
				))}
			</div>

			<Card size="sm">
				<CardContent>
					<HeadlineFigures
						accountType={isScoped ? accountType : undefined}
						currency={currency}
						kpis={kpis}
						size="md"
					/>
				</CardContent>
			</Card>

			<p className="text-muted-foreground text-xs">
				Invested is the net cash you put into securities (buys minus sells).
				Income covers dividends, interest and cash back. The full picture — bank
				funding, transfers and spending — is in the breakdown below.
			</p>

			<KpiCards currency={currency} isAccountFiltered={isScoped} kpis={kpis} />
			<MoneyFlow activities={scoped} currency={currency} />
			<ActivityChart activities={scoped} currency={currency} />
			<ActivitiesTable activities={scoped} currency={currency} />
		</main>
	);
}
