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
	/** Bank deposits — EFT and any other non-transfer credit. Excludes transfers. */
	moneyIn: number;
	/** Bank withdrawals, as a positive magnitude. Excludes transfers. */
	moneyOut: number;
	/** Distributions only — cashback and interest are reported separately. */
	dividends: number;
	/**
	 * Credit-card cash back only (`BonusPayment`/`CASHBACK`). Referral bonuses and
	 * giveaways are `promo`, matching how `flowBreakdown` splits the same rows.
	 */
	cashback: number;
	/** Referral bonuses, giveaways — every `BonusPayment` that isn't `CASHBACK`. */
	promo: number;
	/** Interest earned on cash balances (Wealthsimple `Interest`, not the margin `InterestCharged`). */
	interest: number;
	/**
	 * Net cash moved between accounts (Wealthsimple `TRANSFER*` rows), signed.
	 * Nets toward zero across all accounts; directional when scoped to one.
	 */
	transfersNet: number;
}

// `Interest` is interest *earned* on a cash balance (income); `InterestCharged`
// is margin interest *paid* (a cost). Wealthsimple names them almost
// identically, so keep them straight.
const INCOME_TYPES = new Set(["Dividend", "BonusPayment", "Interest"]);
const COST_TYPES = new Set([
	"Fee",
	"InterestCharged",
	"Tax",
	"AdministrativePayment",
]);

/**
 * Every activity type `computeKpis` accounts for in its breakdown. A type not
 * listed here still lands in `netCashFlow` (which sums everything) but would be
 * missing from the income/cost/deposit split — so a new Wealthsimple type should
 * be slotted into the sets above rather than left to fall through silently.
 */
export const KNOWN_ACTIVITY_TYPES = new Set<string>([
	"MoneyMovement",
	"Trade",
	// Share-count corrections (e.g. a ticker change). They carry no cash, so
	// there is nothing to slot into the split — listed to keep them from
	// tripping the "unrecognized type" warning on every real export.
	"LegacyCorporateAction",
	...INCOME_TYPES,
	...COST_TYPES,
]);

/**
 * Wealthsimple splits cash movements into two kinds, distinguished by sub-type
 * and by wording: `EFT` rows read "Deposit"/"Withdrawal" and cross the bank
 * boundary, while `TRANSFER`/`TRANSFER_TF` rows read "Money transfer into/out of
 * the account" and move cash between the owner's own accounts (including ones,
 * like WS Cash, that a given export may not contain).
 *
 * Only the bank-boundary rows count as money added or withdrawn; transfers are
 * reported on their own line so nothing is double-counted or hidden. Any
 * TRANSFER* sub-type is a transfer; everything else is treated as external.
 */
export function isTransfer(subType: string | null): boolean {
	return (subType ?? "").startsWith("TRANSFER");
}

/**
 * Chequing/cash accounts (Wealthsimple "Cash", "Save", etc.) are spending
 * accounts, not investments: their deposits are income and their withdrawals
 * are spending, neither of which is a contribution to or withdrawal from your
 * holdings. Their money movements are excluded from `moneyIn`/`moneyOut`/
 * `transfersNet` so those figures track only your investment accounts.
 * Matched on the account-type name, so a real export's "Cash" type is handled
 * without hard-coding account IDs.
 */
const CASH_ACCOUNT_KEYWORDS = ["cash", "chequing", "checking", "save", "spend"];

export function isCashAccount(accountType: string): boolean {
	const type = accountType.toLowerCase();
	return CASH_ACCOUNT_KEYWORDS.some((keyword) => type.includes(keyword));
}

/**
 * Wealthsimple appends `(executed at <date>)` to some descriptions and not
 * others — the same bank deposit reads `Deposit` on one row and
 * `Deposit (executed at 2026-06-04)` on the next. Strip the suffix so a
 * description can be compared against a fixed template.
 */
const EXECUTED_AT = /\s*\(executed at [^)]*\)\s*$/;

/**
 * Does this row's description match `template` exactly, ignoring the optional
 * `(executed at …)` suffix?
 *
 * Matching the whole template rather than a substring matters: the chequing
 * `AFT_IN` rows read "Direct deposit received", which a `includes("Deposit")`
 * test would wrongly pull in alongside the real bank deposits.
 */
