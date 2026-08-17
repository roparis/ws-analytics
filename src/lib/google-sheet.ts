import { computeKpis, groupByYear } from "@/lib/metrics";
import {
	type AccountRollup,
	extractFxRate,
	LISTING_LABELS,
	type Listing,
	normalizeName,
	type Position,
	type PositionsReport,
} from "@/lib/positions";
import type { Activity } from "@/lib/wealthsimple";

/**
 * Builds a spreadsheet workbook from a `PositionsReport`.
 *
 * The point of the exercise: the Wealthsimple export carries no prices (§8), so
 * this app can report book cost but never market value. A `=GOOGLEFINANCE(...)`
 * formula becomes live once the sheet is in Google Sheets, which is where the
 * missing half of the picture comes from. Everything sourced from the export is
 * a literal value; everything sourced from Google is a formula, so a reader can
 * always tell the two apart.
 *
 * The workbook opens on a Summary tab that aggregates the others by reference,
 * so the live prices flow through to the headline figures. Every cross-sheet
 * formula in the workbook originates there — the detail tabs only ever total
 * their own rows — which keeps the tab-name coupling in one place.
 *
 * Two delivery paths consume the result:
 *
 * - **`.xlsx` download** carries every tab at once, formulas intact.
 * - **Clipboard TSV** can only fill one tab, so it is emitted per sheet and the
 *   user pastes each into a tab of the matching name.
 *
 * Two rules make the output survive either trip:
 *
 * - **Numbers are locale-free.** `1234.56`, never `$1,234.56`. `formatCurrency`
 *   is deliberately not used here — its grouping separators and currency symbol
 *   would land as text.
 * - **Text is stripped, not quoted.** How a pasted plain-text cell handles
 *   quotes varies by browser, so tabs and newlines are removed rather than
 *   escaped.
 */

/**
 * Display treatments a cell can carry. Only the `.xlsx` path can honour these
 * — a TSV paste has no styling — so they are always cosmetic, never the only
 * thing conveying a figure's meaning.
 */
export type CellStyle = "gainLoss" | "gainLossPercent";

export type Cell =
	| { kind: "text"; value: string }
	| { kind: "number"; value: number; decimals: number; style?: CellStyle }
	| { kind: "formula"; value: string; style?: CellStyle }
	| { kind: "blank" };

export const BLANK: Cell = { kind: "blank" };

/**
 * Marks a figure as a gain or a loss: green above zero, red below.
 *
 * Applied as a *number format* rather than a font colour, which matters here —
 * most of these cells are `GOOGLEFINANCE`-driven formulas whose sign changes
 * with the market. A colour baked in at export time would be a snapshot that
 * silently goes wrong; a format re-evaluates with the value.
 */
export function gainLoss(cell: Cell): Cell {
	return cell.kind === "number" || cell.kind === "formula"
		? { ...cell, style: "gainLoss" }
		: cell;
}

/** The percentage counterpart of `gainLoss`. */
export function gainLossPercent(cell: Cell): Cell {
	return cell.kind === "number" || cell.kind === "formula"
		? { ...cell, style: "gainLossPercent" }
		: cell;
}

/**
 * Wealthsimple's `name` field carries non-breaking spaces and trailing
 * whitespace, and descriptions carry commas and a `®`. Commas and non-ASCII
 * characters are safe in both formats and are left alone; tabs and newlines
 * would break the TSV grid, so they collapse to a space.
 */
export function text(value: string | null | undefined): Cell {
	if (value === null || value === undefined) return BLANK;

	const cleaned = value
		.replace(/[\t\r\n]+/g, " ")
		.replace(/ /g, " ")
		.replace(/\s+/g, " ")
		.trim();

	return cleaned === "" ? BLANK : { kind: "text", value: cleaned };
}

export function num(value: number, decimals = 2): Cell {
	if (!Number.isFinite(value)) return BLANK;
	return { kind: "number", value, decimals };
}

export function formula(value: string): Cell {
	return { kind: "formula", value };
}

/**
 * Renders a number without a locale, a currency symbol or an exponent.
 * `String()` is unusable here — `String(1e-7)` gives `"1e-7"`, which a
 * spreadsheet reads as text.
 */
function renderNumber(value: number, decimals: number): string {
	const fixed = value.toFixed(decimals);
	// A residual of -1e-14 — which is what an account that nets to zero actually
	// sums to — would otherwise render as "-0".
	if (Number(fixed) === 0) return "0";
	return fixed.includes(".")
		? fixed.replace(/0+$/, "").replace(/\.$/, "")
		: fixed;
}

function renderTsvCell(cell: Cell): string {
	switch (cell.kind) {
		case "text":
			// On paste, a cell that starts like a formula would be evaluated. `-` is
			// left alone: `num` handles real negatives, and a stray apostrophe on a
			// legitimate string would be visible in the cell.
			return /^[=+@]/.test(cell.value) ? `'${cell.value}` : cell.value;
		case "number":
			return renderNumber(cell.value, cell.decimals);
		case "formula":
			return cell.value;
		case "blank":
			return "";
	}
}

/**
 * A rectangular block that reads as a table, so the `.xlsx` writer can rule it.
 *
 * Declared per block rather than tagged onto every cell: a sheet knows where
 * its tables start and stop, and threading a border flag through several
 * hundred `text()` calls would be noise that drifts out of date on the first
 * layout change.
 */
export interface SheetRegion {
	/** 1-based row carrying the column headings. */
	headerRow: number;
	/** 1-based row of the last body row. Equal to `headerRow` when a table is empty. */
	lastRow: number;
	/** Number of columns the block spans, from column A. */
	columns: number;
	/** 1-based row of a totals line, ruled off from the body above it. */
	totalRow?: number;
}

