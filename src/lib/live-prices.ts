import { todayLocalIso } from "@/lib/calendar-date";
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
 * The second call: monthly closes, far enough back to cover the whole export.
 *
 * A quote answers "what is this worth now"; the analytics page asks "what was
 * this worth at the end of 2023", which no single quote can answer. Yahoo's
 * chart endpoint takes one symbol at a time, so this is N requests where the
 * quote route is one — the reason the two are separate routes rather than one
 * call that always pays for both.
 */
export interface PriceHistoryRequest {
	symbols: PriceRequestSymbol[];
	/** `YYYY-MM-DD`, the first day the export covers. */
	from: string;
	/** `YYYY-MM-DD`, the last day it covers. */
	to: string;
}

export interface PriceHistorySeries extends PriceRequestSymbol {
	/** The currency Yahoo quoted the instrument in, before conversion. */
	currency: string;
	/** `YYYY-MM` -> that month's closing price per share, in CAD. */
	monthlyCad: Record<string, number>;
}

export interface PriceHistoryResponse {
	fetchedAt: string;
	series: PriceHistorySeries[];
	misses: LivePriceMiss[];
	/** `YYYY-MM` -> USD→CAD at that month's close. Empty when nothing was USD. */
	usdCadByMonth: Record<string, number>;
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

/**
 * The history route's own, lower ceiling.
 *
 * Unlike the quote route, history costs one upstream Yahoo request *per
 * symbol* plus one for FX — at `MAX_SYMBOLS` that's up to 101 upstream
 * requests for a single inbound one. `tickersFor` emits one entry per
 * distinct held symbol, and the worked example in
 * `docs/yahoo-pricing-poc.md` is a 44-holding portfolio, so 60 leaves real
 * portfolios untouched while roughly halving the worst-case amplification.
 */
export const MAX_HISTORY_SYMBOLS = 60;

/** Where the browser sends its list. */
export const PRICES_ENDPOINT = "/api/prices";

/** And where it asks for the same list's past. */
export const HISTORY_ENDPOINT = "/api/prices/history";

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
	asOf = todayLocalIso(),
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
	guard(symbols);
	return post<LivePriceResponse>(PRICES_ENDPOINT, {
		symbols,
	} satisfies LivePriceRequest);
}

/**
 * Asks the route for the same symbols' monthly closes over a period.
 *
 * Slower than the quote by an order of magnitude — one Yahoo request per symbol
 * — so callers should treat it as the optional half and let a page work without
 * it, the way the analytics page falls back to book cost.
 */
export async function fetchPriceHistory(
	symbols: PriceRequestSymbol[],
	from: string,
	to: string,
): Promise<PriceHistoryResponse> {
	guard(symbols);
	return post<PriceHistoryResponse>(HISTORY_ENDPOINT, {
		from,
		symbols,
		to,
	} satisfies PriceHistoryRequest);
}

// Tickers go into a query string; Yahoo's own alphabet is letters, digits and
// `.-=^`, so anything else is a caller doing something else. `symbol` gets the
// same bound: it is echoed back in every quote, miss and history series, and
// retained through the whole upstream fan-out, so an unbounded one would be
// reflected output and retained memory for no benefit — every symbol this app
// produces (`tickersFor`, in `yahoo-ticker.ts`) is already ticker-shaped.
const TICKER_SHAPE = /^[A-Za-z0-9.=^-]{1,20}$/;

/**
 * Validates the `symbols` array both routes take.
 *
 * Extracted rather than duplicated: the two routes carried byte-identical
 * copies of these checks, including the ticker pattern, which is exactly the
 * kind of thing that drifts silently. `noun` only varies the error wording
 * ("quote" vs "chart"), which is the sole difference the copies actually had.
 *
 * `maxSymbols` defaults to `MAX_SYMBOLS` but lets the history route pass its
 * own, lower `MAX_HISTORY_SYMBOLS` — the two routes' amplification differs by
 * two orders of magnitude, so they don't share one ceiling.
 */
export function readRequestSymbols(
	symbols: unknown,
	noun: string,
	maxSymbols: number = MAX_SYMBOLS,
): PriceRequestSymbol[] {
	if (!Array.isArray(symbols)) {
		throw new Error("Expected a JSON body with a `symbols` array.");
	}
	if (symbols.length === 0) {
		throw new Error(`No symbols to ${noun}.`);
	}
	if (symbols.length > maxSymbols) {
		throw new Error(`At most ${maxSymbols} symbols per request.`);
	}

	return symbols.map((entry) => {
		const symbol = stringOrNull(entry?.symbol)?.trim();
		const ticker = stringOrNull(entry?.ticker)?.trim();
		if (!symbol || !ticker) {
			throw new Error("Every entry needs a `symbol` and a `ticker`.");
		}
		if (!TICKER_SHAPE.test(ticker)) {
			throw new Error(`"${ticker}" isn't a ticker.`);
		}
		if (!TICKER_SHAPE.test(symbol)) {
			throw new Error(`"${symbol}" isn't a symbol.`);
		}
		return { symbol, ticker };
	});
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function guard(symbols: PriceRequestSymbol[]): void {
	if (symbols.length === 0) {
		throw new LivePriceError("There are no holdings to price.");
	}
	if (symbols.length > MAX_SYMBOLS) {
		throw new LivePriceError(
			`That's ${symbols.length} symbols; these routes price at most ${MAX_SYMBOLS} at a time.`,
		);
	}
}

async function post<T>(endpoint: string, body: unknown): Promise<T> {
	let response: Response;
	try {
		response = await fetch(endpoint, {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
	} catch {
		throw new LivePriceError(
			"Couldn't reach the price route. Is the app still running?",
		);
	}

	const parsed: unknown = await response.json().catch(() => null);

	if (!response.ok) {
		const message =
			parsed && typeof parsed === "object" && "error" in parsed
				? String((parsed as LivePriceErrorBody).error)
				: `The price route answered ${response.status}.`;
		throw new LivePriceError(message);
	}

	return parsed as T;
}
