import YahooFinance from "yahoo-finance2";
import {
	type LivePriceMiss,
	type LivePriceQuote,
	type LivePriceResponse,
	type PriceRequestSymbol,
	readRequestSymbols,
} from "@/lib/live-prices";
import { USD_CAD_TICKER } from "@/lib/yahoo-ticker";

/**
 * Quotes a list of tickers, in CAD.
 *
 * The only server-side code in this app, and it exists because Yahoo's
 * endpoints can't be called from a page: no CORS headers, and a cookie and
 * crumb are required before the first quote. See `src/lib/live-prices.ts` for
 * what that means for privacy — in short, this route receives ticker symbols
 * and nothing else.
 *
 * POST rather than GET, so the ticker list stays out of the URL and out of
 * whatever logs sit in front of a deployment.
 */

/**
 * One client for the process, not one per request.
 *
 * `yahoo-finance2` fetches a consent cookie and a crumb before its first quote
 * and reuses them from an in-memory jar. A fresh client per request would pay
 * that handshake every time — roughly a second, before Yahoo starts counting
 * the requests against us.
 */
const yahooFinance = new YahooFinance({
	// A one-off console notice about a Yahoo survey, on a route whose logs are
	// meant to be quiet.
	suppressNotices: ["yahooSurvey"],
	validation: {
		// Fields Yahoo adds are already tolerated by default; this only turns off
		// the multi-screen dump the library prints when a *known* field changes
		// type. That case still throws, and the catch below turns it into a 502 the
		// page can show — which is the report worth having.
		logErrors: false,
	},
});

export async function POST(request: Request): Promise<Response> {
	let symbols: PriceRequestSymbol[];
	try {
		symbols = readRequestSymbols((await request.json())?.symbols, "quote");
	} catch (error) {
		return fail(error instanceof Error ? error.message : "Bad request.", 400);
	}

	try {
		// The FX pair rides along in the same request rather than costing a second
		// round trip on the chance that something is US-listed.
		const tickers = [...new Set(symbols.map((entry) => entry.ticker))];
		const quotes = await yahooFinance.quote([...tickers, USD_CAD_TICKER]);

		const byTicker = new Map(
			quotes.map((quote) => [String(quote.symbol).toUpperCase(), quote]),
		);

		const usdCad = readNumber(byTicker.get(USD_CAD_TICKER)?.regularMarketPrice);
		const priced: LivePriceQuote[] = [];
		const misses: LivePriceMiss[] = [];

		for (const entry of symbols) {
			const quote = byTicker.get(entry.ticker.toUpperCase());

			// Yahoo drops symbols it doesn't know rather than answering with an
			// error, so an absent row is the "no such ticker" case.
			if (!quote) {
				misses.push({
					...entry,
					reason: `Yahoo doesn't quote ${entry.ticker}.`,
				});
				continue;
			}

			const nativePrice = readNumber(quote.regularMarketPrice);
			if (nativePrice === null || nativePrice <= 0) {
				misses.push({
					...entry,
					reason: `Yahoo knows ${entry.ticker} but quoted no price for it.`,
				});
				continue;
			}

			const currency = String(quote.currency ?? "").toUpperCase();
			const rate = conversionTo(currency, usdCad);
			if (rate === null) {
				misses.push({
					...entry,
					reason: currency
						? `${entry.ticker} is quoted in ${currency}, which this route can't convert to CAD.`
						: `Yahoo didn't say what currency ${entry.ticker} is quoted in.`,
				});
				continue;
			}

			priced.push({
				...entry,
				currency,
				marketState: stringOrNull(quote.marketState),
				name: stringOrNull(quote.shortName ?? quote.longName),
				nativePrice,
				// Rounded to the cent: a converted price carries more decimals than
				// a price means, and the share count it multiplies is exact.
				priceCad: Math.round(nativePrice * rate * 100) / 100,
				quotedAt: isoOrNull(quote.regularMarketTime),
			});
		}

		const body: LivePriceResponse = {
			fetchedAt: new Date().toISOString(),
			misses,
			quotes: priced,
			usdCad: priced.some((quote) => quote.currency !== "CAD") ? usdCad : null,
		};

		// Never cached: the entire point of the route is that the answer changed
		// since last time.
		return Response.json(body, {
			headers: { "cache-control": "no-store" },
		});
	} catch (error) {
		// Yahoo being down, rate-limiting, or changing its handshake are all
		// normal operating conditions for an unofficial API. Say so plainly rather
		// than leaving the page with a spinner and a stale snapshot.
		console.warn("Yahoo Finance quote failed:", error);
		return fail(
			`Yahoo Finance didn't answer: ${
				error instanceof Error ? error.message : "unknown error"
			}`,
			502,
		);
	}
}

/**
 * CAD needs no conversion; USD needs the pair. Anything else — a London or
 * Frankfurt listing — is refused rather than guessed at, which is why this
 * returns null instead of falling back to 1.
 */
function conversionTo(currency: string, usdCad: number | null): number | null {
	if (currency === "CAD") return 1;
	if (currency === "USD") return usdCad;
	return null;
}

function fail(error: string, status: number): Response {
	return Response.json({ error }, { status });
}

function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function isoOrNull(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "number") return new Date(value * 1000).toISOString();
	return null;
}
