import type { Activity } from "@/lib/wealthsimple";

export interface ActivityFilters {
	accountTypes: string[];
	accountIds: string[];
	activityTypes: string[];
	dateFrom: string | null;
	dateTo: string | null;
}

export interface Kpis {
	netDeposits: number;
	netCapitalDeployed: number;
	income: number;
	costs: number;
	netCashFlow: number;
	count: number;
	dateRange: { start: string; end: string };
}

const INCOME_TYPES = new Set(["Dividend", "BonusPayment"]);
const COST_TYPES = new Set([
	"Fee",
	"InterestCharged",
	"Tax",
	"AdministrativePayment",
]);

export const EMPTY_FILTERS: ActivityFilters = {
	accountTypes: [],
	accountIds: [],
	activityTypes: [],
	dateFrom: null,
	dateTo: null,
};

export function filterActivities(
	activities: Activity[],
	filters: ActivityFilters,
): Activity[] {
	return activities.filter((activity) => {
		if (
			filters.accountTypes.length > 0 &&
			!filters.accountTypes.includes(activity.accountType)
		) {
			return false;
		}
		if (
			filters.accountIds.length > 0 &&
			!filters.accountIds.includes(activity.accountId)
		) {
			return false;
		}
		if (
			filters.activityTypes.length > 0 &&
			!filters.activityTypes.includes(activity.activityType)
		) {
			return false;
		}
		if (filters.dateFrom && activity.transactionDate < filters.dateFrom) {
			return false;
		}
		if (filters.dateTo && activity.transactionDate > filters.dateTo) {
			return false;
		}
		return true;
	});
}

export function computeKpis(activities: Activity[]): Kpis {
	let netDeposits = 0;
	let trades = 0;
	let income = 0;
	let costs = 0;
	let netCashFlow = 0;
	let start = "";
	let end = "";

	for (const activity of activities) {
		const amount = activity.netCashAmount;
		netCashFlow += amount;

		if (activity.activityType === "MoneyMovement") netDeposits += amount;
		else if (activity.activityType === "Trade") trades += amount;
		else if (INCOME_TYPES.has(activity.activityType)) income += amount;
		else if (COST_TYPES.has(activity.activityType)) costs += amount;

		const date = activity.transactionDate;
		if (start === "" || date < start) start = date;
		if (end === "" || date > end) end = date;
	}

	return {
		netDeposits,
		netCapitalDeployed: -trades,
		income,
		costs: -costs,
		netCashFlow,
		count: activities.length,
		dateRange: { start, end },
	};
}

export function formatCurrency(value: number, currency = "CAD"): string {
	return new Intl.NumberFormat("en-CA", {
		style: "currency",
		currency,
		maximumFractionDigits: 2,
		// Negating an empty sum yields -0, which Intl would render as "-$0.00".
	}).format(value === 0 ? 0 : value);
}

export function formatDate(value: string): string {
	if (!value) return "—";
	return new Date(`${value}T00:00:00`).toLocaleDateString("en-CA", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
