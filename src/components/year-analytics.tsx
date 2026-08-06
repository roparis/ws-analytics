"use client";

import { useMemo } from "react";
import { ActivitiesDialog } from "@/components/activities-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { YearFigures } from "@/components/year-figures";
import { groupByYear } from "@/lib/metrics";
import type { Activity } from "@/lib/wealthsimple";

interface YearAnalyticsProps {
	activities: Activity[];
	currency: string;
	accountType?: string;
}

/** The "By year" section on the account-type and account detail pages: the same
 * per-year figures the timeline's sticky bars show, as stacked rows. */
export function YearAnalytics({
	activities,
	currency,
	accountType,
}: YearAnalyticsProps) {
	const years = useMemo(() => groupByYear(activities), [activities]);

	if (years.length === 0) return null;

	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-heading font-medium text-base">By year</h2>
			<div className="flex flex-col gap-3">
				{years.map((year) => (
					<Card key={year.key} size="sm">
						<CardContent className="flex flex-col gap-3">
							<div className="flex items-baseline justify-between gap-3">
								<h3 className="font-heading font-semibold text-base">
									{year.key}
								</h3>
								<ActivitiesDialog
									activities={year.activities}
									currency={currency}
									subtitle={accountType}
									title={year.key}
								/>
							</div>
							<YearFigures
								accountType={accountType}
								currency={currency}
								kpis={year.kpis}
							/>
						</CardContent>
					</Card>
				))}
			</div>
		</section>
	);
}
