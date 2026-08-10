import {
	computeKpis,
	EMPTY_FILTERS,
	filterActivities,
	isCashAccount,
	type Kpis,
} from "@/lib/metrics";
import type { PositionsReport, RealizationEvent } from "@/lib/positions";
import type { Activity } from "@/lib/wealthsimple";

/**
 * The history side of the analytics page: what each year and each account type
 * actually did, and where a projection should start from.
 *
 * Every figure here is derived from `metrics.ts` and `positions.ts` rather than
 * recomputed. The app already has one definition of "invested" and one of
 * "withdrawn"; a second set that disagreed by a rounding rule would be worse
 * than not having the page at all.
 */

/** The period a set of figures covers — `MergedDataset.dateRange`. */
export interface Coverage {
	start: string;
	end: string;
}

/**
 * Everything an account gained that didn't come out of your pocket.
 *
 * Reconciles against `(book cost + cash) − money added`, which is the check
 * that keeps the breakdown honest: the parts have to add up to the gap they
 * claim to explain.
 */
export interface Earned {
	/** Sum of the parts below. */
	total: number;
	/** Proceeds less the cost released, on positions actually sold. */
	realized: number;
	dividends: number;
	interest: number;
	/** Cash back, referrals and giveaways. */
	bonuses: number;
	/** Fees, margin interest and withholding tax. Positive; subtracted. */
	feesAndTax: number;
}

export const NO_EARNINGS: Earned = {
	total: 0,
	realized: 0,
	dividends: 0,
	interest: 0,
	bonuses: 0,
	feesAndTax: 0,
};

/**
 * The one definition of "earned" in the app.
 *
 * Built from its parts rather than as `value − added`, so a tooltip's breakdown
 * *is* the figure and can't drift from it. Everything but the realised gain
 * comes from `Kpis`, which means the same function works whatever the scope is
 * — one account, one account type, or one year of one type — as long as the
 * realised figure was measured over that same scope.
 *
 * `Kpis.costs` already combines fees, margin interest and tax as a positive
 * magnitude, matching `AccountRollup.fees + .withholdingTax` row for row.
 */
export function earnedFrom(kpis: Kpis, realized: number): Earned {
	const bonuses = kpis.cashback + kpis.promo;
	return {
		total: realized + kpis.dividends + kpis.interest + bonuses - kpis.costs,
		realized,
		dividends: kpis.dividends,
		interest: kpis.interest,
		bonuses,
		feesAndTax: kpis.costs,
	};
}

/** The middle value, averaging the two middles on an even count. 0 on empty. */
export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The `YYYY-MM` keys in `year` that the loaded files actually cover.
 *
 * This is what makes a median meaningful. Taking it over all twelve months
 * would report a first year that started in September as nine months of zero
 * contributions, and taking it over only the months with activity would report
 * a "typical" pace that skips every month the reader didn't contribute — which
 * is precisely the thing a median is supposed to catch.
 */
export function coveredMonths(year: string, coverage: Coverage): string[] {
	const from = coverage.start.slice(0, 7);
	const to = coverage.end.slice(0, 7);
	const months: string[] = [];

	for (let month = 1; month <= 12; month += 1) {
		const key = `${year}-${String(month).padStart(2, "0")}`;
		// A month counts as covered if any of its days are, so the comparison is
		// on the `YYYY-MM` prefix rather than on a day boundary.
		if (from && key < from) continue;
		if (to && key > to) continue;
		months.push(key);
	}

	return months;
}

export interface YearAccountStat {
	/** `2026`. */
	year: string;
	/** The account type, or `ALL_ACCOUNT_TYPES` for every type together. */
	accountType: string;
	/** `Kpis.netCapitalDeployed` — cash put into the market, net of sales. */
	invested: number;
	/** `Kpis.moneyIn` — deposits from your bank. */
	deposited: number;
	/** `Kpis.moneyOut` — bank withdrawals, as a positive magnitude. */
	withdrawn: number;
	/** Net cash moved between your own accounts, signed. */
	transfers: number;
	dividends: number;
	/** Fees, margin interest and tax, as a positive magnitude. */
	costs: number;
	/** What the money made on its own, decomposed. */
	earned: Earned;
	/** Median of the covered months' `invested`. */
	medianMonthlyInvested: number;
	/** Median of the covered months' `deposited`. */
	medianMonthlyDeposited: number;
	/** How many of the year's months the loaded files cover. */
	monthsCovered: number;
	/** How many of those months had a deposit — the consistency signal. */
	monthsDeposited: number;
}

/** The `accountType` on a row that spans every type. Not a real type name. */
export const ALL_ACCOUNT_TYPES = "";

