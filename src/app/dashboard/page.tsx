import { Dashboard } from "@/components/dashboard";
import { RequireDataset } from "@/components/require-dataset";

export default function DashboardPage() {
	return (
		<main className="flex w-full flex-1 flex-col gap-8 py-6">
			<RequireDataset>
				<Dashboard />
			</RequireDataset>
		</main>
	);
}
