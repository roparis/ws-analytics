import type { PriceSnapshot } from "@/lib/price-snapshot";

/**
 * The contract between the browser and `/api/prices`, and the assembly of a
 * `PriceSnapshot` from what comes back.
 *
 * **This is the one part of the app that talks to a server.** Everything else
 * runs in the tab: activities are parsed in the browser, positions are derived
 * in the browser, and nothing is uploaded. Yahoo can't be called from a page —
 * their endpoints send no CORS headers and want a cookie and crumb first — so a
 * quote has to be fetched by the Next.js process serving this app. Self-hosted,
 * that process is on the same machine as the browser; deployed, it isn't, and
 * that difference is worth being loud about (`docs/yahoo-pricing-poc.md`).
 *
 * What crosses the wire is deliberately thin: **ticker symbols only**. Never a
 * share count, an account id, a book cost, or a file. The server can see that
 * someone asked what VFV is worth; it cannot see that they own any of it.
 */

/** One holding to price: the export's symbol, and Yahoo's name for it. */
export interface PriceRequestSymbol {
	/** Wealthsimple's symbol — the key the snapshot is written under. */
	symbol: string;
	/** The Yahoo ticker to quote it as, from `yahooTickerGuess`. */
	ticker: string;
}

export interface LivePriceRequest {
	symbols: PriceRequestSymbol[];
}

export interface LivePriceQuote extends PriceRequestSymbol {
	/** Price per share in CAD, converted if the listing quotes another currency. */
	priceCad: number;
	/** What Yahoo quoted, before conversion. */
	nativePrice: number;
	/** The currency of `nativePrice` — `CAD` for anything not converted. */
	currency: string;
	/** Yahoo's name for the instrument, to check the ticker guess landed. */
	name: string | null;
	/** When that price last moved, ISO. Null when Yahoo didn't say. */
	quotedAt: string | null;
	/** `REGULAR` while the exchange is open; anything else is a last close. */
	marketState: string | null;
}

/** A symbol that was asked for and came back without a usable price. */
export interface LivePriceMiss extends PriceRequestSymbol {
	/** Plain-English, shown as-is in the UI. */
	reason: string;
}

export interface LivePriceResponse {
	/** ISO instant the server made the call. */
	fetchedAt: string;
	/** USD→CAD used for conversion, or null when nothing needed converting. */
	usdCad: number | null;
	quotes: LivePriceQuote[];
	misses: LivePriceMiss[];
}

/** What the route sends instead of a result when it can't produce one. */
export interface LivePriceErrorBody {
	error: string;
}

/**
 * The most symbols one request may carry.
 *
 * Yahoo takes a comma-separated list and answers in one round trip, so the cap
 * isn't about batching — it's a ceiling on what a public deployment of this
 * route can be asked to do on someone else's behalf. Portfolios this app is
 * built for hold tens of positions.
 */
export const MAX_SYMBOLS = 100;

/** Where the browser sends its list. */
export const PRICES_ENDPOINT = "/api/prices";

/**
 * Folds a response into the same `PriceSnapshot` the Sheets import produces.
 *
 * Deliberately the same shape: `valueWith`, the staleness rules, the summary
 * tiles and the stored copy in IndexedDB all keep working without knowing where
 * a price came from. Live quotes are a second door into an existing room, not a
 * parallel one.
 */
export function snapshotFromLivePrices(
	response: LivePriceResponse,
	asOf = new Date().toISOString().slice(0, 10),
): PriceSnapshot {
	const pricesCad: Record<string, number> = {};
	for (const quote of response.quotes) {
		pricesCad[quote.symbol] = quote.priceCad;
	}

	return {
		asOf,
		source: "yahoo",
		// The newest quote in the set — "as of" to the minute rather than the day,
		// which is the whole point of asking a live source.
		quotedAt: newestQuoteTime(response.quotes),
		pricesCad,
		matched: Object.keys(pricesCad).sort(),
		unpriced: response.misses.map((miss) => miss.symbol).sort(),
	};
}

function newestQuoteTime(quotes: LivePriceQuote[]): string | undefined {
	let newest: string | undefined;
	for (const quote of quotes) {
		if (quote.quotedAt && (!newest || quote.quotedAt > newest)) {
			newest = quote.quotedAt;
		}
	}
	return newest;
}

export class LivePriceError extends Error {}

/**
 * Asks the route for prices.
 *
 * Failure is reported, never guessed at: a route that is down, a Yahoo that is
 * rate-limiting and a ticker that doesn't exist are three different messages,
 * and none of them silently leaves the old snapshot looking current.
 */
export async function fetchLivePrices(
	symbols: PriceRequestSymbol[],
): Promise<LivePriceResponse> {
	if (symbols.length === 0) {
		throw new LivePriceError("There are no holdings to price.");
	}
	if (symbols.length > MAX_SYMBOLS) {
		throw new LivePriceError(
			`That's ${symbols.length} symbols; this route quotes at most ${MAX_SYMBOLS} at a time.`,
		);
	}

	let response: Response;
	try {
		response = await fetch(PRICES_ENDPOINT, {
			body: JSON.stringify({ symbols } satisfies LivePriceRequest),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
	} catch {
		throw new LivePriceError(
			"Couldn't reach the price route. Is the app still running?",
		);
	}

	const body: unknown = await response.json().catch(() => null);

	if (!response.ok) {
		const message =
			body && typeof body === "object" && "error" in body
				? String((body as LivePriceErrorBody).error)
				: `The price route answered ${response.status}.`;
		throw new LivePriceError(message);
	}

	return body as LivePriceResponse;
}
