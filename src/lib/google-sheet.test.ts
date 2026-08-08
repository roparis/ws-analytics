import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import {
	buildWorkbook,
	colName,
	FX_CELL,
	googleTickerGuess,
	gridToTsv,
	num,
	SHEET_NAMES,
	type SheetGrid,
	text,
} from "@/lib/google-sheet";
import { buildPositions } from "@/lib/positions";
import type { Activity } from "@/lib/wealthsimple";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
	return {
		transactionDate: "2026-01-15",
		effectiveAt: null,
		settlementDate: null,
		accountId: "TEST0001CAD",
		accountType: "TFSA",
		activityType: "MoneyMovement",
		activitySubType: "EFT",
		description: "Deposit",
		symbol: null,
		name: null,
		currency: "CAD",
		quantity: 100,
		unitPrice: null,
		commission: null,
		netCashAmount: 100,
		...overrides,
	};
}

function buy(overrides: Partial<Activity> = {}): Activity {
	return makeActivity({
		activitySubType: "BUY",
		activityType: "Trade",
		description: "ZAG - BMO Aggregate Bond Index ETF: Bought 10 shares",
		name: "BMO Aggregate Bond Index ETF",
		netCashAmount: -100,
		quantity: 10,
		settlementDate: "2026-01-17",
		symbol: "ZAG",
		unitPrice: 10,
		...overrides,
	});
}

/** One open holding, one closed, one US-listed, and a dividend. */
function sampleActivities(): Activity[] {
	return [
		makeActivity({ netCashAmount: 1000, quantity: 1000 }),
		buy({ transactionDate: "2026-01-02" }),
		buy({
			description:
				"VTI - Vanguard Total Stock Market ETF: Bought 1 shares at $513.45 per share, FX Rate: 1.3800",
			name: "Vanguard Total Stock Market ETF",
			netCashAmount: -513.45,
			quantity: 1,
			symbol: "VTI",
			transactionDate: "2026-02-02",
			unitPrice: 513.45,
		}),
		makeActivity({
			activitySubType: null,
			activityType: "Dividend",
			description: "ZAG - BMO Aggregate Bond Index ETF: Cash dividend",
			name: "BMO Aggregate Bond Index ETF",
			netCashAmount: 4.25,
			quantity: 4.25,
			symbol: "ZAG",
			transactionDate: "2026-03-02",
		}),
		buy({
			description: "QCN - Fund: Bought 5 shares",
			name: "Fund",
			netCashAmount: -50,
			quantity: 5,
			symbol: "QCN",
			transactionDate: "2026-04-02",
		}),
		buy({
			activitySubType: "SELL",
			description: "QCN - Fund: Sold 5 shares",
			name: "Fund",
			netCashAmount: 60,
			quantity: -5,
			symbol: "QCN",
			transactionDate: "2026-05-02",
			unitPrice: 12,
		}),
	];
}

function sampleWorkbook(includeTransactionLog = true) {
	const activities = sampleActivities();
	const report = buildPositions(activities);
	return {
		activities,
		report,
		sheets: buildWorkbook(report, {
			activities,
			dataThrough: "2026-05-02",
			fileName: "activities-export.csv",
			generatedOn: "2026-08-07",
			includeTransactionLog,
		}),
	};
}

function sheetNamed(sheets: SheetGrid[], name: string): SheetGrid {
	const sheet = sheets.find((candidate) => candidate.name === name);
	if (!sheet) throw new Error(`no sheet named ${name}`);
	return sheet;
}

