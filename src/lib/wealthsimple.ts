import Papa from "papaparse";
import type { SourceFile } from "@/lib/merge";
import { isMarginAccount, KNOWN_ACTIVITY_TYPES } from "@/lib/metrics";

const REQUIRED_COLUMNS = [
	"account_id",
	"account_type",
	"activity_type",
	"activity_sub_type",
	"description",
	"symbol",
	"name",
	"currency",
	"quantity",
	"unit_price",
	"commission",
	"net_cash_amount",
] as const;

/**
 * Wealthsimple renamed the date column and changed its type partway through
 * 2026. Exports before the change carry `transaction_date` holding a bare
 * `YYYY-MM-DD`; newer ones carry `effective_at` holding a full ISO timestamp
 * with the account's UTC offset (`2026-08-06T15:31:21-04:00`).
 *
 * Both are accepted, and both reduce to the same calendar date. Listed newest
 * first so a file carrying both would be read the modern way.
 */
const DATE_COLUMNS = ["effective_at", "transaction_date"] as const;

/**
 * Matches a bare date and the leading date of a timestamp alike. Deliberately
 * not anchored at the end: exports finish with a footer row such as
 * `"As of 2026-08-03 16:48 GMT-04:00"`, which still fails to match and is
 * dropped, but a legitimate `2026-08-06T15:31:21-04:00` must pass.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * The calendar date a row belongs to.
 *
 * Taken by slicing the first ten characters rather than by parsing to a `Date`.
 * The timestamp already states the date in the account's own timezone, so
 * converting to UTC would push every transaction after 20:00 local onto the
 * following day — silently moving trades between months and tax years.
 */
function toTransactionDate(value: string): string {
	return ISO_DATE.test(value) ? value.slice(0, 10) : "";
}

/**
 * Bump whenever parsing changes semantics. Persisted sources carry the version
 * they were parsed with; a mismatch re-parses the stored raw text rather than
 * serving rows produced by known-stale logic.
 *
 * 2: accept `effective_at`, and keep the time of day it carries.
 */
export const PARSER_VERSION = 2;

export interface Activity {
	/** `YYYY-MM-DD`, in the account's own timezone. */
	transactionDate: string;
	/**
	 * The full timestamp when the export provides one, so same-day activity can
	 * be ordered by when it actually happened. Null on the older format, which
	 * only ever stated a date.
	 */
	effectiveAt: string | null;
	settlementDate: string | null;
	accountId: string;
	accountType: string;
	activityType: string;
	activitySubType: string | null;
	description: string;
	symbol: string | null;
	name: string | null;
	currency: string;
	quantity: number | null;
	unitPrice: number | null;
	commission: number | null;
	netCashAmount: number;
}

export interface AccountRef {
	id: string;
	accountType: string;
}

export interface ActivityDataset {
	fileName: string;
	activities: Activity[];
	accountTypes: string[];
	accounts: AccountRef[];
	activityTypes: string[];
	dateRange: { start: string; end: string };
	currencies: string[];
}

function text(value: string | undefined): string {
	return (value ?? "").trim();
}

function optionalText(value: string | undefined): string | null {
	const trimmed = text(value);
	return trimmed === "" || trimmed === "-" ? null : trimmed;
}

function toNumber(value: string | undefined): number | null {
	const trimmed = text(value);
	if (trimmed === "") return null;
	const parsed = Number(trimmed);
	return Number.isNaN(parsed) ? null : parsed;
}

function toActivity(row: Record<string, string>, dateColumn: string): Activity {
	const raw = text(row[dateColumn]);
	return {
		transactionDate: toTransactionDate(raw),
		// Only a timestamp carries a time; a bare date tells us nothing about when.
		effectiveAt: raw.length > 10 ? raw : null,
		settlementDate: optionalText(row.settlement_date),
		accountId: text(row.account_id),
		accountType: text(row.account_type),
		activityType: text(row.activity_type),
		activitySubType: optionalText(row.activity_sub_type),
		description: text(row.description),
		symbol: optionalText(row.symbol),
		name: optionalText(row.name),
		currency: text(row.currency) || "CAD",
		quantity: toNumber(row.quantity),
		unitPrice: toNumber(row.unit_price),
		commission: toNumber(row.commission),
		netCashAmount: toNumber(row.net_cash_amount) ?? 0,
	};
}

