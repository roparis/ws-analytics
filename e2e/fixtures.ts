/**
 * Synthetic Wealthsimple activities exports, generated in code rather than
 * checked in as files. `.gitignore` excludes `*.csv` deliberately — "personal
 * data, this app runs on real Wealthsimple exports" — and no CSV is tracked
 * anywhere in the repo. Generating the text at test time keeps that rule
 * absolute: there is no file on disk that a later commit could accidentally
 * pick up.
 *
 * Every figure below is small, round and obviously invented. The shape
 * follows the rules in docs/wealthsimple-csv-format.md §2.1, §2.2 and §6:
 *   - on a non-`Trade` row, `quantity` equals `net_cash_amount` exactly
 *   - on a `Trade` row, `net_cash_amount == -(quantity * unit_price) - commission`
 *   - per account, `Σ net_cash_amount` is a small non-negative idle-cash
 *     balance
 * Breaking any of these doesn't fail the upload — it trips `validateDataset`
 * and produces console warnings the test isn't looking for.
 */

const HEADER = [
	"effective_at",
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

/** The 12 columns `REQUIRED_COLUMNS` in `src/lib/wealthsimple.ts` demands. */
export const REQUIRED_COLUMNS = [
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

type Row = Record<(typeof HEADER)[number], string>;

function csvField(value: string): string {
	return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: Row[]): string {
	const lines = [HEADER.join(",")];
	for (const row of rows) {
		lines.push(HEADER.map((column) => csvField(row[column])).join(","));
	}
	return lines.join("\n");
}

/** A `MoneyMovement`/`EFT` deposit — quantity and net cash are the same
 * dollar figure (I2), and it funds the buy below so the account's residual
 * cash stays small and non-negative (I5). */
function deposit(
	date: string,
	accountId: string,
	accountType: string,
	amount: number,
): Row {
	return {
		effective_at: date,
		account_id: accountId,
		account_type: accountType,
		activity_type: "MoneyMovement",
		activity_sub_type: "EFT",
		description: "Deposit",
		symbol: "",
		name: "",
		currency: "CAD",
		quantity: String(amount),
		unit_price: "",
		commission: "",
		net_cash_amount: String(amount),
	};
}

/** A `Trade`/`BUY` — net cash is exactly `-(quantity * unit_price)` (I1, zero
 * commission here) so the price identity holds without needing the 2-cent
 * rounding allowance. */
function buy(
	date: string,
	accountId: string,
	accountType: string,
	symbol: string,
	name: string,
	shares: number,
	unitPrice: number,
): Row {
	return {
		effective_at: date,
		account_id: accountId,
		account_type: accountType,
		activity_type: "Trade",
		activity_sub_type: "BUY",
		description: `${symbol}: Bought ${shares} shares at $${unitPrice.toFixed(2)} per share`,
		symbol,
		name,
		currency: "CAD",
		quantity: String(shares),
		unit_price: String(unitPrice),
		commission: "0",
		net_cash_amount: String(-(shares * unitPrice)),
	};
}

export interface Fixture {
	fileName: string;
	csv: string;
}

/**
 * First upload: one TFSA. A $250 deposit funds a 2-share buy at $100, leaving
 * $50 idle cash.
 */
export function fileA(): Fixture {
	return {
		fileName: "e2e-activities-a.csv",
		csv: toCsv([
			deposit("2026-01-05T09:00:00-05:00", "E2E0001CAD", "TFSA", 250),
			buy(
				"2026-01-06T10:15:00-05:00",
				"E2E0001CAD",
				"TFSA",
				"AAA",
				"Alpha Test Corp",
				2,
				100,
			),
		]),
	};
}

/**
 * Second upload: a different account entirely, so merging it with `fileA`
 * has nothing to overlap — both files' totals are simply additive, which is
 * what the merge-case spec checks.
 */
export function fileB(): Fixture {
	return {
		fileName: "e2e-activities-b.csv",
		csv: toCsv([
			deposit("2026-02-03T09:00:00-05:00", "E2E0002RRSP", "RRSP", 300),
			buy(
				"2026-02-04T11:30:00-05:00",
				"E2E0002RRSP",
				"RRSP",
				"BBB",
				"Beta Test Fund",
				3,
				50,
			),
		]),
	};
}

/**
 * A third, independent account — used to seed the IndexedDB precondition for
 * the stale-`parserVersion` spec (5a) directly, without going through an
 * upload.
 */
export function fileC(): Fixture {
	return {
		fileName: "e2e-activities-c.csv",
		csv: toCsv([
			deposit("2026-03-02T09:00:00-05:00", "E2E0003RRSP", "RRSP", 120),
			buy(
				"2026-03-03T13:45:00-05:00",
				"E2E0003RRSP",
				"RRSP",
				"CCC",
				"Gamma Test Inc",
				1,
				80,
			),
		]),
	};
}

/**
 * Text that is not a Wealthsimple export at all — missing every required
 * column. Used to seed a `sources` record whose stored `rawText` cannot be
 * re-parsed, simulating a parser change that broke it (5a's precondition,
 * since bumping `PARSER_VERSION` for real is out of scope for this plan).
 */
export function unparseableCsv(): string {
	return "not,a,wealthsimple,export\nfoo,bar,baz,qux";
}