describe("cell rendering", () => {
	it("collapses tabs, newlines and non-breaking spaces into one cell", () => {
		expect(text("2U\tInc.\r\nLtd  ")).toEqual({
			kind: "text",
			value: "2U Inc. Ltd",
		});
	});

	it("guards formula-like text on the TSV path only", () => {
		// The cell keeps the clean value; the apostrophe belongs to the paste
		// path, because an xlsx inline string is unambiguously a string and would
		// show the guard as a literal character.
		expect(text('=GOOGLEFINANCE("VTI")')).toEqual({
			kind: "text",
			value: '=GOOGLEFINANCE("VTI")',
		});
		expect(
			gridToTsv({
				name: "t",
				rows: [[text('=GOOGLEFINANCE("VTI")'), text("-4.50 adjustment")]],
				rowCount: 1,
				columnCount: 2,
				regions: [],
			}),
		).toBe('\'=GOOGLEFINANCE("VTI")\t-4.50 adjustment');
	});

	it("keeps registered marks and accents intact", () => {
		expect(text("Interac e-Transfer® Out")).toEqual({
			kind: "text",
			value: "Interac e-Transfer® Out",
		});
	});

	it("renders numbers without a locale, a symbol or an exponent", () => {
		const render = (cell: ReturnType<typeof num>) =>
			gridToTsv({
				name: "t",
				rows: [[cell]],
				rowCount: 1,
				columnCount: 1,
				regions: [],
			});

		expect(render(num(1234.56))).toBe("1234.56");
		expect(render(num(-88.61))).toBe("-88.61");
		expect(render(num(0.006782, 8))).toBe("0.006782");
		expect(render(num(2, 8))).toBe("2");
		expect(render(num(1e-7, 8))).toBe("0.0000001");
		// An account that nets to zero sums to -1e-14, not to 0, and must still
		// render as a clean "0" rather than "-0".
		expect(render(num(-0))).toBe("0");
		expect(render(num(-1e-14))).toBe("0");
	});

	it("pads every row to the sheet width so ranges stay aligned", () => {
		const tsv = gridToTsv({
			name: "t",
			rows: [[text("a")], [text("a"), text("b"), text("c")]],
			rowCount: 2,
			columnCount: 3,
			regions: [],
		});
		expect(tsv.split("\n").map((row) => row.split("\t").length)).toEqual([
			3, 3,
		]);
	});
});

describe("column names", () => {
	it("maps indices onto spreadsheet columns", () => {
		expect(colName(0)).toBe("A");
		expect(colName(25)).toBe("Z");
		expect(colName(26)).toBe("AA");
	});
});

describe("google ticker guesses", () => {
	it("prefixes Canadian listings and leaves US ones bare", () => {
		expect(googleTickerGuess({ listing: "us", symbol: "VTI" })).toBe("VTI");
		expect(googleTickerGuess({ listing: "ca", symbol: "ZAG" })).toBe("TSE:ZAG");
		expect(googleTickerGuess({ listing: "ca", symbol: "BTCC.B" })).toBe(
			"TSE:BTCC.B",
		);
		expect(googleTickerGuess({ listing: "crypto", symbol: "BTC" })).toBe(
			"CURRENCY:BTCCAD",
		);
	});
});

describe("the workbook", () => {
	it("opens on Summary and carries every analytics tab in order", () => {
		const { sheets } = sampleWorkbook();
		expect(sheets.map((sheet) => sheet.name)).toEqual([
			SHEET_NAMES.summary,
			SHEET_NAMES.holdings,
			SHEET_NAMES.accountTypes,
			SHEET_NAMES.years,
			SHEET_NAMES.cash,
			SHEET_NAMES.closed,
			SHEET_NAMES.income,
			SHEET_NAMES.transactions,
		]);
	});

	it("drops only the transactions sheet when the log is turned off", () => {
		const { sheets } = sampleWorkbook(false);
		expect(sheets.map((sheet) => sheet.name)).toEqual([
			SHEET_NAMES.summary,
			SHEET_NAMES.holdings,
			SHEET_NAMES.accountTypes,
			SHEET_NAMES.years,
			SHEET_NAMES.cash,
			SHEET_NAMES.closed,
			SHEET_NAMES.income,
		]);
	});

	it("numbers each sheet's rows from 1 independently", () => {
		const { sheets, activities } = sampleWorkbook();
		const transactions = sheetNamed(sheets, SHEET_NAMES.transactions);
		// A warning row, a header row, then one row per activity.
		expect(transactions.rowCount).toBe(activities.length + 2);
	});
});

