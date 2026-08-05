"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import {
	MonthCard,
	monthAnchorId,
	RETURN_ANCHOR_KEY,
} from "@/components/timeline/month-card";
import { groupByMonth } from "@/lib/metrics";
import type { Activity } from "@/lib/wealthsimple";

interface TimelineFeedProps {
	activities: Activity[];
	currency: string;
}

export function TimelineFeed({ activities, currency }: TimelineFeedProps) {
	const groups = useMemo(() => groupByMonth(activities), [activities]);
	const restored = useRef(false);

	// Anchoring to the opened card rather than a saved pixel offset: the feed has
	// zero height until IndexedDB resolves, so by the time content exists the
	// browser has already given up on restoring a scroll position.
	useLayoutEffect(() => {
		if (restored.current || groups.length === 0) return;
		restored.current = true;

		const key = sessionStorage.getItem(RETURN_ANCHOR_KEY);
		if (!key) return;
		sessionStorage.removeItem(RETURN_ANCHOR_KEY);

		document
			.getElementById(monthAnchorId(key))
			?.scrollIntoView({ block: "center" });
	}, [groups.length]);

	if (groups.length === 0) {
		return (
			<p className="py-10 text-center text-muted-foreground text-sm">
				No activity to show.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{groups.map((group) => (
				<MonthCard currency={currency} group={group} key={group.key} />
			))}
		</div>
	);
}