export function describedAs(activity: Activity, template: string): boolean {
	return activity.description.replace(EXECUTED_AT, "").trim() === template;
}

/**
 * Cash that crossed the boundary from your linked bank *into* an investment
 * account, identified by the description Wealthsimple writes on the row.
 *
 * Keyed on the description rather than on the sign of `net_cash_amount`: the
 * sign says which way the money went, not what kind of movement it was, so a
 * sign test silently swept in any other non-transfer `MoneyMovement` type that
 * happened to be positive. Every row Wealthsimple means as a bank deposit says
 * so in words.
 */
export function isBankDeposit(activity: Activity): boolean {
	return (
		activity.activityType === "MoneyMovement" &&
		!isCashAccount(activity.accountType) &&
		// Real transfers word themselves differently, so this guard is redundant
		// on today's exports — but a `TRANSFER*` row that ever said "Deposit"
		// would otherwise be counted as new money *and* on the transfers line.
		!isTransfer(activity.activitySubType) &&
		describedAs(activity, "Deposit")
	);
}

/** The withdrawal counterpart of `isBankDeposit`. */
export function isBankWithdrawal(activity: Activity): boolean {
	return (
		activity.activityType === "MoneyMovement" &&
		!isCashAccount(activity.accountType) &&
		!isTransfer(activity.activitySubType) &&
		describedAs(activity, "Withdrawal")
	);
}

/**
 * Does this row count toward `moneyIn`/`moneyOut` — cash that crossed the
 * boundary into or out of an *investment* account?
 *
 * Shared by `computeKpis` and the activity chart's deposits measure so the two
 * can't drift into showing different numbers for the same period.
 */
export function isExternalMoneyMovement(activity: Activity): boolean {
	return isBankDeposit(activity) || isBankWithdrawal(activity);
}

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
	let moneyIn = 0;
	let moneyOut = 0;
	let dividends = 0;
	let cashback = 0;
	let promo = 0;
	let interest = 0;
	let transfersNet = 0;
	let start = "";
	let end = "";

	for (const activity of activities) {
		const amount = activity.netCashAmount;
		netCashFlow += amount;

		if (activity.activityType === "MoneyMovement") {
			netDeposits += amount;
			// Salary in / spending out of a cash account is not an investment
			// contribution or withdrawal, so it never touches these figures.
			// Each side is added signed rather than by magnitude, so a reversal
			// booked against the original description nets it off instead of
			// inflating both totals.
			if (isBankDeposit(activity)) {
				moneyIn += amount;
			} else if (isBankWithdrawal(activity)) {
				moneyOut -= amount;
			} else if (
				!isCashAccount(activity.accountType) &&
				isTransfer(activity.activitySubType)
			) {
				transfersNet += amount;
			}
		} else if (activity.activityType === "Trade") trades += amount;
		else if (INCOME_TYPES.has(activity.activityType)) {
			income += amount;
			if (activity.activityType === "Dividend") dividends += amount;
			else if (activity.activityType === "Interest") interest += amount;
			// Only `CASHBACK` is card cash back; `REFER`/`GIVEAWAY` are promos.
			else if (activity.activitySubType === "CASHBACK") cashback += amount;
			else promo += amount;
		} else if (COST_TYPES.has(activity.activityType)) costs += amount;

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
		moneyIn,
		moneyOut,
		dividends,
		cashback,
		promo,
		interest,
		transfersNet,
	};
}

/**
 * A full cash-flow breakdown: every activity slotted into one labelled line so a
 * user can see exactly where money came from and went. Line values are signed
 * as in the data (deposits/income positive, withdrawals/buys/fees negative), and
 * every activity lands somewhere, so the section totals sum back to net cash
 * flow — nothing is hidden or double-counted.
 */
export type FlowSectionKey =
	| "in"
	| "out"
	| "internal"
	| "investing"
	| "income"
	| "fees"
	| "other";

export interface FlowLine {
	key: string;
	label: string;
	description: string;
	value: number;
	count: number;
}

export interface FlowSection {
	key: FlowSectionKey;
	title: string;
	lines: FlowLine[];
	total: number;
}

export interface FlowBreakdown {
	sections: FlowSection[];
	/** Sum of every line — equals `computeKpis().netCashFlow`. */
	net: number;
}

interface CategoryDef {
	section: FlowSectionKey;
	key: string;
	label: string;
	description: string;
	match: (activity: Activity) => boolean;
}