export interface SheetGrid {
	/** The tab name. Referenced from formulas, so it is part of the contract. */
	name: string;
	rows: Cell[][];
	rowCount: number;
	columnCount: number;
	/** Blocks to rule as tables. Ignored by the TSV path, which has no styling. */
	regions: SheetRegion[];
}

/**
 * Every row is padded to the sheet's width so column alignment is deterministic
 * — a short row would shift a `SUM` range in the pasted tab.
 */
export function gridToTsv(grid: SheetGrid): string {
	return grid.rows
		.map((row) => {
			const cells = row.map(renderTsvCell);
			while (cells.length < grid.columnCount) cells.push("");
			return cells.join("\t");
		})
		.join("\n");
}

/** 0 → A, 25 → Z, 26 → AA. */
export function colName(index: number): string {
	let name = "";
	let remaining = index;
	while (remaining >= 0) {
		name = String.fromCharCode(65 + (remaining % 26)) + name;
		remaining = Math.floor(remaining / 26) - 1;
	}
	return name;
}

export const SHEET_NAMES = {
	summary: "Summary",
	holdings: "Holdings",
	accountTypes: "By account type",
	years: "By year",
	cash: "Cash",
	closed: "Closed positions",
	income: "Income",
	transactions: "Transactions",
} as const;

/** The cell holding the live USD→CAD rate, on the Holdings sheet. */
export const FX_CELL = "$B$3";

export const GOOGLE_SHEETS_NEW_URL =
	"https://docs.google.com/spreadsheets/create";

/**
 * Google Finance's ticker for a holding — the one thing in the sheet we are
 * guessing at, which is why it gets its own editable column.
 *
 * US-listed symbols resolve bare (`VTI`), so no exchange prefix is added rather
 * than guessing between NYSE, NASDAQ and NYSEARCA. Canadian ones need `TSE:`,
 * and Google uses the same `.B` class-share convention the export does. Spot
 * crypto has no exchange listing at all and prices through a currency pair.
 */
export function googleTickerGuess(
	position: Pick<Position, "symbol" | "listing">,
): string {
	switch (position.listing) {
		case "us":
			return position.symbol;
		case "ca":
			return `TSE:${position.symbol}`;
		case "crypto":
			return `CURRENCY:${position.symbol}CAD`;
		default:
			return position.symbol;
	}
}

export interface SheetOptions {
	fileName: string;
	/** `dataset.dateRange.end` — the last day the export covers. */
	dataThrough: string;
	/** ISO date the export was generated. */
	generatedOn: string;
	/** Every activity row, for the per-year and transaction sheets. */
	activities: Activity[];
	/** The log is by far the biggest sheet; off is the pressure valve. */
	includeTransactionLog?: boolean;
}

/** Collects rows and hands back the 1-based number each one landed on. */
class SheetBuilder {
	readonly rows: Cell[][] = [];
	private readonly regions: SheetRegion[] = [];

	constructor(readonly name: string) {}

	/** Pushes a row and returns its 1-based row number. */
	push(row: Cell[]): number {
		this.rows.push(row);
		return this.rows.length;
	}

	/** The 1-based number the next pushed row will occupy. */
	get nextRow(): number {
		return this.rows.length + 1;
	}

	/** Marks a block as a table so the workbook writer rules it. */
	table(region: SheetRegion): void {
		this.regions.push(region);
	}

	finish(minimumWidth = 0): SheetGrid {
		const columnCount = this.rows.reduce(
			(widest, row) => (row.length > widest ? row.length : widest),
			minimumWidth,
		);
		return {
			name: this.name,
			rows: this.rows,
			rowCount: this.rows.length,
			columnCount,
			regions: this.regions,
		};
	}
}

const HOLDINGS_HEADERS = [
	"Account",
	"Account type",
	"Symbol",
	"Name",
	"Listing",
	"Google ticker",
	"Shares",
	"Book cost (CAD)",
	"Avg cost/share (CAD)",
	"Quote currency",
	"Price (quote ccy)",
	"Price (CAD)",
	"Market value (CAD)",
	"Unrealised (CAD)",
	"Unrealised %",
	"% of holdings",
	"Dividends received (CAD)",
	"Commission (CAD)",
	"First buy",
	"Last trade",
	"Notes",
];

/**
 * Column indices into the Holdings sheet. The Summary and per-type tabs read
 * these ranges by letter, so a change here has to travel to both.
 */
const H = {
	accountType: 1,
	symbol: 2,
	listing: 4,
	ticker: 5,
	shares: 6,
	bookCost: 7,
	quoteCurrency: 9,
	price: 10,
	priceCad: 11,
	marketValue: 12,
	unrealised: 13,
	shareOfHoldings: 15,
	dividends: 16,
	notes: 20,
} as const;

const HC = {
	accountType: colName(H.accountType),
	symbol: colName(H.symbol),
	listing: colName(H.listing),
	ticker: colName(H.ticker),
	shares: colName(H.shares),
	bookCost: colName(H.bookCost),
	quoteCurrency: colName(H.quoteCurrency),
	price: colName(H.price),
	priceCad: colName(H.priceCad),
	marketValue: colName(H.marketValue),
	unrealised: colName(H.unrealised),
	dividends: colName(H.dividends),
	notes: colName(H.notes),
} as const;

function issueNotes(position: Position): string {
	return position.issues.map((issue) => issue.message).join(" ");
}

function filled(width: number): Cell[] {
	return new Array(width).fill(BLANK);
}

function quoted(sheet: string): string {
	return `'${sheet}'`;
}

