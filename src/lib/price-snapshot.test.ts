import { describe, expect, it } from "vitest";
import { todayLocalIso } from "@/lib/calendar-date";
import { buildWorkbook, type Cell, SHEET_NAMES } from "@/lib/google-sheet";
import { buildPositions } from "@/lib/positions";
import {
	PriceCsvError,
	parsePriceCsv,
	snapshotAgeDays,
	valuedBalances,
	valueWith,
} from "@/lib/price-snapshot";
import type { Activity } from "@/lib/wealthsimple";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
	return {
		transactionDate: "2026-01-15",
		effectiveAt: null,
		settlementDate: null,
		accountId: "TFSA0001CAD",
		accountType: "TFSA",
		activityType: "MoneyMovement",
		activitySubType: "EFT",
		description: "Deposit",
		symbol: null,
		name: null,
		currency: "CAD",
		quantity: 1000,
		unitPrice: null,
		commission: null,
		netCashAmount: 1000,
		...overrides,
	};
}

function trade(
	overrides: Partial<Activity> & { quantity: number; unitPrice: number },
): Activity {
	const symbol = overrides.symbol ?? "ZAG";
	return makeActivity({
		activitySubType: overrides.quantity > 0 ? "BUY" : "SELL",
		activityType: "Trade",
		description: `${symbol} - Fund: ${overrides.quantity > 0 ? "Bought" : "Sold"} shares`,
		name: "BMO Aggregate Bond Index ETF",
		symbol,
		...overrides,
		netCashAmount: -(overrides.quantity * overrides.unitPrice),
	});
}

const ACTIVITIES = [
	makeActivity({ netCashAmount: 6000, quantity: 6000 }),
	trade({ quantity: 100, unitPrice: 10 }),
	trade({ quantity: 20, symbol: "VTI", unitPrice: 100 }),
	makeActivity({
		accountId: "RRSP0001CAD",
		accountType: "RRSP",
		netCashAmount: 3000,
		quantity: 3000,
	}),
	trade({
		accountId: "RRSP0001CAD",
		accountType: "RRSP",
		quantity: 50,
		symbol: "XEQT",
		unitPrice: 30,
	}),
];

const REPORT = buildPositions(ACTIVITIES);

/**
 * Renders the app's own Holdings tab the way Google Sheets would after
 * downloading it as CSV: formulas replaced by the values they resolve to, and
 * everything else left alone.
 *
 * Built from `buildWorkbook` rather than hand-written so the parser is tested
 * against the exporter's real headers and preamble. A column rename on one side
 * fails here rather than in someone's browser.
 *
 * A price may be given as a string to stand in for a cell the spreadsheet
 * formatted — `"95,000"`, `"1 234,56"`. Those are written through the same
 * quoting as every other cell, so an embedded comma stays inside its column
 * instead of splitting the row.
 */
function holdingsCsv(prices: Record<string, number | string>): string {
	const sheets = buildWorkbook(REPORT, {
		activities: ACTIVITIES,
		dataThrough: "2026-08-01",
		fileName: "activities.csv",
		generatedOn: "2026-08-09",
		includeTransactionLog: false,
	});
	const holdings = sheets.find((sheet) => sheet.name === SHEET_NAMES.holdings);
	if (!holdings) throw new Error("no holdings sheet");

	const headerRow = holdings.rows.find(
		(row) => row[0]?.kind === "text" && row[0].value === "Account",
	);
	if (!headerRow) throw new Error("no header row");

	const columnOf = (header: string) =>
		headerRow.findIndex(
			(cell) => cell?.kind === "text" && cell.value === header,
		);
	const symbolAt = columnOf("Symbol");
	const priceAt = columnOf("Price (CAD)");

	const render = (cell: Cell | undefined): string => {
		if (!cell) return "";
		if (cell.kind === "text") return cell.value;
		if (cell.kind === "number") return String(cell.value);
		return "";
	};

	const lines = holdings.rows.map((row) => {
		const cells: string[] = [];
		for (let index = 0; index < holdings.columnCount; index += 1) {
			const symbol = render(row[symbolAt]);
			if (index === priceAt && symbol && symbol !== "Symbol") {
				const price = prices[symbol];
				cells.push(price === "" || price === undefined ? "" : String(price));
				continue;
			}
			cells.push(render(row[index]));
		}
		return cells
			.map((value) =>
				/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value,
			)
			.join(",");
	});

	return lines.join("\n");
}

