import { InvestmentOverview } from "@/components/investment/investment-overview";
import { RequireDataset } from "@/components/require-dataset";

export default function InvestmentPage() {
	return (
		<RequireDataset>
			<InvestmentOverview />
		</RequireDataset>
	);
}
