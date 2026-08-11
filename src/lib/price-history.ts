import {
	ALL_ACCOUNT_TYPES,
	type Coverage,
	type YearAccountStat,
} from "@/lib/analytics";
import type { PriceHistoryResponse } from "@/lib/live-prices";
import { buildPositions } from "@/lib/positions";
import type { Activity } from "@/lib/wealthsimple";

/**
 * What the portfolio was worth at the end of each year — and each month — and
 * what that says about the return.
 *
 * `price-snapshot.ts` values holdings at one moment — now. This values them at
 * every period end the export covers, which is a different problem: the share
 * count changes with each one, and so does the price. Both are recoverable,
 * and neither is guessed:
 *
 * - **Shares** come from re-walking the activity history up to that date with
 *   the same `buildPositions` the rest of the app uses. Filtering the rows and
 *   rebuilding is not a shortcut around a missing feature; it *is* the feature,
 *   because the walk is what knows about renames, splits and cost pools.
 * - **Prices** come from Yahoo's monthly closes, converted at *that month's*
 *   USD→CAD rather than today's.
 *
 * The figure this unlocks is the one the page has never been able to show: the
 * change in unrealised gain over a year. "Earned" counts realised gains,
 * distributions and interest — everything the cash record can prove. What it
 * misses is the holding that went up and was never sold, which for a
 * buy-and-hold portfolio is most of the return.
 */

export interface PriceHistory {
	/** ISO instant the history was fetched. */
	fetchedAt: string;
	source: "yahoo";
	/** Symbol -> (`YYYY-MM` -> that month's close, per share, in CAD). */
	monthlyCad: Record<string, Record<string, number>>;
	/** Symbols asked for that Yahoo had no usable history for. */
	unpriced: string[];
}

/** Folds a response into the stored shape. */
export function historyFromResponse(
	response: PriceHistoryResponse,
): PriceHistory {
	const monthlyCad: Record<string, Record<string, number>> = {};
	for (const series of response.series) {
		monthlyCad[series.symbol] = series.monthlyCad;
	}

	return {
		fetchedAt: response.fetchedAt,
		source: "yahoo",
		monthlyCad,
		unpriced: response.misses.map((miss) => miss.symbol).sort(),
	};
}

export interface ValuePoint {
	/** `YYYY-MM-DD` — the month end, clipped to the last day the export covers. */
	date: string;
	/** `marketValue + unpricedBookCost + cashBalance` — everything, at that date. */
	value: number;
	/** Σ shares × close, over the holdings this history could price. */
	marketValue: number;
	/** Book cost of exactly those holdings. */
	pricedBookCost: number;
	/** Book cost of the ones it couldn't price, carried in `value` at cost. */
	unpricedBookCost: number;
	cashBalance: number;
	/** Symbols held that month with no close for it. */
	missingSymbols: string[];
}

/**
 * What everything was worth at the end of each month the activities cover.
 *
 * `valueYears` answers the same question once a year for the analytics tables;
 * the lead chart needs a line, so this walks the same ground month by month.
 * The rules are `valueYears`' rules — shares from re-walking the history with
 * `buildPositions`, prices from that month's own close, an unpriced holding
 * held at what was paid for it — with one difference worth stating: cash is in
 * the figure. The chart draws this against capital deployed, and money sitting
 * uninvested is still money you have.
 *
 * Scoped by whatever activities it is given, so a page showing one account gets
 * that account's line for free.
 */
