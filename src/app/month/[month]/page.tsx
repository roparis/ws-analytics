"use client";

import { use } from "react";
import { MonthDetail } from "@/components/month-detail";
import { RequireDataset } from "@/components/require-dataset";

export default function MonthPage({
	params,
}: {
	params: Promise<{ month: string }>;
}) {
	const { month } = use(params);

	return (
		<RequireDataset>
			<MonthDetail monthKey={month} />
		</RequireDataset>
	);
}