/** Anchors the Summary and per-type tabs need to reach into the detail tabs. */
interface HoldingsAnchors {
	firstRow: number;
	lastRow: number;
	totalRow: number;
	count: number;
	hasHoldings: boolean;
}

interface CashAnchors {
	totalRow: number;
	/** `accountId -> the row its balance sits on`. */
	rowByAccount: Map<string, number>;
}

interface ClosedAnchors {
	totalRow: number | null;
}

interface IncomeAnchors {
	dividendsTotalRow: number | null;
	costsFirstRow: number;
	costsLastRow: number;
}

function buildCashSheet(report: PositionsReport): {
	grid: SheetGrid;
	anchors: CashAnchors;
} {
	const sheet = new SheetBuilder(SHEET_NAMES.cash);

	sheet.push([text("CASH (uninvested)")]);
	sheet.push([
		text(
			"Each account's uninvested balance: everything that moved in, minus everything spent or invested. A balance is only reliable when the account's whole history is loaded.",
		),
	]);
	const headerRow = sheet.push(
		["Account", "Account type", "Balance (CAD)", "Notes"].map((header) =>
			text(header),
		),
	);

	const firstRow = sheet.nextRow;
	const rowByAccount = new Map<string, number>();
	for (const account of report.byAccount) {
		const row = sheet.push([
			text(account.accountId),
			text(account.accountType),
			num(account.cashBalance, 2),
			text(
				account.historyConfidence === "suspect"
					? `Not reliable — ${account.historyReasons.join(" ")}`
					: "",
			),
		]);
		rowByAccount.set(account.accountId, row);
	}
	const lastRow = sheet.rows.length;

	const totalRow = sheet.push([
		text("Total"),
		BLANK,
		report.byAccount.length > 0
			? formula(`=SUM(C${firstRow}:C${lastRow})`)
			: num(0, 2),
	]);

	sheet.table({ headerRow, lastRow, columns: 4, totalRow });
	return { grid: sheet.finish(4), anchors: { totalRow, rowByAccount } };
}

function buildHoldingsSheet(
	report: PositionsReport,
	options: SheetOptions,
): { grid: SheetGrid; anchors: HoldingsAnchors } {
	const sheet = new SheetBuilder(SHEET_NAMES.holdings);
	const width = HOLDINGS_HEADERS.length;

	// Fixed-height header, so FX_CELL is guaranteed to be $B$3.
	sheet.push([text(`Wealthsimple holdings — ${options.fileName}`)]);
	sheet.push([
		text("Generated"),
		text(options.generatedOn),
		text("Data through"),
		text(options.dataThrough),
	]);
	sheet.push([
		text("USD → CAD"),
		formula('=GOOGLEFINANCE("CURRENCY:USDCAD")'),
		text(
			"Live rate from Google. Every USD price below converts through this one cell.",
		),
	]);
	sheet.push([
		text(
			"Prices come from Google Finance and are delayed. Your Wealthsimple export contains no prices — shares, book cost, income and realised gains come from the export; market value comes from Google.",
		),
	]);
	sheet.push([
		text(
			"If one price is blank, fix that row's Google ticker. If every price is blank, set File ▸ Settings ▸ Locale to Canada.",
		),
	]);
	sheet.push([]);
	sheet.push([text("OPEN HOLDINGS")]);
	const headerRow = sheet.push(HOLDINGS_HEADERS.map((header) => text(header)));

	const firstRow = sheet.nextRow;
	for (const position of report.open) {
		const r = sheet.nextRow;
		sheet.push([
			text(position.accountId),
			text(position.accountType),
			text(position.symbol),
			text(position.name),
			text(LISTING_LABELS[position.listing]),
			text(googleTickerGuess(position)),
			num(position.shares, 8),
			num(position.bookCost, 2),
			num(position.averageCost ?? 0, 4),
			// Asking Google for the quote currency is what makes the conversion
			// self-detecting rather than another guess: TSE tickers answer CAD, US
			// ones answer USD, and a currency pair errors out — which is correct,
			// since it is already quoted in CAD.
			formula(`=IFERROR(GOOGLEFINANCE($${HC.ticker}${r},"currency"),"")`),
			formula(`=IFERROR(GOOGLEFINANCE($${HC.ticker}${r},"price"),"")`),
			formula(
				`=IF($${HC.price}${r}="","",IF($${HC.quoteCurrency}${r}="USD",$${HC.price}${r}*${FX_CELL},$${HC.price}${r}))`,
			),
			formula(
				`=IF($${HC.priceCad}${r}="","",$${HC.shares}${r}*$${HC.priceCad}${r})`,
			),
			gainLoss(
				formula(
					`=IF($${HC.marketValue}${r}="","",$${HC.marketValue}${r}-$${HC.bookCost}${r})`,
				),
			),
			gainLossPercent(
				formula(
					`=IF(OR($${HC.marketValue}${r}="",$${HC.bookCost}${r}=0),"",TO_PERCENT($${HC.unrealised}${r}/$${HC.bookCost}${r}))`,
				),
			),
			// Filled in below, once the totals row's number is known.
			BLANK,
			num(position.dividends, 2),
			num(position.commission, 2),
			text(position.firstTradeDate),
			text(position.lastTradeDate),
			text(issueNotes(position)),
		]);
	}

	const lastRow = sheet.rows.length;
	const count = report.open.length;
	const hasHoldings = count > 0;
	const valueRange = `$${HC.marketValue}$${firstRow}:$${HC.marketValue}$${lastRow}`;

	let totalRow = 0;
	if (hasHoldings) {
		const totals = filled(width);
		totalRow = sheet.nextRow;
		totals[0] = text("Total");
		totals[H.bookCost] = formula(
			`=SUM(${HC.bookCost}${firstRow}:${HC.bookCost}${lastRow})`,
		);
		// A plain SUM over blank price cells returns 0, which reads as a total
		// wipeout rather than "nothing priced yet".
		totals[H.marketValue] = formula(
			`=IF(COUNT(${valueRange})=0,"",SUM(${valueRange}))`,
		);
		// And a partial market value measured against a complete book cost is
		// worse than no figure at all, so this one stays blank until every
		// holding has a price.
		// Measured against the book cost of the holdings that actually priced, so
		// an unresolvable ticker costs us that row rather than the whole figure.
		totals[H.unrealised] = gainLoss(
			formula(
				`=IF(COUNT(${valueRange})=0,"",$${HC.marketValue}$${totalRow}-SUMPRODUCT(ISNUMBER(${valueRange})*$${HC.bookCost}$${firstRow}:$${HC.bookCost}$${lastRow}))`,
			),
		);
		totals[H.dividends] = formula(
			`=SUM(${HC.dividends}${firstRow}:${HC.dividends}${lastRow})`,
		);
		totals[H.notes] = formula(
			`=COUNT(${valueRange})&" of ${count} holdings priced"`,
		);
		sheet.push(totals);

		// Now that the totals row is known, the share-of-portfolio column can point
		// at it.
		for (let index = 0; index < count; index += 1) {
			const r = firstRow + index;
			sheet.rows[r - 1][H.shareOfHoldings] = formula(
				`=IF($${HC.marketValue}${r}="","",TO_PERCENT($${HC.marketValue}${r}/$${HC.marketValue}$${totalRow}))`,
			);
		}
	} else {
		totalRow = sheet.push([text("No open holdings in the loaded files.")]);
	}

	sheet.table({
		headerRow,
		lastRow,
		columns: width,
		totalRow: hasHoldings ? totalRow : undefined,
	});
	return {
		grid: sheet.finish(width),
		anchors: { firstRow, lastRow, totalRow, count, hasHoldings },
	};
}

