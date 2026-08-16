import { describe, expect, it } from "vitest";
import { todayLocalIso } from "@/lib/calendar-date";
import {
	type LivePriceQuote,
	type LivePriceResponse,
	MAX_HISTORY_SYMBOLS,
	MAX_SYMBOLS,
	readRequestSymbols,
	snapshotFromLivePrices,
} from "@/lib/live-prices";

function quote(overrides: Partial<LivePriceQuote> = {}): LivePriceQuote {
	return {
		currency: "CAD",
		marketState: "CLOSED",
		name: "Vanguard S&P 500 Index ETF",
		nativePrice: 191.82,
		priceCad: 191.82,
		quotedAt: "2026-08-07T20:00:00.000Z",
		symbol: "VFV",
		ticker: "VFV.TO",
		...overrides,
	};
}

function response(
	overrides: Partial<LivePriceResponse> = {},
): LivePriceResponse {
	return {
		fetchedAt: "2026-08-10T11:00:00.000Z",
		misses: [],
		quotes: [quote()],
		usdCad: null,
		...overrides,
	};
}

describe("snapshotFromLivePrices", () => {
	it("keys prices by the export's symbol, not the Yahoo ticker", () => {
		const snapshot = snapshotFromLivePrices(response(), "2026-08-10");

		// `valueWith` looks up `position.symbol`; a snapshot keyed by "VFV.TO"
		// would price nothing while looking like it had worked.
		expect(snapshot.pricesCad).toEqual({ VFV: 191.82 });
		expect(snapshot.matched).toEqual(["VFV"]);
	});

	it("records where the prices came from", () => {
		expect(snapshotFromLivePrices(response(), "2026-08-10").source).toBe(
			"yahoo",
		);
	});

	it("dates the snapshot by when it was read, not when the market last moved", () => {
		// Staleness is measured from the read date everywhere else in the app, and
		// a Monday-morning fetch of Friday's close is a fresh snapshot of old
		// prices — `quotedAt` is what says how old they are.
		const snapshot = snapshotFromLivePrices(response(), "2026-08-10");

		expect(snapshot.asOf).toBe("2026-08-10");
		expect(snapshot.quotedAt).toBe("2026-08-07T20:00:00.000Z");
	});

	it("takes the newest quote time across a mixed set", () => {
		const snapshot = snapshotFromLivePrices(
			response({
				quotes: [
					quote(),
					quote({
						quotedAt: "2026-08-10T11:05:03.000Z",
						symbol: "BTC",
						ticker: "BTC-CAD",
					}),
				],
			}),
			"2026-08-10",
		);

		expect(snapshot.quotedAt).toBe("2026-08-10T11:05:03.000Z");
	});

	it("carries misses through as unpriced rather than dropping them", () => {
		const snapshot = snapshotFromLivePrices(
			response({
				misses: [
					{
						reason: "Yahoo doesn't quote WSF-F.TO.",
						symbol: "WSF.F",
						ticker: "WSF-F.TO",
					},
				],
			}),
			"2026-08-10",
		);

		// Unpriced is not zero: the holding falls back to book cost, and the UI
		// names it so the ticker guess can be fixed.
		expect(snapshot.unpriced).toEqual(["WSF.F"]);
		expect(snapshot.pricesCad).not.toHaveProperty("WSF.F");
	});

	it("leaves quotedAt unset when nothing carried a timestamp", () => {
		const snapshot = snapshotFromLivePrices(
			response({ quotes: [quote({ quotedAt: null })] }),
			"2026-08-10",
		);

		expect(snapshot.quotedAt).toBeUndefined();
	});

	it("defaults asOf to today's local date", () => {
		expect(snapshotFromLivePrices(response()).asOf).toBe(todayLocalIso());
	});
});

