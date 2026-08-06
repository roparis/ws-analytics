"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { ActivitiesDialog } from "@/components/activities-dialog";
import {
	MonthCard,
	monthAnchorId,
	RETURN_ANCHOR_KEY,
} from "@/components/timeline/month-card";
import { YearFigures } from "@/components/year-figures";
import { groupByYear } from "@/lib/metrics";
import type { Activity } from "@/lib/wealthsimple";

interface TimelineFeedProps {
	activities: Activity[];
	currency: string;
}

export function TimelineFeed({ activities, currency }: TimelineFeedProps) {
	const years = useMemo(() => groupByYear(activities), [activities]);
	const restored = useRef(false);

	// Anchoring to the opened card rather than a saved pixel offset: the feed has
	// zero height until IndexedDB resolves, so by the time content exists the
	// browser has already given up on restoring a scroll position.
	useLayoutEffect(() => {
		if (restored.current || years.length === 0) return;
		restored.current = true;

		const key = sessionStorage.getItem(RETURN_ANCHOR_KEY);
		if (!key) return;
		sessionStorage.removeItem(RETURN_ANCHOR_KEY);

		document
			.getElementById(monthAnchorId(key))
			?.scrollIntoView({ block: "center" });
	}, [years.length]);

	if (years.length === 0) {
		return (
			<p className="py-10 text-center text-muted-foreground text-sm">
				No activity to show.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			{years.map((year) => (
				<section className="flex flex-col gap-4" key={year.key}>
					{/* Pinned while its year is on screen, then pushed off by the next
					year's bar — the document body is the only scroll container in this
					app (see app-shell.tsx), so `sticky top-0` works directly against the
					viewport with no extra wiring. `z-10` keeps it under the mobile bottom
					nav (`z-20`) and popovers (`z-50`). */}
					<div className="sticky top-0 z-10 flex flex-col gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
						<div className="flex items-baseline justify-between gap-3">
							<h2 className="font-heading font-semibold text-lg">{year.key}</h2>
							<ActivitiesDialog
								activities={year.activities}
								currency={currency}
								title={year.key}
							/>
						</div>
						<YearFigures currency={currency} kpis={year.kpis} />
					</div>

					<div className="flex flex-col gap-4 px-4">
						{year.months.map((group) => (
							<MonthCard currency={currency} group={group} key={group.key} />
						))}
					</div>
				</section>
			))}
		</div>
	);
}
