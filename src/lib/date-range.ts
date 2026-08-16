import { addDays, addMonths } from "@/lib/calendar-date";

export const DATE_PRESETS = [
	{ value: "all", label: "All dates" },
	{ value: "30d", label: "Last 30 days" },
	{ value: "3m", label: "Last 3 months" },
	{ value: "6m", label: "Last 6 months" },
	{ value: "12m", label: "Last 12 months" },
	{ value: "ytd", label: "Year to date" },
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number]["value"];

const ALL = "all";

export function resolveDateFrom(
	preset: DatePreset,
	datasetEnd: string,
): string | null {
	if (preset === ALL || !datasetEnd) return null;
	if (preset === "ytd") return `${datasetEnd.slice(0, 4)}-01-01`;
	if (preset === "30d") return addDays(datasetEnd, -30);
	return addMonths(
		datasetEnd,
		preset === "3m" ? -3 : preset === "6m" ? -6 : -12,
	);
}