describe("readRequestSymbols", () => {
	it("returns every entry, trimmed", () => {
		expect(
			readRequestSymbols(
				[
					{ symbol: "VFV", ticker: "VFV.TO" },
					{ symbol: "BTC", ticker: "BTC-CAD" },
				],
				"quote",
			),
		).toEqual([
			{ symbol: "VFV", ticker: "VFV.TO" },
			{ symbol: "BTC", ticker: "BTC-CAD" },
		]);
	});

	it("rejects a body whose `symbols` isn't an array", () => {
		expect(() => readRequestSymbols({ not: "an array" }, "quote")).toThrow(
			/symbols/,
		);
	});

	it("rejects an empty array, naming the noun", () => {
		expect(() => readRequestSymbols([], "chart")).toThrow(/chart/);
	});

	it("rejects more than MAX_SYMBOLS entries, naming the cap", () => {
		const symbols = Array.from({ length: MAX_SYMBOLS + 1 }, (_, i) => ({
			symbol: `S${i}`,
			ticker: `T${i}`,
		}));
		expect(() => readRequestSymbols(symbols, "quote")).toThrow(
			new RegExp(String(MAX_SYMBOLS)),
		);
	});

	it("accepts exactly MAX_SYMBOLS entries — the boundary is inclusive", () => {
		const symbols = Array.from({ length: MAX_SYMBOLS }, (_, i) => ({
			symbol: `S${i}`,
			ticker: `T${i}`,
		}));
		expect(readRequestSymbols(symbols, "quote")).toHaveLength(MAX_SYMBOLS);
	});

	it("rejects an entry missing `ticker`", () => {
		expect(() => readRequestSymbols([{ symbol: "VFV" }], "quote")).toThrow();
	});

	it("rejects an entry missing `symbol`", () => {
		expect(() => readRequestSymbols([{ ticker: "VFV.TO" }], "quote")).toThrow();
	});

	it("rejects a ticker with a disallowed character", () => {
		expect(() =>
			readRequestSymbols([{ symbol: "VFV", ticker: "VFV.TO!" }], "quote"),
		).toThrow();
	});

	it("rejects a ticker longer than 20 characters", () => {
		expect(() =>
			readRequestSymbols([{ symbol: "VFV", ticker: "A".repeat(21) }], "quote"),
		).toThrow();
	});

	it("rejects a symbol longer than 20 characters — the new bound", () => {
		expect(() =>
			readRequestSymbols(
				[{ symbol: "S".repeat(21), ticker: "VFV.TO" }],
				"quote",
			),
		).toThrow();
	});

	it("rejects a symbol with a disallowed character — the new bound", () => {
		expect(() =>
			readRequestSymbols([{ symbol: "VFV!", ticker: "VFV.TO" }], "quote"),
		).toThrow();
	});

	it("trims surrounding whitespace on both fields", () => {
		expect(
			readRequestSymbols(
				[{ symbol: "  VFV  ", ticker: "  VFV.TO  " }],
				"quote",
			),
		).toEqual([{ symbol: "VFV", ticker: "VFV.TO" }]);
	});

	it("accepts every ticker shape tickersFor can produce", () => {
		// Derived from src/lib/yahoo-ticker.ts: `.TO` suffix for `ca` listings
		// (class shares hyphenated), bare for US listings (also hyphenated), and
		// a `-CAD` suffix for crypto. USDCAD=X is the FX pair the routes add
		// alongside whatever the caller asked for.
		const shapes = ["VFV.TO", "CTC-A.TO", "BRK-B", "BTC-CAD", "USDCAD=X"];
		const symbols = shapes.map((ticker) => ({ symbol: ticker, ticker }));
		expect(readRequestSymbols(symbols, "quote")).toHaveLength(shapes.length);
	});

	it("still accepts up to MAX_SYMBOLS when no override is passed", () => {
		const symbols = Array.from({ length: MAX_SYMBOLS }, (_, i) => ({
			symbol: `S${i}`,
			ticker: `T${i}`,
		}));
		expect(readRequestSymbols(symbols, "quote")).toHaveLength(MAX_SYMBOLS);
	});

	it("rejects more than a passed-in maxSymbols, even under MAX_SYMBOLS", () => {
		const symbols = Array.from({ length: MAX_HISTORY_SYMBOLS + 1 }, (_, i) => ({
			symbol: `S${i}`,
			ticker: `T${i}`,
		}));
		expect(symbols.length).toBeLessThan(MAX_SYMBOLS);
		expect(() =>
			readRequestSymbols(symbols, "chart", MAX_HISTORY_SYMBOLS),
		).toThrow(new RegExp(String(MAX_HISTORY_SYMBOLS)));
	});

	it("accepts exactly a passed-in maxSymbols — the boundary is inclusive", () => {
		const symbols = Array.from({ length: MAX_HISTORY_SYMBOLS }, (_, i) => ({
			symbol: `S${i}`,
			ticker: `T${i}`,
		}));
		expect(
			readRequestSymbols(symbols, "chart", MAX_HISTORY_SYMBOLS),
		).toHaveLength(MAX_HISTORY_SYMBOLS);
	});
});