/**
 * The residual cash balance an account may carry before we suspect rows are
 * missing. Real balances are small — the reference export's eight accounts all
 * land under $150 — so a large residual means dropped, duplicated or
 * sign-flipped rows rather than a genuinely idle balance.
 */
const CASH_RESIDUAL_LIMIT = 10_000;

/**
 * Trade arithmetic reconciles to the cent, but Wealthsimple rounds the cash
 * total independently of the quantity and price it reports — a $25 crypto buy
 * books as exactly -25.00 while qty x price + commission works out to -24.99.
 * Two cents absorbs that rounding without hiding a real mismatch.
 */
const CENT = 0.02;

/**
 * Below this, a share total is float dust from summing rather than a holding —
 * the smallest real position in a reference export is 0.006782 BTC, and a
 * single crypto buy is 0.00019052 units. Matches `SHARE_EPSILON` in
 * `positions.ts`, which does the same snapping on the reconstructed pools.
 */
const SHARE_DUST = 1e-6;

/**
 * Checks the invariants documented in `docs/wealthsimple-csv-format.md` §6
 * against a parsed dataset. These can only be meaningfully tested on real data
 * — a hand-built fixture just re-asserts whatever it was typed with — so they
 * run at parse time on whatever file the user actually loads, which is what
 * catches a change to Wealthsimple's export format.
 *
 * Returns human-readable violations; empty means the file behaved as documented.
 */
export function validateDataset(activities: Activity[]): string[] {
	const problems: string[] = [];
	const residuals = new Map<string, { total: number; accountType: string }>();
	const shares = new Map<string, number>();

	for (const activity of activities) {
		// I3/I4 — share counts per symbol, over the two types that carry a share
		// delta. `src/lib/positions.ts` reconstructs holdings from exactly this
		// sum, so a violation here means the holdings view is built on sand.
		if (
			activity.symbol &&
			activity.quantity !== null &&
			(activity.activityType === "Trade" ||
				activity.activityType === "LegacyCorporateAction")
		) {
			shares.set(
				activity.symbol,
				(shares.get(activity.symbol) ?? 0) + activity.quantity,
			);
		}
	}

	for (const [symbol, held] of shares) {
		// The file quotes quantities to at most 8 decimals, but adding several
		// hundred of them in binary floating point leaves dust — a closed ZFL
		// position sums to 2.3e-13 rather than to zero. Round back to the
		// precision the file actually states before judging the total, or this
		// check only ever reports its own arithmetic.
		const total = Number(held.toFixed(8));

		// I3 — a symbol can't go short. A negative total means buys are missing.
		if (total < 0) {
			problems.push(
				`${symbol}: shares sum to ${total}, which is negative — buys are missing from this export`,
			);
		} else if (total !== 0 && total < SHARE_DUST) {
			// I4 — an exited position lands on exactly 0 in a healthy export. A
			// residual that survives rounding is a dropped row or a real dust
			// holding the file failed to clear.
			problems.push(
				`${symbol}: shares sum to ${total} rather than exactly 0 — a closed position left a residual`,
			);
		}
	}

	for (const activity of activities) {
		const { quantity, unitPrice, commission, netCashAmount } = activity;
		const where = `${activity.transactionDate} ${activity.accountId} ${activity.activityType}`;

		// I1 — net cash is exactly the trade consideration plus commission.
		if (activity.activityType === "Trade") {
			if (quantity !== null && unitPrice !== null) {
				const expected = -(quantity * unitPrice) - (commission ?? 0);
				if (Math.abs(expected - netCashAmount) > CENT) {
					problems.push(
						`${where}: net cash ${netCashAmount} != -(qty x price) - commission (${expected.toFixed(2)})`,
					);
				}
			}
		} else if (
			// I2 — on every non-trade row `quantity` is a dollar amount, and equals
			// net cash. Corporate actions carry a share delta and no cash, so skip.
			activity.activityType !== "LegacyCorporateAction" &&
			quantity !== null &&
			Math.abs(quantity - netCashAmount) > CENT
		) {
			problems.push(
				`${where}: quantity ${quantity} != net cash ${netCashAmount} on a non-trade row`,
			);
		}

		const residual = residuals.get(activity.accountId);
		if (residual) residual.total += netCashAmount;
		else {
			residuals.set(activity.accountId, {
				total: netCashAmount,
				accountType: activity.accountType,
			});
		}
	}

	// I5 — per-account net cash is that account's uninvested cash balance. A
	// margin account is the one place a negative balance is ordinary rather than
	// impossible: it means money was borrowed, which is what the account is for.
	for (const [accountId, { total, accountType }] of residuals) {
		const floor = isMarginAccount(accountType)
			? Number.NEGATIVE_INFINITY
			: -CENT;
		if (total < floor || total > CASH_RESIDUAL_LIMIT) {
			problems.push(
				`${accountId}: net cash sums to ${total.toFixed(2)}, which is not a plausible cash balance — rows may be missing or duplicated`,
			);
		}
	}

	return problems;
}

