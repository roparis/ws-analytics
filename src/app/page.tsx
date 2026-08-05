"use client";

import { RequireDataset } from "@/components/require-dataset";
import { RightRail } from "@/components/timeline/right-rail";
import { TimelineFeed } from "@/components/timeline/timeline-feed";
import { useDatasetStore } from "@/stores/dataset";

function Timeline() {
	const dataset = useDatasetStore((state) => state.dataset);
	if (!dataset) return null;

	return (
		<div className="flex flex-1 gap-6">
			<main className="flex min-w-0 flex-1 flex-col gap-4 py-6">
				<h1 className="font-semibold text-lg">Timeline</h1>
				<TimelineFeed
					activities={dataset.activities}
					currency={dataset.currencies[0] ?? "CAD"}
				/>
			</main>
			<RightRail dataset={dataset} />
		</div>
	);
}

export default function Home() {
	return (
		<RequireDataset>
			<Timeline />
		</RequireDataset>
	);
}
