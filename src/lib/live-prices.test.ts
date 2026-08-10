import { describe, expect, it } from "vitest";
import {
	type LivePriceQuote,
	type LivePriceResponse,
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
});