/** Reaches a Holdings column as an absolute, sheet-qualified range. */
function holdingsRange(column: string, anchors: HoldingsAnchors): string {
	return `${quoted(SHEET_NAMES.holdings)}!$${column}$${anchors.firstRow}:$${column}$${anchors.lastRow}`;
}

function holdingsCell(column: string, row: number): string {
	return `${quoted(SHEET_NAMES.holdings)}!$${column}$${row}`;
}

/**
 * Book cost of just the holdings Google actually priced.
 *
 * This is what makes an unrealised figure honest when some tickers don't
 * resolve — and some never will: `.F` series units, delisted symbols and spot
 * crypto pairs all come back empty. Subtracting the *whole* book cost from a
 * partial market value invents a loss the size of the unpriced holdings.
 * Comparing like with like keeps the figure true whatever subset priced, and
 * the "N of M holdings priced" note says how big that subset is.
 *
 * `optionalCondition` narrows it further, for the per-type and per-listing
 * breakdowns.
 */
function pricedBookCost(
	anchors: HoldingsAnchors,
	optionalCondition?: string,
): string {
	const value = holdingsRange(HC.marketValue, anchors);
	const book = holdingsRange(HC.bookCost, anchors);
	const filter = optionalCondition ? `${optionalCondition}*` : "";
	return `SUMPRODUCT(${filter}ISNUMBER(${value})*${book})`;
}