describe("the holdings sheet", () => {
	it("puts the live FX rate exactly where the price formulas look for it", () => {
		const { sheets } = sampleWorkbook();
		const holdings = sheetNamed(sheets, SHEET_NAMES.holdings);
		expect(holdings.rows[2][1]).toEqual({
			kind: "formula",
			value: '=GOOGLEFINANCE("CURRENCY:USDCAD")',
		});
		expect(FX_CELL).toBe("$B$3");
	});

	it("points every row's formulas at its own row number", () => {
		// The bug this kills: a formula built from the loop index rather than the
		// pushed row, which silently prices every holding off its neighbour.
		const { sheets } = sampleWorkbook();
		const holdings = sheetNamed(sheets, SHEET_NAMES.holdings);

		const priced = holdings.rows
			.map((row, index) => ({ row, rowNumber: index + 1 }))
			.filter(({ row }) => {
				const cell = row[10];
				return cell?.kind === "formula" && cell.value.includes("GOOGLEFINANCE");
			});

		expect(priced.length).toBeGreaterThan(0);

		for (const { row, rowNumber } of priced) {
			for (const column of [9, 10, 11, 12, 13, 14, 15]) {
				const cell = row[column];
				if (cell?.kind !== "formula") continue;
				// Every relative reference must be this row; the only other rows
				// allowed are absolute ones (the totals row, and $B$3).
				for (const [, absolute, digits] of cell.value.matchAll(
					/\$?[A-Z]+(\$?)(\d+)/g,
				)) {
					if (absolute === "$") continue;
					expect(Number(digits)).toBe(rowNumber);
				}
			}
		}
	});

	it("measures unrealised gain against only the holdings that priced", () => {
		// Google can't price every ticker — .F series units, delisted symbols and
		// spot crypto pairs come back empty. Subtracting the *whole* book cost
		// from a partial market value would invent a loss the size of whatever
		// didn't price, so both sides have to cover the same subset.
		const { sheets } = sampleWorkbook();
		const holdings = sheetNamed(sheets, SHEET_NAMES.holdings);
		const totals = holdings.rows.find(
			(row) => row[0]?.kind === "text" && row[0].value === "Total",
		);

		const unrealised = totals?.[13];
		expect(unrealised?.kind).toBe("formula");
		if (unrealised?.kind !== "formula") return;

		// Netted against the priced subset, not against the book-cost total.
		expect(unrealised.value).toContain("SUMPRODUCT(ISNUMBER(");
		// And no longer blanked out the moment one holding fails to price.
		expect(unrealised.value).not.toMatch(/<>\d+/);
	});

	it("never blanks a breakdown just because one ticker failed to price", () => {
		const { sheets } = sampleWorkbook();
		const summary = sheetNamed(sheets, SHEET_NAMES.summary);

		// Every market-value aggregate on Summary is a plain SUMIF, which simply
		// skips the empty cells rather than refusing to render.
		const aggregates = summary.rows
			.flat()
			.filter(
				(cell) => cell?.kind === "formula" && cell.value.startsWith("=SUMIF("),
			);

		expect(aggregates.length).toBeGreaterThan(0);
		for (const cell of aggregates) {
			if (cell.kind !== "formula") continue;
			expect(cell.value).not.toContain("COUNT(");
		}
	});

	it("cites the exact rows the detail tabs put their totals on", () => {
		const { sheets } = sampleWorkbook();
		const summary = sheetNamed(sheets, SHEET_NAMES.summary);
		const cash = sheetNamed(sheets, SHEET_NAMES.cash);
		const holdings = sheetNamed(sheets, SHEET_NAMES.holdings);

		const cited = (label: string) => {
			const row = summary.rows.find(
				(candidate) =>
					candidate[0]?.kind === "text" && candidate[0].value === label,
			);
			const cell = row?.[1];
			if (cell?.kind !== "formula")
				throw new Error(`${label} is not a formula`);
			return cell.value;
		};

		// Uninvested cash must land on the row the Cash tab actually totals on —
		// the reference is built at generate time, so an off-by-one here would
		// silently report a single account's balance as the whole portfolio's.
		const cashRef = /'([^']+)'!\$C\$(\d+)/.exec(cited("Uninvested cash"));
		expect(cashRef?.[1]).toBe(SHEET_NAMES.cash);
		const cashRow = cash.rows[Number(cashRef?.[2]) - 1];
		expect(cashRow[0]).toEqual({ kind: "text", value: "Total" });
		expect(cashRow[2]?.kind).toBe("formula");

		// Same for book cost, which reaches the Holdings totals row.
		const bookRef = /'([^']+)'!\$([A-Z]+)\$(\d+)/.exec(
			cited("Book cost of holdings"),
		);
		expect(bookRef?.[1]).toBe(SHEET_NAMES.holdings);
		const holdingsRow = holdings.rows[Number(bookRef?.[3]) - 1];
		expect(holdingsRow[0]).toEqual({ kind: "text", value: "Total" });
	});

	it("only ever names tabs that exist in the workbook", () => {
		const { sheets } = sampleWorkbook();
		const names = new Set(sheets.map((sheet) => sheet.name));

		for (const sheet of sheets) {
			for (const row of sheet.rows) {
				for (const cell of row) {
					if (cell?.kind !== "formula") continue;
					for (const [, cited] of cell.value.matchAll(/'([^']+)'!/g)) {
						expect(names).toContain(cited);
					}
				}
			}
		}
	});
});

