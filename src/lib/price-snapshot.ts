import Papa from "papaparse";
import { daysBetween, todayLocalIso } from "@/lib/calendar-date";
import type { PositionsReport } from "@/lib/positions";

/**
 * Reads prices back out of the workbook this app exported.
 *
 * The loop it closes: `google-sheet.ts` writes a Holdings tab whose price cells
 * are `=GOOGLEFINANCE(...)` formulas. Opened in Google Sheets those resolve, and
 * *File ▸ Download ▸ Comma-separated values* writes the resolved numbers out.
 * Dropping that file back in is the only way this app can know a market value
 * without a server, an API key, or the data ever leaving the browser.
 *
 * Two rules keep it honest:
 *
 * 1. **Only prices are imported.** The sheet's own "Market value" and
 *    "Unrealised" columns are formulas over the sheet's copy of the share
 *    count, which anyone can edit. Share counts stay the ones this app derived
 *    from the activity history, and value is recomputed here.
 * 2. **A missing price is missing, not zero.** An unresolved ticker leaves its
 *    cell blank; treating that as $0.00 would read as a wiped-out holding
 *    rather than an unknown one.
 */

/** Column headers written by `buildWorkbook`. Changing those changes these. */
const COLUMNS = {
	symbol: "Symbol",
	ticker: "Google ticker",
	priceCad: "Price (CAD)",
	account: "Account",
} as const;

/**
 * Where a snapshot's prices came from. Two doors into the same room: the sheet
 * round trip below, and the live quotes in `live-prices.ts`. Everything
 * downstream — valuation, staleness, storage — treats them identically, and
 * only the copy that names the source has to know the difference.
 */
export type PriceSource = "sheet" | "yahoo";

export interface PriceSnapshot {
	/** When the prices were read, as `YYYY-MM-DD`. */
	asOf: string;
	/** Absent in snapshots stored before live quotes existed — read as `sheet`. */
	source?: PriceSource;
	/** The downloaded tab, when the prices came from one. */
	fileName?: string;
	/** ISO instant of the newest quote, when the source can say. */
	quotedAt?: string;
	/** Symbol -> price per share in CAD. */
	pricesCad: Record<string, number>;
	/** Symbols the file priced. */
	matched: string[];
	/** Symbols present in the file with no usable price. */
	unpriced: string[];
}

export class PriceCsvError extends Error {}

/**
 * Parses a downloaded Holdings tab.
 *
 * Synchronous, unlike `parseActivities`: a holdings tab is one row per open
 * position — tens of rows, not thousands — so there is nothing here worth a
 * worker.
 */
export function parsePriceCsv(
	rawText: string,
	fileName: string,
	asOf = todayLocalIso(),
): PriceSnapshot {
	// The Holdings tab opens with title and caveat rows before the header, so
	// the header row is found rather than assumed to be first.
	const lines = rawText.split(/\r?\n/);
	const headerIndex = lines.findIndex(
		(line) => line.includes(COLUMNS.symbol) && line.includes(COLUMNS.priceCad),
	);

	if (headerIndex === -1) {
		throw new PriceCsvError(
			`${fileName} doesn't look like the Holdings tab. Download that tab from your sheet with File ▸ Download ▸ Comma-separated values.`,
		);
	}

	const parsed = Papa.parse<Record<string, string>>(
		lines.slice(headerIndex).join("\n"),
		{ header: true, skipEmptyLines: true },
	);

	const pricesCad: Record<string, number> = {};
	const unpriced = new Set<string>();

	for (const row of parsed.data) {
		const symbol = (row[COLUMNS.symbol] ?? "").trim();
		// The tab ends with a "Total" row that carries no symbol.
		if (!symbol || symbol.toLowerCase() === "total") continue;

		const price = toNumber(row[COLUMNS.priceCad]);
		if (price === null || price <= 0) {
			unpriced.add(symbol);
			continue;
		}

		// The same symbol appears once per account holding it, at one price.
		// Last one wins; they agree in any sheet nobody has hand-edited.
		pricesCad[symbol] = price;
	}

	const matched = Object.keys(pricesCad).sort();
	if (matched.length === 0) {
		throw new PriceCsvError(
			`No prices in ${fileName}. If every price cell is blank, set File ▸ Settings ▸ Locale to Canada in the sheet and re-download.`,
		);
	}

	return {
		asOf,
		source: "sheet",
		fileName,
		pricesCad,
		matched,
		// A symbol priced in one row and blank in another is priced.
		unpriced: [...unpriced].filter((symbol) => !(symbol in pricesCad)).sort(),
	};
}