function buildSummarySheet(
	report: PositionsReport,
	options: SheetOptions,
	holdings: HoldingsAnchors,
	cash: CashAnchors,
	closed: ClosedAnchors,
	income: IncomeAnchors,
): SheetGrid {
	const sheet = new SheetBuilder(SHEET_NAMES.summary);
	const { hasHoldings } = holdings;

	const marketValueTotal = holdingsCell(HC.marketValue, holdings.totalRow);
	const bookCostTotal = holdingsCell(HC.bookCost, holdings.totalRow);
	const cashTotal = `${quoted(SHEET_NAMES.cash)}!$C$${cash.totalRow}`;

	sheet.push([text(`Portfolio summary — ${options.fileName}`)]);
	sheet.push([
		text("Generated"),
		text(options.generatedOn),
		text("Data through"),
		text(options.dataThrough),
	]);
	sheet.push([
		text(
			"Everything on this tab is calculated from the others. Prices come from Google Finance through the Holdings tab and are delayed; shares, book cost, income and realised gains come from your Wealthsimple export, which contains no prices.",
		),
	]);
	sheet.push([
		text("Pricing"),
		hasHoldings
			? formula(`=${holdingsCell(HC.notes, holdings.totalRow)}`)
			: text("No open holdings"),
	]);
	sheet.push([]);

	// --- Portfolio now
	sheet.push([text("PORTFOLIO NOW")]);
	const portfolioHeader = sheet.push([text("Measure"), text("Amount (CAD)")]);

	const bookRow = sheet.push([
		text("Book cost of holdings"),
		hasHoldings ? formula(`=${bookCostTotal}`) : num(0, 2),
	]);
	const valueRow = sheet.push([
		text("Market value of priced holdings"),
		hasHoldings ? formula(`=${marketValueTotal}`) : num(0, 2),
		text(
			"Google can't price every ticker — .F series units, delisted symbols and spot crypto often come back empty. See the Pricing line above.",
		),
	]);
	const pricedBookRow = sheet.push([
		text("Book cost of those same holdings"),
		hasHoldings ? formula(`=${pricedBookCost(holdings)}`) : num(0, 2),
		text("The like-for-like figure the gain below is measured against."),
	]);
	const unrealisedRow = sheet.push([
		text("Unrealised gain"),
		gainLoss(
			hasHoldings
				? formula(
						`=IF($B$${valueRow}="","",$B$${valueRow}-$B$${pricedBookRow})`,
					)
				: num(0, 2),
		),
	]);
	sheet.push([
		text("Unrealised %"),
		gainLossPercent(
			formula(
				`=IF(OR($B$${unrealisedRow}="",$B$${pricedBookRow}=0),"",TO_PERCENT($B$${unrealisedRow}/$B$${pricedBookRow}))`,
			),
		),
	]);
	const cashRow = sheet.push([
		text("Uninvested cash"),
		formula(`=${cashTotal}`),
	]);
	sheet.push([
		text("Total portfolio value"),
		formula(
			`=IF($B$${valueRow}="","",$B$${valueRow}+($B$${bookRow}-$B$${pricedBookRow})+$B$${cashRow})`,
		),
		text(
			"Priced holdings at market value, anything Google couldn't price at book cost, plus cash.",
		),
	]);
	sheet.table({
		headerRow: portfolioHeader,
		lastRow: sheet.rows.length,
		columns: 3,
	});
	sheet.push([]);

	// --- Lifetime results
	sheet.push([text("LIFETIME RESULTS")]);
	const lifetimeHeader = sheet.push([text("Measure"), text("Amount (CAD)")]);

	const realisedRow = sheet.push([
		text("Realised gain on closed positions"),
		gainLoss(
			closed.totalRow === null
				? num(0, 2)
				: formula(`=${quoted(SHEET_NAMES.closed)}!$G$${closed.totalRow}`),
		),
	]);
	sheet.push([
		text("Dividends received"),
		income.dividendsTotalRow === null
			? num(0, 2)
			: formula(
					`=${quoted(SHEET_NAMES.income)}!$E$${income.dividendsTotalRow}`,
				),
	]);
	sheet.push([
		text("Interest earned"),
		formula(
			`=SUM(${quoted(SHEET_NAMES.income)}!$E$${income.costsFirstRow}:$E$${income.costsLastRow})`,
		),
	]);
	sheet.push([
		text("Withholding tax"),
		formula(
			`=-SUM(${quoted(SHEET_NAMES.income)}!$C$${income.costsFirstRow}:$C$${income.costsLastRow})`,
		),
	]);
	sheet.push([
		text("Fees, net of refunds"),
		formula(
			`=-SUM(${quoted(SHEET_NAMES.income)}!$D$${income.costsFirstRow}:$D$${income.costsLastRow})`,
		),
	]);
	const unrealisedEchoRow = sheet.push([
		text("Unrealised gain on holdings"),
		gainLoss(formula(`=$B$${unrealisedRow}`)),
	]);
	sheet.push([
		text("Net result to date"),
		gainLoss(
			formula(
				`=IF($B$${unrealisedEchoRow}="","",SUM($B$${realisedRow}:$B$${unrealisedEchoRow}))`,
			),
		),
		text("Realised gains, income and unrealised gains, less fees and tax."),
	]);
	sheet.table({
		headerRow: lifetimeHeader,
		lastRow: sheet.rows.length - 1,
		columns: 3,
		totalRow: sheet.rows.length,
	});
	sheet.push([]);

	// --- By account type
	sheet.push([text("BY ACCOUNT TYPE")]);
	const typeHeader = sheet.push(
		[
			"Account type",
			"Holdings",
			"Book cost (CAD)",
			"Market value (CAD)",
			"Unrealised (CAD)",
			"% of holdings",
			"Cash (CAD)",
		].map((header) => text(header)),
	);
	for (const type of report.byAccountType) {
		const r = sheet.nextRow;
		sheet.push([
			text(type.accountType),
			formula(`=COUNTIF(${holdingsRange(HC.accountType, holdings)},$A${r})`),
			formula(
				`=SUMIF(${holdingsRange(HC.accountType, holdings)},$A${r},${holdingsRange(HC.bookCost, holdings)})`,
			),
			formula(
				`=SUMIF(${holdingsRange(HC.accountType, holdings)},$A${r},${holdingsRange(HC.marketValue, holdings)})`,
			),
			gainLoss(
				formula(
					`=$D${r}-${pricedBookCost(holdings, `(${holdingsRange(HC.accountType, holdings)}=$A${r})`)}`,
				),
			),
			formula(`=IF($B$${valueRow}=0,"",TO_PERCENT($D${r}/$B$${valueRow}))`),
			num(type.cashBalance, 2),
		]);
	}
	sheet.table({
		headerRow: typeHeader,
		lastRow: sheet.rows.length,
		columns: 7,
	});
	sheet.push([]);

	// --- Currency exposure
	sheet.push([text("WHERE IT TRADES")]);
	sheet.push([
		text(
			"Derived from the FX marker your export puts on US-listed trades — the only currency signal the file carries.",
		),
	]);
	const listingHeader = sheet.push(
		[
			"Listing",
			"Holdings",
			"Book cost (CAD)",
			"Market value (CAD)",
			"% of holdings",
		].map((header) => text(header)),
	);
	const listings: Listing[] = ["ca", "us", "crypto", "unknown"];
	for (const listing of listings) {
		if (!report.open.some((position) => position.listing === listing)) continue;
		const r = sheet.nextRow;
		sheet.push([
			text(LISTING_LABELS[listing]),
			formula(`=COUNTIF(${holdingsRange(HC.listing, holdings)},$A${r})`),
			formula(
				`=SUMIF(${holdingsRange(HC.listing, holdings)},$A${r},${holdingsRange(HC.bookCost, holdings)})`,
			),
			formula(
				`=SUMIF(${holdingsRange(HC.listing, holdings)},$A${r},${holdingsRange(HC.marketValue, holdings)})`,
			),
			formula(`=IF($B$${valueRow}=0,"",TO_PERCENT($D${r}/$B$${valueRow}))`),
		]);
	}
	sheet.table({
		headerRow: listingHeader,
		lastRow: sheet.rows.length,
		columns: 5,
	});
	sheet.push([]);

	// --- Largest holdings
	const top = report.open.slice(0, 10);
	if (top.length > 0) {
		sheet.push([text(`LARGEST HOLDINGS (top ${top.length} by book cost)`)]);
		const topHeader = sheet.push(
			[
				"Symbol",
				"Account type",
				"Book cost (CAD)",
				"Market value (CAD)",
				"Unrealised (CAD)",
				"% of holdings",
			].map((header) => text(header)),
		);
		top.forEach((_, index) => {
			const source = holdings.firstRow + index;
			sheet.push([
				formula(`=${holdingsCell(HC.symbol, source)}`),
				formula(`=${holdingsCell(HC.accountType, source)}`),
				formula(`=${holdingsCell(HC.bookCost, source)}`),
				formula(`=${holdingsCell(HC.marketValue, source)}`),
				formula(`=${holdingsCell(HC.unrealised, source)}`),
				formula(`=${holdingsCell(colName(H.shareOfHoldings), source)}`),
			]);
		});
		sheet.table({
			headerRow: topHeader,
			lastRow: sheet.rows.length,
			columns: 6,
		});
	}

	return sheet.finish(7);
}

