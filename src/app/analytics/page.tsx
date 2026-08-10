import { AnalyticsOverview } from "@/components/analytics/analytics-overview";
import { RequireDataset } from "@/components/require-dataset";

export default function AnalyticsPage() {
	return (
		<main className="flex w-full flex-1 flex-col gap-8 py-6">
			<RequireDataset>
				<AnalyticsOverview />
			</RequireDataset>
		</main>
	);
}