function statFor(
	year: string,
	accountType: string,
	rows: Activity[],
	realizations: RealizationEvent[],
	coverage: Coverage,
): YearAccountStat {
	const kpis = computeKpis(rows);

	const realized = realizations
		.filter(
			(event) =>
				event.date.slice(0, 4) === year &&
				(accountType === ALL_ACCOUNT_TYPES ||
					event.accountType === accountType),
		)
		.reduce((total, event) => total + event.amount, 0);

	const byMonth = new Map<string, Activity[]>();
	for (const row of rows) {
		const key = row.transactionDate.slice(0, 7);
		const bucket = byMonth.get(key);
		if (bucket) bucket.push(row);
		else byMonth.set(key, [row]);
	}

	const months = coveredMonths(year, coverage);
	const monthly = months.map((key) => computeKpis(byMonth.get(key) ?? []));

	return {
		year,
		accountType,
		invested: kpis.netCapitalDeployed,
		deposited: kpis.moneyIn,
		withdrawn: kpis.moneyOut,
		transfers: kpis.transfersNet,
		dividends: kpis.dividends,
		costs: kpis.costs,
		earned: earnedFrom(kpis, realized),
		medianMonthlyInvested: median(monthly.map((one) => one.netCapitalDeployed)),
		medianMonthlyDeposited: median(monthly.map((one) => one.moneyIn)),
		monthsCovered: months.length,
		monthsDeposited: monthly.filter((one) => one.moneyIn > 0).length,
	};
}

/** Years present in the activities, newest first — as `groupByYear` orders. */
function yearsIn(activities: Activity[]): string[] {
	const years = new Set<string>();
	for (const activity of activities) {
		const year = activity.transactionDate.slice(0, 4);
		if (year) years.add(year);
	}
	return [...years].sort((a, b) => b.localeCompare(a));
}

/**
 * One row per year, over every account type at once.
 *
 * Note what `transfers` means at this scope: movements between the reader's own
 * accounts net to roughly zero across the whole dataset, so that column is only
 * interesting on the per-type rows below.
 */
export function yearTotals(
	activities: Activity[],
	report: PositionsReport,
	coverage: Coverage,
): YearAccountStat[] {
	const byYear = new Map<string, Activity[]>();
	for (const activity of activities) {
		const year = activity.transactionDate.slice(0, 4);
		if (!year) continue;
		const bucket = byYear.get(year);
		if (bucket) bucket.push(activity);
		else byYear.set(year, [activity]);
	}

	return yearsIn(activities).map((year) =>
		statFor(
			year,
			ALL_ACCOUNT_TYPES,
			byYear.get(year) ?? [],
			report.realizations,
			coverage,
		),
	);
}

/**
 * One row per year and account type — the cross-tab the app has only ever
 * written to a spreadsheet.
 *
 * Pairs with no activity at all are left out rather than padded with zeros, so
 * an account opened last year doesn't add empty rows to every year before it.
 */
export function yearAccountStats(
	activities: Activity[],
	report: PositionsReport,
	coverage: Coverage,
): YearAccountStat[] {
	// The map carries the key's parts rather than relying on splitting it back
	// apart: an account type is a free-form label that may contain anything,
	// including whatever separator seemed safe here.
	interface Bucket {
		year: string;
		accountType: string;
		rows: Activity[];
	}

	const buckets = new Map<string, Bucket>();
	for (const activity of activities) {
		const year = activity.transactionDate.slice(0, 4);
		if (!year) continue;

		const key = `${year} ${activity.accountType}`;
		const bucket = buckets.get(key);
		if (bucket) {
			bucket.rows.push(activity);
		} else {
			buckets.set(key, {
				year,
				accountType: activity.accountType,
				rows: [activity],
			});
		}
	}

	return [...buckets.values()]
		.map((bucket) =>
			statFor(
				bucket.year,
				bucket.accountType,
				bucket.rows,
				report.realizations,
				coverage,
			),
		)
		.sort(
			(a, b) =>
				b.year.localeCompare(a.year) ||
				a.accountType.localeCompare(b.accountType),
		);
}

/**
 * Where a projection starts from, per account type.
 *
 * Without prices this can only be **book cost plus cash** — what was paid for
 * the holdings, not what they are worth now. That understates any account that
 * has gained, and the page has to keep saying so rather than letting a
 * confident-looking curve imply otherwise. The reader can type over any of
 * these, and Phase 2's price snapshot replaces the default outright.
 *
 * Chequing-style accounts are left out entirely, for the same reason `moneyIn`
 * and `moneyOut` exclude them: their balance is salary waiting to be spent, not
 * capital at work. Compounding a spending float at an equity return would pad
 * the projection with money that is earmarked for rent.
 */
export function startingBalances(
	report: PositionsReport,
): Record<string, number> {
	const balances: Record<string, number> = {};
	for (const row of report.byAccountType) {
		if (isCashAccount(row.accountType)) continue;
		// Rounded to cents: this lands in an editable money field, and a reader
		// should not be handed `11354.128674134674` to edit around.
		balances[row.accountType] =
			Math.round((row.bookCost + row.cashBalance) * 100) / 100;
	}
	return balances;
}

/** The reader's overrides applied over the derived defaults. */
export function applyOverrides(
	defaults: Record<string, number>,
	overrides: Record<string, number>,
): Record<string, number> {
	const merged: Record<string, number> = { ...defaults };
	for (const [type, value] of Object.entries(overrides)) {
		// Only for types the dataset actually has: a stale override left by a file
		// that has since been removed would otherwise project a phantom account.
		if (type in merged && Number.isFinite(value)) merged[type] = value;
	}
	return merged;
}

/** Every activity for one account type — the scope helper the page repeats. */
export function forAccountType(
	activities: Activity[],
	accountType: string,
): Activity[] {
	return filterActivities(activities, {
		...EMPTY_FILTERS,
		accountTypes: [accountType],
	});
}