function buildAccountTypeSheet(
	report: PositionsReport,
	holdings: HoldingsAnchors,
): SheetGrid {
	const sheet = new SheetBuilder(SHEET_NAMES.accountTypes);

	sheet.push([text("ANALYTICS BY ACCOUNT TYPE")]);
	sheet.push([
		text(
			"A roll-up, not an account — several accounts can share one type. Market value is live from the Holdings tab; everything else comes from your export.",
		),
	]);
	sheet.push(
		[
			"Account type",
			"Accounts",
			"Holdings",
			"Closed positions",
			"Book cost (CAD)",
			"Market value (CAD)",
			"Unrealised (CAD)",
			"Unrealised %",
			"Realised gain (CAD)",
			"Dividends (CAD)",
			"Withholding tax (CAD)",
			"Fees (CAD)",
			"Cash (CAD)",
			"Canadian-listed (CAD)",
			"US-listed (CAD)",
			"Crypto (CAD)",
			"History",
		].map((header) => text(header)),
	);
	const headerRow = sheet.rows.length;

	const firstRow = sheet.nextRow;
	for (const type of report.byAccountType) {
		const r = sheet.nextRow;
		sheet.push([
			text(type.accountType),
			num(type.accountIds.length, 0),
			num(type.openCount, 0),
			num(type.closedCount, 0),
			formula(
				`=SUMIF(${holdingsRange(HC.accountType, holdings)},$A${r},${holdingsRange(HC.bookCost, holdings)})`,
			),
			formula(
				`=SUMIF(${holdingsRange(HC.accountType, holdings)},$A${r},${holdingsRange(HC.marketValue, holdings)})`,
			),
			gainLoss(
				formula(
					`=$F${r}-${pricedBookCost(holdings, `(${holdingsRange(HC.accountType, holdings)}=$A${r})`)}`,
				),
			),
			gainLossPercent(
				formula(
					`=IF(${pricedBookCost(holdings, `(${holdingsRange(HC.accountType, holdings)}=$A${r})`)}=0,"",TO_PERCENT($G${r}/${pricedBookCost(holdings, `(${holdingsRange(HC.accountType, holdings)}=$A${r})`)}))`,
				),
			),
			gainLoss(num(type.realizedPnl, 2)),
			num(type.dividends, 2),
			num(-type.withholdingTax, 2),
			num(-type.fees, 2),
			num(type.cashBalance, 2),
			num(type.bookCostByListing.ca, 2),
			num(type.bookCostByListing.us, 2),
			num(type.bookCostByListing.crypto, 2),
			text(
				type.historyConfidence === "suspect"
					? "Incomplete — some buys are missing, so book cost is understated"
					: "Complete",
			),
		]);
	}
	const lastRow = sheet.rows.length;

	if (report.byAccountType.length > 0) {
		const totalRow = sheet.nextRow;
		const totals = filled(17);
		totals[0] = text("Total");
		for (const column of [1, 2, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15]) {
			const letter = colName(column);
			const sum = formula(`=SUM(${letter}${firstRow}:${letter}${lastRow})`);
			// Column I is realised gain. The rest are counts and costs, where a
			// red/green split would read as a judgement the figure doesn't make.
			totals[column] = column === 8 ? gainLoss(sum) : sum;
		}
		totals[5] = formula(`=SUM(F${firstRow}:F${lastRow})`);
		totals[6] = gainLoss(formula(`=SUM(G${firstRow}:G${lastRow})`));
		sheet.push(totals);
		sheet.table({ headerRow, lastRow, columns: 17, totalRow });
	} else {
		sheet.table({ headerRow, lastRow, columns: 17 });
	}

	return sheet.finish(17);
}