export function valueOverTime(
	activities: Activity[],
	history: PriceHistory | null,
): ValuePoint[] {
	if (!history || activities.length === 0) return [];

	// Sorted once, then read as prefixes: `valueYears` re-filters the whole array
	// per bucket, which is affordable a dozen times and not a hundred.
	const sorted = [...activities].sort((a, b) =>
		a.transactionDate.localeCompare(b.transactionDate),
	);
	const lastDate = sorted[sorted.length - 1].transactionDate;

	const points: ValuePoint[] = [];
	let index = 0;

	for (const month of monthsBetween(
		sorted[0].transactionDate.slice(0, 7),
		lastDate.slice(0, 7),
	)) {
		while (
			index < sorted.length &&
			sorted[index].transactionDate.slice(0, 7) <= month
		) {
			index += 1;
		}
		if (index === 0) continue;

		const report = buildPositions(sorted.slice(0, index));
		const missing = new Set<string>();
		let marketValue = 0;
		let pricedBookCost = 0;
		let unpricedBookCost = 0;
		let cashBalance = 0;

		for (const rollup of report.byAccountType) {
			cashBalance += rollup.cashBalance;
		}

		for (const position of report.open) {
			const price = history.monthlyCad[position.symbol]?.[month];
			if (price === undefined) {
				missing.add(position.symbol);
				unpricedBookCost += position.bookCost;
				continue;
			}

			marketValue += position.shares * price;
			pricedBookCost += position.bookCost;
		}

		points.push({
			// The last month is only as far along as the files are; saying so keeps
			// the line from claiming a close it never saw.
			date: min(endOfMonth(month), lastDate),
			cashBalance: round(cashBalance),
			marketValue: round(marketValue),
			missingSymbols: [...missing].sort(),
			pricedBookCost: round(pricedBookCost),
			unpricedBookCost: round(unpricedBookCost),
			value: round(marketValue + unpricedBookCost + cashBalance),
		});
	}

	return points;
}

/** Every `YYYY-MM` from one to the other, inclusive. */
function monthsBetween(from: string, to: string): string[] {
	const months: string[] = [];
	let year = Number(from.slice(0, 4));
	let month = Number(from.slice(5, 7));

	while (`${year}-${String(month).padStart(2, "0")}` <= to) {
		months.push(`${year}-${String(month).padStart(2, "0")}`);
		month += 1;
		if (month > 12) {
			month = 1;
			year += 1;
		}
	}

	return months;
}

/** `2024-02` -> `2024-02-29`. Leap years included, via day zero of the next. */
function endOfMonth(month: string): string {
	const year = Number(month.slice(0, 4));
	const index = Number(month.slice(5, 7));
	const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
	return `${month}-${String(days).padStart(2, "0")}`;
}

export interface YearValuation {
	/** The date valued — the year end, or the last day the export covers. */
	asOf: string;
	/** Market value of the holdings, plus cash, plus anything left at book cost. */
	value: number;
	/** Σ shares × close, over the holdings this history could price. */
	marketValue: number;
	/** Book cost of exactly those holdings — the like-for-like comparison. */
	pricedBookCost: number;
	cashBalance: number;
	/** `marketValue − pricedBookCost`: the paper gain carried at that date. */
	unrealised: number;
	/** How that paper gain moved over the year. The part `earned` can't see. */
	unrealisedChange: number;
	/** Symbols held at that date with no close for that month. */
	missingSymbols: string[];
}

/** The lookup key shared by `valueYears` and the tables that read it. */
export function valuationKey(year: string, accountType: string): string {
	return `${year} ${accountType}`;
}

/**
 * A year-end valuation per year, and per year and account type.
 *
 * Returns a map rather than new stat rows so this stays an overlay, the way
 * `valueWith` is: `analytics.ts` keeps its one definition of every cash figure,
 * and a page without prices renders exactly as it did before.
 */