/** Parses raw CSV text. Text (not File) so the same path serves uploads and
 * re-parses of persisted sources. */
export function parseActivities(
	rawText: string,
	fileName: string,
): Promise<SourceFile> {
	return new Promise((resolve, reject) => {
		Papa.parse<Record<string, string>>(rawText, {
			header: true,
			skipEmptyLines: true,
			// Multi-year exports run to several MB; parsing on the main thread
			// freezes the tab for the whole read.
			worker: true,
			complete: (results) => {
				const fields = results.meta.fields ?? [];
				const dateColumn = DATE_COLUMNS.find((column) =>
					fields.includes(column),
				);
				const missing: string[] = REQUIRED_COLUMNS.filter(
					(column) => !fields.includes(column),
				);
				if (!dateColumn) missing.unshift(DATE_COLUMNS.join(" or "));

				if (!dateColumn || missing.length > 0) {
					reject(
						new Error(
							`${fileName} doesn't look like a Wealthsimple activities export. Missing columns: ${missing.join(", ")}.`,
						),
					);
					return;
				}

				const activities = results.data
					.map((row) => toActivity(row, dateColumn))
					.filter((activity) => activity.transactionDate !== "");

				if (activities.length === 0) {
					reject(new Error(`${fileName} contains no activities.`));
					return;
				}

				// Surface any activity type the metrics breakdown doesn't account
				// for, so a new Wealthsimple type is noticed rather than silently
				// dropped from the income/cost/deposit split.
				const unknown = [
					...new Set(
						activities
							.map((activity) => activity.activityType)
							.filter((type) => !KNOWN_ACTIVITY_TYPES.has(type)),
					),
				];
				if (unknown.length > 0) {
					console.warn(
						`${fileName}: unrecognized activity types not in the KPI breakdown: ${unknown.join(", ")}. They still count in net cash flow.`,
					);
				}

				// The invariants are the export's own self-check, so they run in
				// every build rather than only in development. The messages name
				// accounts and balances, so they travel to the UI on the source
				// itself instead of to a console anyone recording the screen can
				// read. See docs/wealthsimple-csv-format.md §6.
				const problems = validateDataset(activities);

				resolve({ fileName, rawText, activities, problems });
			},
			error: (error: Error) => reject(error),
		});
	});
}

export async function parseActivitiesCsv(file: File): Promise<SourceFile> {
	return parseActivities(await file.text(), file.name);
}