const isMovement = (subType: string) => (activity: Activity) =>
	activity.activityType === "MoneyMovement" &&
	activity.activitySubType === subType;

// First match wins, so more specific rules (the description-keyed EFT and
// credit-card lines) come before the sub-type catch-alls they overlap with.
const CATEGORIES: CategoryDef[] = [
	{
		section: "in",
		key: "aft_in",
		label: "Direct deposit",
		description: "Payroll and scheduled deposits from your bank",
		match: isMovement("AFT_IN"),
	},
	{
		// Bank <-> Wealthsimple EFT is treated as moving your own money between
		// your linked bank and your accounts, not as external income/spending —
		// so it sits with the transfers, not under Money in/out.
		section: "internal",
		key: "eft_in",
		label: "Deposit from your bank",
		description:
			"Cash you moved in from your linked bank account — this is what Net deposits counts",
		match: (a) =>
			a.activityType === "MoneyMovement" && describedAs(a, "Deposit"),
	},
	{
		section: "internal",
		key: "eft_out",
		label: "Withdrawal to your bank",
		description:
			"Cash you moved back out to your linked bank account — netted off Net deposits",
		match: (a) =>
			a.activityType === "MoneyMovement" && describedAs(a, "Withdrawal"),
	},
	{
		section: "out",
		key: "etransfer",
		label: "Interac e-Transfer",
		description: "Money sent out by e-Transfer",
		match: isMovement("E_TRFOUT"),
	},
	{
		section: "out",
		key: "pad",
		label: "Pre-authorized debit",
		description: "Bills and pre-authorized payments pulled from the account",
		match: isMovement("AFT_OUT"),
	},
	{
		// Wealthsimple books credit-card bill payments as a TRANSFER, but this
		// money leaves the ecosystem to pay a card balance — it is spending, not
		// cash moving between the owner's own accounts. Must precede `transfer`.
		section: "out",
		key: "cc_payment",
		label: "Credit card payment",
		description: "Paying down your Wealthsimple credit card",
		match: (a) =>
			a.activityType === "MoneyMovement" &&
			a.activitySubType === "TRANSFER" &&
			describedAs(a, "Credit card payment"),
	},
	{
		section: "internal",
		key: "transfer",
		label: "Account transfer",
		description: "Cash moved between your Wealthsimple accounts",
		match: isMovement("TRANSFER"),
	},
	{
		section: "internal",
		key: "transfer_tf",
		label: "Registered-account transfer",
		description: "Moved between registered accounts (e.g. TFSA to TFSA)",
		match: isMovement("TRANSFER_TF"),
	},
	{
		section: "investing",
		key: "buy",
		label: "Bought investments",
		description: "Cash used to buy securities or crypto",
		match: (a) => a.activityType === "Trade" && a.netCashAmount < 0,
	},
	{
		section: "investing",
		key: "sell",
		label: "Sold investments",
		description: "Cash returned from selling securities or crypto",
		match: (a) => a.activityType === "Trade" && a.netCashAmount >= 0,
	},
	{
		section: "income",
		key: "dividends",
		label: "Dividends",
		description: "Distributions paid by your holdings",
		match: (a) => a.activityType === "Dividend",
	},
	{
		section: "income",
		key: "interest",
		label: "Interest earned",
		description: "Interest paid on your cash balance",
		match: (a) => a.activityType === "Interest",
	},
	{
		// Card rewards are earnings, not cash shuffled between your own accounts.
		// Filing them here keeps this section's total equal to `Kpis.income`.
		section: "income",
		key: "cashback",
		label: "Credit-card cash back",
		description: "Cash back from the Wealthsimple card",
		match: (a) =>
			a.activityType === "BonusPayment" && a.activitySubType === "CASHBACK",
	},
	{
		section: "income",
		key: "promo",
		label: "Promotions & giveaways",
		description: "Promotional credits and giveaways",
		match: (a) => a.activityType === "BonusPayment",
	},
	{
		section: "fees",
		key: "fees",
		label: "Management fees",
		description: "Wealthsimple management fees",
		match: (a) => a.activityType === "Fee",
	},
	{
		section: "fees",
		key: "margin",
		label: "Margin interest",
		description: "Interest charged on borrowed (margin) funds",
		match: (a) => a.activityType === "InterestCharged",
	},
	{
		section: "fees",
		key: "tax",
		label: "Withholding tax",
		description: "Non-resident and other withholding tax",
		match: (a) => a.activityType === "Tax",
	},
	{
		section: "fees",
		key: "refunds",
		label: "Fee refunds & credits",
		description: "Management-fee refunds and administrative credits",
		match: (a) => a.activityType === "AdministrativePayment",
	},
];