export function valueYears(
	activities: Activity[],
	history: PriceHistory | null,
	coverage: Coverage,
): Map<string, YearValuation> {
	const valuations = new Map<string, YearValuation>();
	if (!history || activities.length === 0) return valuations;

	const years = [
		...new Set(activities.map((row) => row.transactionDate.slice(0, 4))),
	]
		.filter(Boolean)
		// Ascending, because each year's unrealised *change* is measured against
		// the year before it.
		.sort();

	// Account type -> the unrealised gain it carried at the previous year end.
	const carried = new Map<string, number>();

	for (const year of years) {
		// The current year has no 31 December yet; valuing it at the last day the
		// files cover is the honest stand-in, and the date is reported so a reader
		// can see which it is.
		const asOf = min(`${year}-12-31`, coverage.end || `${year}-12-31`);
		const month = asOf.slice(0, 7);

		const upTo = activities.filter((row) => row.transactionDate <= asOf);
		if (upTo.length === 0) continue;

		const report = buildPositions(upTo);
		const byType = new Map<string, Mutable>();

		for (const rollup of report.byAccountType) {
			byType.set(rollup.accountType, blank(asOf, rollup.cashBalance));
		}

		for (const position of report.open) {
			const row = byType.get(position.accountType);
			if (!row) continue;

			const price = history.monthlyCad[position.symbol]?.[month];
			if (price === undefined) {
				// Held at what was paid for it, exactly as `valueWith` does — an
				// unpriced holding is unknown, never zero.
				row.missing.add(position.symbol);
				row.unpricedBookCost += position.bookCost;
				continue;
			}

			row.marketValue += position.shares * price;
			row.pricedBookCost += position.bookCost;
		}

		const total = blank(asOf, 0);
		for (const [accountType, row] of byType) {
			valuations.set(
				valuationKey(year, accountType),
				finish(row, carried, accountType),
			);

			total.marketValue += row.marketValue;
			total.pricedBookCost += row.pricedBookCost;
			total.unpricedBookCost += row.unpricedBookCost;
			total.cashBalance += row.cashBalance;
			for (const symbol of row.missing) total.missing.add(symbol);
		}

		valuations.set(
			valuationKey(year, ALL_ACCOUNT_TYPES),
			finish(total, carried, ALL_ACCOUNT_TYPES),
		);
	}

	return valuations;
}

interface Mutable {
	asOf: string;
	marketValue: number;
	pricedBookCost: number;
	unpricedBookCost: number;
	cashBalance: number;
	missing: Set<string>;
}

function blank(asOf: string, cashBalance: number): Mutable {
	return {
		asOf,
		cashBalance,
		marketValue: 0,
		missing: new Set<string>(),
		pricedBookCost: 0,
		unpricedBookCost: 0,
	};
}

function finish(
	row: Mutable,
	carried: Map<string, number>,
	accountType: string,
): YearValuation {
	const unrealised = row.marketValue - row.pricedBookCost;
	const previous = carried.get(accountType) ?? 0;
	carried.set(accountType, unrealised);

	return {
		asOf: row.asOf,
		cashBalance: round(row.cashBalance),
		marketValue: round(row.marketValue),
		missingSymbols: [...row.missing].sort(),
		pricedBookCost: round(row.pricedBookCost),
		unrealised: round(unrealised),
		unrealisedChange: round(unrealised - previous),
		value: round(row.marketValue + row.unpricedBookCost + row.cashBalance),
	};
}

export interface ValuedYearStat extends YearAccountStat {
	/** Null for a year this history couldn't value. */
	valuation: YearValuation | null;
	/**
	 * `earned.total + unrealisedChange` — everything the year made, whether or
	 * not it was sold. Null without prices, rather than silently equal to
	 * `earned`, which would quietly claim the paper gain was zero.
	 */
	totalReturn: number | null;
}

/** Joins the cash-flow stats to their valuations. */
export function withValuations(
	stats: YearAccountStat[],
	valuations: Map<string, YearValuation>,
): ValuedYearStat[] {
	return stats.map((stat) => {
		const valuation =
			valuations.get(valuationKey(stat.year, stat.accountType)) ?? null;
		return {
			...stat,
			valuation,
			totalReturn: valuation
				? round(stat.earned.total + valuation.unrealisedChange)
				: null,
		};
	});
}

function min(a: string, b: string): string {
	return a < b ? a : b;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