describe("parsePriceCsv", () => {
	it("reads prices out of the app's own Holdings tab", () => {
		const csv = holdingsCsv({ ZAG: 11.5, VTI: 140, XEQT: 34.25 });
		const snapshot = parsePriceCsv(csv, "Holdings.csv", "2026-08-09");

		expect(snapshot.pricesCad).toEqual({ ZAG: 11.5, VTI: 140, XEQT: 34.25 });
		expect(snapshot.matched).toEqual(["VTI", "XEQT", "ZAG"]);
		expect(snapshot.unpriced).toEqual([]);
		expect(snapshot.asOf).toBe("2026-08-09");
	});

	it("skips the preamble rows above the header", () => {
		// The tab opens with a title, a data-through row, an FX row and two
		// caveats before the header — a naive header:true parse reads the title.
		const csv = holdingsCsv({ ZAG: 11.5, VTI: 140, XEQT: 34.25 });
		expect(csv.split("\n")[0]).not.toContain("Symbol");
		expect(parsePriceCsv(csv, "Holdings.csv").matched).toHaveLength(3);
	});

	it("treats a blank price as unknown rather than as zero", () => {
		// An unresolvable ticker leaves the cell empty. Zero would render as a
		// holding that had lost all its value.
		const snapshot = parsePriceCsv(
			holdingsCsv({ ZAG: 11.5, VTI: "", XEQT: 34.25 }),
			"Holdings.csv",
		);

		expect(snapshot.pricesCad).not.toHaveProperty("VTI");
		expect(snapshot.unpriced).toEqual(["VTI"]);
	});

	it("reads a price the sheet formatted with a currency symbol", () => {
		const csv = holdingsCsv({ ZAG: 11.5, VTI: 140, XEQT: 34.25 }).replace(
			",11.5,",
			',"$1,211.50",',
		);
		expect(parsePriceCsv(csv, "Holdings.csv").pricesCad.ZAG).toBeCloseTo(
			1211.5,
			6,
		);
	});

	it("reads a thousands-grouped integer at full scale", () => {
		// A price cell formatted to zero decimal places — a plausible default for
		// a high-priced instrument — downloads as `95,000`. Reading that comma as
		// a decimal point gives 95: a price wrong by three orders of magnitude,
		// and every market value, unrealised gain and projection follows it down.
		const csv = holdingsCsv({ ZAG: "95,000", VTI: 140, XEQT: 34.25 });
		expect(parsePriceCsv(csv, "Holdings.csv").pricesCad.ZAG).toBeCloseTo(
			95_000,
			6,
		);
	});

	// Both directions of the comma rule. A decimal comma has to keep working —
	// it is why the rule accepting one exists — and a group separator must not
	// be eaten. What tells them apart is the digits after the comma, and that
	// question has to be asked before anything is assumed about the dots: in
	// `1.234,56` the dot groups, in `1,234.56` it decides.
	const formats: [label: string, cell: string, expected: number][] = [
		["an Anglo group separator beside a decimal point", "1,234.56", 1234.56],
		["a European decimal comma", "1234,56", 1234.56],
		["a European decimal comma after a space group", "1 234,56", 1234.56],
		["a European decimal comma after a dot group", "1.234,56", 1234.56],
		["a European price grouped more than once", "1.234.567,89", 1_234_567.89],
		["an integer grouped more than once", "1,234,567", 1_234_567],
		["a plain decimal, the usual GOOGLEFINANCE output", "42.7592", 42.7592],
	];

	for (const [label, cell, expected] of formats) {
		it(`reads ${label}`, () => {
			const csv = holdingsCsv({ ZAG: cell, VTI: 140, XEQT: 34.25 });
			expect(parsePriceCsv(csv, "Holdings.csv").pricesCad.ZAG).toBeCloseTo(
				expected,
				6,
			);
		});
	}

	it("treats a zero price as unknown rather than as a wiped-out holding", () => {
		const snapshot = parsePriceCsv(
			holdingsCsv({ ZAG: 11.5, VTI: 0, XEQT: 34.25 }),
			"Holdings.csv",
		);

		expect(snapshot.pricesCad).not.toHaveProperty("VTI");
		expect(snapshot.unpriced).toEqual(["VTI"]);
	});

	it("rejects a file that isn't the Holdings tab", () => {
		expect(() => parsePriceCsv("a,b,c\n1,2,3", "Summary.csv")).toThrow(
			PriceCsvError,
		);
	});

	it("rejects a Holdings tab where nothing priced", () => {
		expect(() =>
			parsePriceCsv(
				holdingsCsv({ ZAG: "", VTI: "", XEQT: "" }),
				"Holdings.csv",
			),
		).toThrow(PriceCsvError);
	});

	it("defaults asOf to today's local date", () => {
		const csv = holdingsCsv({ ZAG: 11.5, VTI: 140, XEQT: 34.25 });
		expect(parsePriceCsv(csv, "Holdings.csv").asOf).toBe(todayLocalIso());
	});
});