const SECTION_TITLES: Record<FlowSectionKey, string> = {
	in: "Money in",
	out: "Money out",
	internal: "Funding & transfers",
	investing: "Investing",
	income: "Income",
	fees: "Fees & tax",
	other: "Other",
};

const SECTION_ORDER: FlowSectionKey[] = [
	"in",
	"out",
	"internal",
	"investing",
	"income",
	"fees",
	"other",
];

function categorize(activity: Activity): {
	section: FlowSectionKey;
	key: string;
	label: string;
	description: string;
} {
	const hit = CATEGORIES.find((category) => category.match(activity));
	if (hit) return hit;
	// Anything unrecognized still shows up, split by direction, so the breakdown
	// always reconciles and a new type is visible rather than lost.
	return activity.netCashAmount >= 0
		? {
				section: "other",
				key: "other_in",
				label: "Other credits",
				description: "Uncategorized incoming activity",
			}
		: {
				section: "other",
				key: "other_out",
				label: "Other debits",
				description: "Uncategorized outgoing activity",
			};
}

export function flowBreakdown(activities: Activity[]): FlowBreakdown {
	const lines = new Map<string, FlowLine>();
	let net = 0;

	for (const activity of activities) {
		net += activity.netCashAmount;
		const cat = categorize(activity);
		const id = `${cat.section}:${cat.key}`;
		const line = lines.get(id);
		if (line) {
			line.value += activity.netCashAmount;
			line.count += 1;
		} else {
			lines.set(id, {
				key: id,
				label: cat.label,
				description: cat.description,
				value: activity.netCashAmount,
				count: 1,
			});
		}
	}

	// Preserve CATEGORIES order within each section; "other" lines trail.
	const orderOf = new Map<string, number>();
	CATEGORIES.forEach((category, index) => {
		orderOf.set(`${category.section}:${category.key}`, index);
	});

	const sections: FlowSection[] = [];
	for (const sectionKey of SECTION_ORDER) {
		const sectionLines = [...lines.values()]
			.filter((line) => line.key.startsWith(`${sectionKey}:`))
			.sort(
				(a, b) => (orderOf.get(a.key) ?? 999) - (orderOf.get(b.key) ?? 999),
			);
		if (sectionLines.length === 0) continue;
		sections.push({
			key: sectionKey,
			title: SECTION_TITLES[sectionKey],
			lines: sectionLines,
			total: sectionLines.reduce((sum, line) => sum + line.value, 0),
		});
	}

	return { sections, net };
}

export interface MonthGroup {
	/** `2026-06` — sortable and used as the detail route param. */
	key: string;
	label: string;
	activities: Activity[];
	kpis: Kpis;
	/** Account types active that month, sorted. */
	accountTypes: string[];
}

export function monthLabel(key: string): string {
	if (!/^\d{4}-\d{2}$/.test(key)) return key;
	return new Date(`${key}-01T00:00:00`).toLocaleDateString("en-CA", {
		year: "numeric",
		month: "long",
	});
}

/** Newest month first. Months with no activity are omitted rather than padded. */
export function groupByMonth(activities: Activity[]): MonthGroup[] {
	const buckets = new Map<string, Activity[]>();

	for (const activity of activities) {
		const key = activity.transactionDate.slice(0, 7);
		if (!key) continue;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(activity);
		else buckets.set(key, [activity]);
	}

	return [...buckets.entries()]
		.sort((a, b) => b[0].localeCompare(a[0]))
		.map(([key, rows]) => ({
			key,
			label: monthLabel(key),
			activities: rows,
			kpis: computeKpis(rows),
			accountTypes: [...new Set(rows.map((row) => row.accountType))].sort(),
		}));
}

export interface YearGroup {
	/** `2026` — sortable and used as the section anchor. */
	key: string;
	activities: Activity[];
	kpis: Kpis;
	/** The year's months, newest first — the same objects `groupByMonth` returns. */
	months: MonthGroup[];
}