function buildYearSheet(activities: Activity[]): SheetGrid {
	const sheet = new SheetBuilder(SHEET_NAMES.years);

	sheet.push([text("ANALYTICS BY YEAR")]);
	sheet.push([
		text(
			"Cash-flow history, which your export supports in full — no prices are involved. Deposits and withdrawals cross the boundary with your bank; transfers between your own Wealthsimple accounts are excluded.",
		),
	]);
	sheet.push(
		[
			"Year",
			"Activities",
			"Deposits in (CAD)",
			"Withdrawals out (CAD)",
			"Net deposits (CAD)",
			"Dividends (CAD)",
			"Interest (CAD)",
			"Cash back & bonuses (CAD)",
			"Fees & tax (CAD)",
			"Net cash flow (CAD)",
		].map((header) => text(header)),
	);
	const headerRow = sheet.rows.length;

	// `groupByYear` runs newest first, which is right for a feed and wrong for a
	// table you read top to bottom.
	const years = [...groupByYear(activities)].reverse();

	const firstRow = sheet.nextRow;
	for (const year of years) {
		const { kpis } = year;
		sheet.push([
			text(year.key),
			num(kpis.count, 0),
			num(kpis.moneyIn, 2),
			num(-kpis.moneyOut, 2),
			num(kpis.netDeposits, 2),
			num(kpis.dividends, 2),
			num(kpis.interest, 2),
			num(kpis.cashback + kpis.promo, 2),
			num(-kpis.costs, 2),
			num(kpis.netCashFlow, 2),
		]);
	}
	const lastRow = sheet.rows.length;

	if (years.length > 0) {
		const totals = filled(10);
		totals[0] = text("Total");
		for (let column = 1; column <= 9; column += 1) {
			const letter = colName(column);
			totals[column] = formula(
				`=SUM(${letter}${firstRow}:${letter}${lastRow})`,
			);
		}
		const totalRow = sheet.push(totals);
		sheet.table({ headerRow, lastRow, columns: 10, totalRow });
	} else {
		sheet.table({ headerRow, lastRow, columns: 10 });
	}

	// A year x account-type view of what actually went into the market, which is
	// the one cross-tab the yearly figures can't show on their own.
	const types = [...new Set(activities.map((row) => row.accountType))].sort();
	if (years.length > 0 && types.length > 0) {
		sheet.push([]);
		sheet.push([text("NET DEPOSITS BY YEAR AND ACCOUNT TYPE (CAD)")]);
		const matrixHeader = sheet.push(
			["Year", ...types].map((header) => text(header)),
		);

		for (const year of years) {
			const cells: Cell[] = [text(year.key)];
			for (const type of types) {
				const rows = year.activities.filter(
					(activity) => activity.accountType === type,
				);
				cells.push(
					rows.length === 0 ? num(0, 2) : num(computeKpis(rows).netDeposits, 2),
				);
			}
			sheet.push(cells);
		}
		sheet.table({
			headerRow: matrixHeader,
			lastRow: sheet.rows.length,
			columns: types.length + 1,
		});
	}

	return sheet.finish(10);
}

function buildClosedSheet(report: PositionsReport): {
	grid: SheetGrid;
	anchors: ClosedAnchors;
} {
	const sheet = new SheetBuilder(SHEET_NAMES.closed);

	sheet.push([text("CLOSED POSITIONS")]);
	sheet.push([
		text(
			"Realised figures from your own trades. Book cost is pooled per account and is not a tax document — registered accounts have no cost-basis significance, and the CRA pools identical property across all of your non-registered holdings.",
		),
	]);
	sheet.push(
		[
			"Account",
			"Account type",
			"Symbol",
			"Name",
			"Cost basis (CAD)",
			"Proceeds (CAD)",
			"Realised P&L (CAD)",
			"Realised %",
			"Dividends (CAD)",
			"Commission (CAD)",
			"First trade",
			"Last trade",
			"Notes",
		].map((header) => text(header)),
	);

	const firstRow = sheet.nextRow;
	const headerRow = firstRow - 1;
	for (const position of report.closed) {
		const r = sheet.nextRow;
		sheet.push([
			text(position.accountId),
			text(position.accountType),
			text(position.symbol),
			text(position.name),
			num(position.costBasis, 2),
			num(position.proceeds, 2),
			gainLoss(num(position.realizedPnl, 2)),
			gainLossPercent(formula(`=IF(E${r}=0,"",TO_PERCENT(G${r}/E${r}))`)),
			num(position.dividends, 2),
			num(position.commission, 2),
			text(position.firstTradeDate),
			text(position.lastTradeDate),
			text(issueNotes(position)),
		]);
	}
	const lastRow = sheet.rows.length;

	let totalRow: number | null = null;
	if (report.closed.length > 0) {
		totalRow = sheet.push([
			text("Total"),
			BLANK,
			BLANK,
			BLANK,
			formula(`=SUM(E${firstRow}:E${lastRow})`),
			formula(`=SUM(F${firstRow}:F${lastRow})`),
			gainLoss(formula(`=SUM(G${firstRow}:G${lastRow})`)),
			BLANK,
			formula(`=SUM(I${firstRow}:I${lastRow})`),
			formula(`=SUM(J${firstRow}:J${lastRow})`),
		]);
	} else {
		sheet.push([text("No closed positions in the loaded files.")]);
	}

	sheet.table({
		headerRow,
		lastRow,
		columns: 13,
		totalRow: totalRow ?? undefined,
	});
	return { grid: sheet.finish(13), anchors: { totalRow } };
}