/**
 * `$1,234.56` and `1 234,56` alike. Sheets writes plain numbers for
 * `GOOGLEFINANCE` output, but a locale-formatted export shouldn't be rejected
 * over a thousands separator.
 */
function toNumber(value: string | undefined): number | null {
	if (!value) return null;
	const cleaned = value.replace(/[^\d.,-]/g, "").replace(/\s/g, "");
	if (!cleaned) return null;

	// A comma is a decimal separator only when no dot is present.
	const normalized = cleaned.includes(".")
		? cleaned.replace(/,/g, "")
		: cleaned.replace(/,/g, ".");

	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : null;
}

export interface ValuedAccountType {
	accountType: string;
	/** Σ shares × price, over holdings this snapshot could price. */
	marketValue: number;
	/** Book cost of exactly those holdings — the like-for-like comparison. */
	pricedBookCost: number;
	/** Book cost of the holdings it could not price. */
	unpricedBookCost: number;
	cashBalance: number;
	/** `marketValue + cashBalance`, plus book cost for anything unpriced. */
	total: number;
}

export interface ValuedReport {
	byAccountType: ValuedAccountType[];
	/** Symbols held but absent from the snapshot — the sheet is out of date. */
	missingSymbols: string[];
	pricedCount: number;
	holdingCount: number;
}

/**
 * Applies a snapshot to a report without touching it.
 *
 * A separate overlay rather than an option on `buildPositions`: that function
 * and its tests are the app's foundation, and valuation is a different concern
 * layered on top of the same cost pools. Nothing here changes a share count or
 * a book cost.
 */
export function valueWith(
	report: PositionsReport,
	snapshot: PriceSnapshot | null,
): ValuedReport | null {
	if (!snapshot) return null;

	const byType = new Map<string, ValuedAccountType>();
	const missing = new Set<string>();
	let priced = 0;

	for (const rollup of report.byAccountType) {
		byType.set(rollup.accountType, {
			accountType: rollup.accountType,
			marketValue: 0,
			pricedBookCost: 0,
			unpricedBookCost: 0,
			cashBalance: rollup.cashBalance,
			total: 0,
		});
	}

	for (const position of report.open) {
		const row = byType.get(position.accountType);
		if (!row) continue;

		const price = snapshot.pricesCad[position.symbol];
		if (price === undefined) {
			missing.add(position.symbol);
			row.unpricedBookCost += position.bookCost;
			continue;
		}

		priced += 1;
		row.marketValue += position.shares * price;
		row.pricedBookCost += position.bookCost;
	}

	for (const row of byType.values()) {
		// An unpriced holding falls back to what was paid for it rather than
		// dropping out of the total, which would understate the account.
		row.total = row.marketValue + row.unpricedBookCost + row.cashBalance;
	}

	return {
		byAccountType: [...byType.values()],
		missingSymbols: [...missing].sort(),
		pricedCount: priced,
		holdingCount: report.open.length,
	};
}

/** Starting balances from a snapshot, in the shape `projectSeries` wants. */
export function valuedBalances(valued: ValuedReport): Record<string, number> {
	const balances: Record<string, number> = {};
	for (const row of valued.byAccountType) {
		balances[row.accountType] = Math.round(row.total * 100) / 100;
	}
	return balances;
}

/** Days between the snapshot and today. Negative is treated as today. */
export function snapshotAgeDays(
	snapshot: PriceSnapshot,
	now = new Date(),
): number {
	return Math.max(0, daysBetween(snapshot.asOf, todayLocalIso(now)));
}

/** Past this, the prices are old enough that the UI should say so. */
export const STALE_AFTER_DAYS = 7;

/**
 * How to name a snapshot's source in a sentence.
 *
 * Worth saying rather than assuming: "what you paid" and "what Yahoo said at
 * 4pm" are different claims, and a reader deciding something with these numbers
 * should know which one they're reading.
 */
export function sourceLabel(snapshot: PriceSnapshot): string {
	return snapshot.source === "yahoo" ? "Yahoo Finance" : "your imported sheet";
}