describe("valueWith", () => {
	const snapshot = parsePriceCsv(
		holdingsCsv({ ZAG: 11.5, VTI: 140, XEQT: 34.25 }),
		"Holdings.csv",
		"2026-08-09",
	);

	it("recomputes value from its own share counts, not the sheet's", () => {
		const valued = valueWith(REPORT, snapshot);
		const tfsa = valued?.byAccountType.find(
			(row) => row.accountType === "TFSA",
		);

		// 100 ZAG at 11.50 plus 20 VTI at 140.
		expect(tfsa?.marketValue).toBeCloseTo(100 * 11.5 + 20 * 140, 6);
		expect(valued?.pricedCount).toBe(3);
		expect(valued?.missingSymbols).toEqual([]);
	});

	it("adds the account's uninvested cash to its value", () => {
		const valued = valueWith(REPORT, snapshot);
		const rrsp = valued?.byAccountType.find(
			(row) => row.accountType === "RRSP",
		);

		// $3000 in, $1500 of XEQT bought, so $1500 of cash is left beside it.
		expect(rrsp?.cashBalance).toBeCloseTo(1500, 6);
		expect(rrsp?.total).toBeCloseTo(50 * 34.25 + 1500, 6);
	});

	it("falls back to book cost for a holding it couldn't price", () => {
		// Dropping it would understate the account; pricing it at zero would be
		// a lie. What was paid is the only defensible stand-in.
		const partial = parsePriceCsv(
			holdingsCsv({ ZAG: 11.5, VTI: "", XEQT: 34.25 }),
			"Holdings.csv",
		);
		const valued = valueWith(REPORT, partial);
		const tfsa = valued?.byAccountType.find(
			(row) => row.accountType === "TFSA",
		);

		expect(valued?.missingSymbols).toEqual(["VTI"]);
		expect(tfsa?.unpricedBookCost).toBeCloseTo(2000, 6);
		expect(tfsa?.marketValue).toBeCloseTo(100 * 11.5, 6);
		// $1150 priced + $2000 at book + $3000 cash left after two buys.
		expect(tfsa?.total).toBeCloseTo(1150 + 2000 + 3000, 6);
	});

	it("is null without a snapshot, so callers fall back to book cost", () => {
		expect(valueWith(REPORT, null)).toBeNull();
	});

	it("rounds the starting balances it hands the projection to cents", () => {
		const valued = valueWith(REPORT, snapshot);
		if (!valued) throw new Error("expected a valued report");
		const balances = valuedBalances(valued);

		for (const value of Object.values(balances)) {
			expect(Number.isFinite(value)).toBe(true);
			expect(Math.round(value * 100)).toBeCloseTo(value * 100, 6);
		}
		expect(Object.keys(balances).sort()).toEqual(["RRSP", "TFSA"]);
	});
});

describe("snapshotAgeDays", () => {
	const snapshot = {
		asOf: "2026-08-01",
		fileName: "Holdings.csv",
		pricesCad: {},
		matched: [],
		unpriced: [],
	};

	// Built from local components rather than a fixed UTC instant: a fixed
	// instant's toISOString() is identical in every timezone, so it would agree
	// with the bug this function used to have instead of catching it.
	it("counts whole days since the prices were read", () => {
		expect(snapshotAgeDays(snapshot, new Date(2026, 7, 9, 21, 0))).toBe(8);
	});

	it("is zero on the day it was taken", () => {
		expect(snapshotAgeDays(snapshot, new Date(2026, 7, 1, 23, 0))).toBe(0);
	});

	it("never goes negative on a clock that disagrees", () => {
		expect(snapshotAgeDays(snapshot, new Date(2026, 6, 20, 12, 0))).toBe(0);
	});

	it("is exact across the fall-back DST boundary", () => {
		const fallSnapshot = { ...snapshot, asOf: "2026-10-30" };
		expect(snapshotAgeDays(fallSnapshot, new Date(2026, 10, 3, 12, 0))).toBe(4);
	});
});
