import Papa from "papaparse";
import type { SourceFile } from "@/lib/merge";
import { KNOWN_ACTIVITY_TYPES } from "@/lib/metrics";

const REQUIRED_COLUMNS = [
	"transaction_date",
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

// Exports end with a footer row such as `"As of 2026-08-03 16:48 GMT-04:00"`,
// which parses as a row with a non-empty but non-date transaction_date.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Bump whenever parsing changes semantics. Persisted sources carry the version
 * they were parsed with; a mismatch re-parses the stored raw text rather than
 * serving rows produced by known-stale logic.
 */
export const PARSER_VERSION = 1;

export interface Activity {
	transactionDate: string;
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

function toActivity(row: Record<string, string>): Activity {
	return {
		transactionDate: text(row.transaction_date),
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
	const residuals = new Map<string, number>();

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

		residuals.set(
			activity.accountId,
			(residuals.get(activity.accountId) ?? 0) + netCashAmount,
		);
	}

	// I5 — per-account net cash is that account's uninvested cash balance.
	for (const [accountId, residual] of residuals) {
		if (residual < -CENT || residual > CASH_RESIDUAL_LIMIT) {
			problems.push(
				`${accountId}: net cash sums to ${residual.toFixed(2)}, which is not a plausible cash balance — rows may be missing or duplicated`,
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
				const missing = REQUIRED_COLUMNS.filter(
					(column) => !fields.includes(column),
				);

				if (missing.length > 0) {
					reject(
						new Error(
							`${fileName} doesn't look like a Wealthsimple activities export. Missing columns: ${missing.join(", ")}.`,
						),
					);
					return;
				}

				const activities = results.data
					.map(toActivity)
					.filter((activity) => ISO_DATE.test(activity.transactionDate));

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

				if (process.env.NODE_ENV !== "production") {
					const problems = validateDataset(activities);
					if (problems.length > 0) {
						console.warn(
							`${fileName}: ${problems.length} data-invariant violation(s). The export may not match docs/wealthsimple-csv-format.md:\n${problems.slice(0, 20).join("\n")}`,
						);
					}
				}

				resolve({ fileName, rawText, activities });
			},
			error: (error: Error) => reject(error),
		});
	});
}

export async function parseActivitiesCsv(file: File): Promise<SourceFile> {
	return parseActivities(await file.text(), file.name);
}
