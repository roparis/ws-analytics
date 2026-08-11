"use client";

import { useMemo } from "react";
import { LivePricesButton } from "@/components/investment/live-prices-button";
import { formatDate } from "@/lib/metrics";
import { buildPositions } from "@/lib/positions";
import {
	STALE_AFTER_DAYS,
	snapshotAgeDays,
	sourceLabel,
} from "@/lib/price-snapshot";
import { useDatasetStore } from "@/stores/dataset";
import { usePriceStore } from "@/stores/prices";

interface LivePricesCardProps {
	/** Icon-only, for the mobile header where the sidebar isn't there. */
	compact?: boolean;
}

/**
 * The sidebar's half of the fetch: it knows the dataset, the button knows the
 * network. Nothing renders until there is something to price — an export with
 * no open holdings would give the button an empty ticker list and a permanently
 * disabled state, which is worse than an absence.
 */
export function LivePricesCard({ compact = false }: LivePricesCardProps) {
	const dataset = useDatasetStore((state) => state.dataset);
	const snapshot = usePriceStore((state) => state.snapshot);

	// The same walk the Investments page makes; memoised on the dataset so a
	// sidebar that renders on every route change doesn't redo it each time.
	const report = useMemo(
		() =>
			dataset
				? buildPositions(dataset.activities, { sources: dataset.sources })
				: null,
		[dataset],
	);

	if (!dataset || !report || report.open.length === 0) return null;

	const age = snapshot ? snapshotAgeDays(snapshot) : 0;
	const hint = snapshot ? (
		<span className={age > STALE_AFTER_DAYS ? "text-background/70" : undefined}>
			Holding prices from {sourceLabel(snapshot)}, {formatDate(snapshot.asOf)}
			{age > STALE_AFTER_DAYS
				? ` — ${age} days old.`
				: age > 0
					? ` — ${age} ${age === 1 ? "day" : "days"} ago.`
					: "."}
		</span>
	) : undefined;

	return (
		<LivePricesButton
			className={compact ? undefined : "w-full"}
			compact={compact}
			currency={dataset.currencies[0] ?? "CAD"}
			hint={hint}
			range={dataset.dateRange}
			report={report}
			// Once prices are in, this is a refresh rather than the thing to do
			// next, and the card above it should carry the weight instead.
			variant={snapshot ? "outline" : "default"}
		/>
	);
}
