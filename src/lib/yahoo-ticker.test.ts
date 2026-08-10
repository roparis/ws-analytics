import { describe, expect, it } from "vitest";
import type { Listing } from "@/lib/positions";
import { tickersFor, yahooTickerGuess } from "@/lib/yahoo-ticker";

function holding(symbol: string, listing: Listing) {
	return { listing, symbol };
}

describe("yahooTickerGuess", () => {
	it("leaves US listings bare", () => {
		expect(yahooTickerGuess(holding("VTI", "us"))).toBe("VTI");
	});

	it("suffixes Canadian listings with the exchange", () => {
		expect(yahooTickerGuess(holding("VFV", "ca"))).toBe("VFV.TO");
	});

	it("hyphenates class shares, which Yahoo writes with a dash", () => {
		expect(yahooTickerGuess(holding("BRK.B", "us"))).toBe("BRK-B");
		expect(yahooTickerGuess(holding("CTC.A", "ca"))).toBe("CTC-A.TO");
	});

	it("prices crypto against CAD directly, not through USD", () => {
		expect(yahooTickerGuess(holding("BTC", "crypto"))).toBe("BTC-CAD");
	});

	it("treats an undetectable listing as bare, the way the sheet does", () => {
		expect(yahooTickerGuess(holding("SPY", "unknown"))).toBe("SPY");
	});

	it("normalises whitespace and case out of the export's symbol", () => {
		expect(yahooTickerGuess(holding("  vfv ", "ca"))).toBe("VFV.TO");
	});
});

describe("tickersFor", () => {
	it("quotes a symbol once however many accounts hold it", () => {
		expect(
			tickersFor([
				holding("VFV", "ca"),
				holding("VFV", "ca"),
				holding("VTI", "us"),
			]),
		).toEqual([
			{ symbol: "VFV", ticker: "VFV.TO" },
			{ symbol: "VTI", ticker: "VTI" },
		]);
	});

	it("keys on the export's symbol, so the snapshot lines up with positions", () => {
		// The ticker is normalised for Yahoo; the symbol is not, because
		// `valueWith` looks prices up by the symbol `buildPositions` produced.
		const [first] = tickersFor([holding("CTC.A", "ca")]);
		expect(first).toEqual({ symbol: "CTC.A", ticker: "CTC-A.TO" });
	});

	it("skips holdings with no symbol", () => {
		expect(tickersFor([holding("", "ca"), holding("VFV", "ca")])).toHaveLength(
			1,
		);
	});
});