describe("gain and loss styling", () => {
	const styleOf = (sheet: SheetGrid, row: number, column: number) => {
		const cell = sheet.rows[row - 1]?.[column];
		return cell && (cell.kind === "number" || cell.kind === "formula")
			? cell.style
			: undefined;
	};

	it("marks the figures that can go either way, and only those", () => {
		const { sheets } = sampleWorkbook();
		const holdings = sheetNamed(sheets, SHEET_NAMES.holdings);

		// First holding row: unrealised amount and percent are gain/loss figures.
		expect(styleOf(holdings, 9, 13)).toBe("gainLoss");
		expect(styleOf(holdings, 9, 14)).toBe("gainLossPercent");
		// Book cost, market value and shares are not — colouring them would read
		// as a judgement none of them makes.
		expect(styleOf(holdings, 9, 6)).toBeUndefined();
		expect(styleOf(holdings, 9, 7)).toBeUndefined();
		expect(styleOf(holdings, 9, 12)).toBeUndefined();

		const closed = sheetNamed(sheets, SHEET_NAMES.closed);
		expect(styleOf(closed, 4, 6)).toBe("gainLoss");
		expect(styleOf(closed, 4, 7)).toBe("gainLossPercent");
		expect(styleOf(closed, 4, 4)).toBeUndefined();
	});

	it("styles the summary's headline gain figures", () => {
		const { sheets } = sampleWorkbook();
		const summary = sheetNamed(sheets, SHEET_NAMES.summary);

		const styleFor = (label: string) => {
			const index = summary.rows.findIndex(
				(row) => row[0]?.kind === "text" && row[0].value === label,
			);
			return styleOf(summary, index + 1, 1);
		};

		expect(styleFor("Unrealised gain")).toBe("gainLoss");
		expect(styleFor("Unrealised %")).toBe("gainLossPercent");
		expect(styleFor("Realised gain on closed positions")).toBe("gainLoss");
		expect(styleFor("Net result to date")).toBe("gainLoss");
		// Cash and book cost are plain magnitudes.
		expect(styleFor("Uninvested cash")).toBeUndefined();
		expect(styleFor("Book cost of holdings")).toBeUndefined();
	});

	it("leaves the TSV path untouched — styling is xlsx-only", () => {
		const { sheets } = sampleWorkbook();
		const holdings = sheetNamed(sheets, SHEET_NAMES.holdings);
		const line = gridToTsv(holdings).split("\n")[8].split("\t");
		// The styled cell still emits its bare formula, with no marker of its own.
		expect(line[13]).toMatch(/^=IF\(/);
	});
});

describe("reconciliation", () => {
	it("carries every activity into the transactions sheet", () => {
		const { sheets, activities } = sampleWorkbook();
		const transactions = sheetNamed(sheets, SHEET_NAMES.transactions);
		expect(transactions.rowCount - 2).toBe(activities.length);
	});

	it("round-trips each sheet through a TSV parser with a stable width", () => {
		const { sheets } = sampleWorkbook();
		for (const sheet of sheets) {
			const parsed = Papa.parse<string[]>(gridToTsv(sheet), {
				delimiter: "\t",
			});
			expect(parsed.data).toHaveLength(sheet.rowCount);
			for (const row of parsed.data) {
				expect(row).toHaveLength(sheet.columnCount);
			}
		}
	});

	it("never emits a stray tab or newline inside a cell", () => {
		const activities = sampleActivities();
		activities.push(
			makeActivity({
				description: "Money transfer\tout of\r\nthe account",
				name: "Dirty Name\t",
			}),
		);
		const sheets = buildWorkbook(buildPositions(activities), {
			activities,
			dataThrough: "2026-05-02",
			fileName: "activities-export.csv",
			generatedOn: "2026-08-07",
		});

		for (const sheet of sheets) {
			const widths = new Set(
				gridToTsv(sheet)
					.split("\n")
					.map((row) => row.split("\t").length),
			);
			expect(widths.size).toBe(1);
		}
	});
});