function buildIncomeSheet(report: PositionsReport): {
	grid: SheetGrid;
	anchors: IncomeAnchors;
} {
	const sheet = new SheetBuilder(SHEET_NAMES.income);

	sheet.push([text("INCOME")]);
	sheet.push(
		[
			"Account",
			"Account type",
			"Symbol",
			"Name",
			"Dividends (CAD)",
			"Still held?",
			"Notes",
		].map((header) => text(header)),
	);

	const withIncome = report.positions
		.filter((position) => position.dividends !== 0)
		.sort((a, b) => b.dividends - a.dividends);

	const firstRow = sheet.nextRow;
	const headerRow = firstRow - 1;
	for (const position of withIncome) {
		sheet.push([
			text(position.accountId),
			text(position.accountType),
			text(position.symbol),
			text(position.name),
			num(position.dividends, 2),
			text(position.shares > 0 ? "Yes" : "No"),
			text(issueNotes(position)),
		]);
	}
	const lastRow = sheet.rows.length;

	let dividendsTotalRow: number | null = null;
	if (withIncome.length > 0) {
		dividendsTotalRow = sheet.push([
			text("Dividends total"),
			BLANK,
			BLANK,
			BLANK,
			formula(`=SUM(E${firstRow}:E${lastRow})`),
		]);
	}

	sheet.push([]);
	sheet.push([
		text(
			"Withholding tax rows carry no symbol in the export, so tax can only be reported per account — never per holding.",
		),
	]);
	sheet.push(
		[
			"Account",
			"Account type",
			"Withholding tax (CAD)",
			"Fees, net of refunds (CAD)",
			"Interest earned (CAD)",
		].map((header) => text(header)),
	);

	const costsFirstRow = sheet.nextRow;
	const costsHeaderRow = costsFirstRow - 1;
	for (const account of report.byAccount) {
		sheet.push([
			text(account.accountId),
			text(account.accountType),
			num(account.withholdingTax, 2),
			num(account.fees, 2),
			num(account.interest, 2),
		]);
	}
	const costsLastRow = Math.max(sheet.rows.length, costsFirstRow);

	sheet.table({
		headerRow,
		lastRow,
		columns: 7,
		totalRow: dividendsTotalRow ?? undefined,
	});
	sheet.table({ headerRow: costsHeaderRow, lastRow: costsLastRow, columns: 5 });
	return {
		grid: sheet.finish(7),
		anchors: { dividendsTotalRow, costsFirstRow, costsLastRow },
	};
}

function buildTransactionsSheet(activities: Activity[]): SheetGrid {
	const sheet = new SheetBuilder(SHEET_NAMES.transactions);

	sheet.push([
		text(
			"Quantity is shares on Trade and corporate-action rows and dollars on every other type — never sum this column across types. Unit price is already CAD; never multiply it by the FX rate.",
		),
	]);
	sheet.push(
		[
			"Date",
			"Settlement",
			"Account",
			"Account type",
			"Activity",
			"Sub-type",
			"Symbol",
			"Name",
			"Quantity",
			"Unit price (CAD)",
			"Commission (CAD)",
			"Net cash (CAD)",
			"FX rate",
			"Description",
		].map((header) => text(header)),
	);
	const headerRow = sheet.rows.length;

	const ordered = [...activities].sort(
		(a, b) =>
			a.transactionDate.localeCompare(b.transactionDate) ||
			a.accountId.localeCompare(b.accountId),
	);

	for (const activity of ordered) {
		const fxRate = extractFxRate(activity.description);
		sheet.push([
			text(activity.transactionDate),
			text(activity.settlementDate),
			text(activity.accountId),
			text(activity.accountType),
			text(activity.activityType),
			text(activity.activitySubType),
			text(activity.symbol),
			text(normalizeName(activity.name)),
			activity.quantity === null ? BLANK : num(activity.quantity, 8),
			activity.unitPrice === null ? BLANK : num(activity.unitPrice, 8),
			activity.commission === null ? BLANK : num(activity.commission, 8),
			num(activity.netCashAmount, 2),
			fxRate === null ? BLANK : num(fxRate, 6),
			text(activity.description),
		]);
	}

	sheet.table({ headerRow, lastRow: sheet.rows.length, columns: 14 });
	return sheet.finish(14);
}

/**
 * The workbook, in tab order. Detail tabs are built first so the Summary can
 * cite the exact rows their totals landed on, then it is moved to the front —
 * it is the tab that should be open when the file is first seen.
 */
export function buildWorkbook(
	report: PositionsReport,
	options: SheetOptions,
): SheetGrid[] {
	const holdings = buildHoldingsSheet(report, options);
	const cash = buildCashSheet(report);
	const closed = buildClosedSheet(report);
	const income = buildIncomeSheet(report);

	const summary = buildSummarySheet(
		report,
		options,
		holdings.anchors,
		cash.anchors,
		closed.anchors,
		income.anchors,
	);

	const sheets = [
		summary,
		holdings.grid,
		buildAccountTypeSheet(report, holdings.anchors),
		buildYearSheet(options.activities),
		cash.grid,
		closed.grid,
		income.grid,
	];

	if (options.includeTransactionLog !== false) {
		sheets.push(buildTransactionsSheet(options.activities));
	}

	return sheets;
}

/** What the export dialog tells the user before they commit to it. */
export interface SheetSummary {
	openCount: number;
	closedCount: number;
	transactionCount: number;
	rowCount: number;
	sheetCount: number;
	byteLength: number;
	suspectAccounts: AccountRollup[];
	byListing: Record<Listing, number>;
}

export function summarizeWorkbook(
	report: PositionsReport,
	sheets: SheetGrid[],
	activities: Activity[],
	byteLength: number,
): SheetSummary {
	const byListing: Record<Listing, number> = {
		us: 0,
		ca: 0,
		crypto: 0,
		unknown: 0,
	};
	for (const position of report.open) byListing[position.listing] += 1;

	return {
		openCount: report.open.length,
		closedCount: report.closed.length,
		transactionCount: activities.length,
		rowCount: sheets.reduce((total, sheet) => total + sheet.rowCount, 0),
		sheetCount: sheets.length,
		byteLength,
		suspectAccounts: report.byAccount.filter(
			(account) => account.historyConfidence === "suspect",
		),
		byListing,
	};
}