/**
 * Newest year first, mirroring `groupByMonth`. Delegates to `computeKpis` and
 * `groupByMonth` for each year's bucket rather than re-deriving their figures,
 * so a year's totals and its month cards can never drift apart.
 */
export function groupByYear(activities: Activity[]): YearGroup[] {
	const buckets = new Map<string, Activity[]>();

	for (const activity of activities) {
		const key = activity.transactionDate.slice(0, 4);
		if (!key) continue;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(activity);
		else buckets.set(key, [activity]);
	}

	return [...buckets.entries()]
		.sort((a, b) => b[0].localeCompare(a[0]))
		.map(([key, rows]) => ({
			key,
			activities: rows,
			kpis: computeKpis(rows),
			months: groupByMonth(rows),
		}));
}

export interface AccountGroup {
	id: string;
	accountType: string;
	activities: Activity[];
	kpis: Kpis;
}

/**
 * Accounts present in `activities`, busiest first so the account actually in use
 * leads the page. Ties break on id so the order never jitters between renders.
 */
export function groupByAccount(activities: Activity[]): AccountGroup[] {
	const buckets = new Map<string, Activity[]>();

	for (const activity of activities) {
		const bucket = buckets.get(activity.accountId);
		if (bucket) bucket.push(activity);
		else buckets.set(activity.accountId, [activity]);
	}

	return [...buckets.entries()]
		.map(([id, rows]) => ({
			id,
			accountType: rows[0].accountType,
			activities: rows,
			kpis: computeKpis(rows),
		}))
		.sort(
			(a, b) =>
				b.activities.length - a.activities.length || a.id.localeCompare(b.id),
		);
}

export interface YearBreakdown {
	/** `2026` — the category on the time axis. */
	year: string;
	/**
	 * Gross cash spent on buys, as a positive magnitude. Deliberately *not*
	 * netted against `sold` — `Kpis.netCapitalDeployed` is the netted figure and
	 * is what the rest of the app calls "Invested", so this one is named for the
	 * `flowBreakdown` line it matches ("Bought investments") to keep the two
	 * meanings from colliding.
	 */
	bought: number;
	/** Gross cash returned by sells. */
	sold: number;
	/** Distributions only — interest and cash back are deliberately excluded. */
	dividends: number;
	/** Fees, margin interest and tax net of refunds, as a positive magnitude. */
	fees: number;
}

/**
 * Per-year totals for the four figures the account chart contrasts: what went
 * into the market, what came back out of it, what it paid, and what it cost.
 * Every value is a positive magnitude — the chart decides which way each one
 * points — so a caller can't accidentally add an outflow to an inflow. Years
 * with no activity are omitted rather than padded, as in `groupByMonth`, and
 * the result runs oldest first because the chart reads left to right.
 */
export function breakdownByYear(activities: Activity[]): YearBreakdown[] {
	const buckets = new Map<string, YearBreakdown>();

	for (const activity of activities) {
		const year = activity.transactionDate.slice(0, 4);
		if (!year) continue;

		let row = buckets.get(year);
		if (!row) {
			row = { year, bought: 0, sold: 0, dividends: 0, fees: 0 };
			buckets.set(year, row);
		}

		const amount = activity.netCashAmount;
		if (activity.activityType === "Trade") {
			if (amount < 0) row.bought -= amount;
			else row.sold += amount;
		} else if (activity.activityType === "Dividend") {
			row.dividends += amount;
		} else if (COST_TYPES.has(activity.activityType)) {
			row.fees -= amount;
		}
	}

	return [...buckets.values()].sort((a, b) => a.year.localeCompare(b.year));
}

/**
 * Resolves a URL param back to the value as it appears in the data. Account
 * types and ids are free-form CSV strings, so a slug round-trip isn't reliable —
 * the param is matched against what's actually loaded instead. Returns
 * `undefined` when the value isn't in the current files, which the caller shows
 * as an empty state rather than an error.
 */
export function matchDatasetValue(
	values: string[],
	param: string,
): string | undefined {
	let decoded = param;
	try {
		decoded = decodeURIComponent(param);
	} catch {
		// A malformed escape sequence just means the raw param is all we have.
	}

	return (
		values.find((value) => value === decoded) ??
		values.find((value) => value.toLowerCase() === decoded.toLowerCase())
	);
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
