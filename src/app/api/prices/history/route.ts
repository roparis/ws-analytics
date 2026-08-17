import YahooFinance from "yahoo-finance2";
import {
	type LivePriceMiss,
	MAX_HISTORY_SYMBOLS,
	type PriceHistoryRequest,
	type PriceHistoryResponse,
	type PriceHistorySeries,
	type PriceRequestSymbol,
	readRequestSymbols,
} from "@/lib/live-prices";
import { marketMonth } from "@/lib/market-month";
import { USD_CAD_TICKER } from "@/lib/yahoo-ticker";

/**
 * Monthly closing prices for a list of tickers, in CAD.
 *
 * The sibling route answers "what is this worth now". This one answers "what
 * was it worth at the end of 2023", which the analytics page needs for every
 * year the export covers and which no quote can supply.
 *
 * Monthly bars rather than daily: a year-end figure needs twelve numbers a
 * year, not two hundred and fifty, and Yahoo's `1mo` bar closes on the last
 * trading day of the month — exactly the date a year-end valuation wants.
 */

const yahooFinance = new YahooFinance({
	suppressNotices: ["yahooSurvey"],
	validation: { logErrors: false },
	// Yahoo's chart endpoint takes one symbol per request, so a 40-holding
	// portfolio is 40 requests. The library's default concurrency of 4 is a
	// reasonable neighbour; raising it is how an unofficial API starts refusing.
	queue: { concurrency: 4 },
});

export async function POST(request: Request): Promise<Response> {
	// The only legitimate caller is this app's own browser code, posting JSON to
	// a relative same-origin path. A browser attaches both headers checked here
	// automatically, so this costs the real client nothing. `Sec-Fetch-Site` is
	// rejected only when it is present and says otherwise — absent means a
	// non-browser caller (the `curl` examples in `docs/yahoo-pricing-poc.md`
	// §7), which this does not reject.
	const secFetchSite = request.headers.get("sec-fetch-site");
	if (secFetchSite && secFetchSite !== "same-origin") {
		return fail("Cross-site requests aren't accepted.", 403);
	}
	if (
		!(request.headers.get("content-type") ?? "").includes("application/json")
	) {
		return fail("Expected a JSON body.", 403);
	}

	let input: { symbols: PriceRequestSymbol[]; from: string; to: string };
	try {
		input = readRequest(await request.json());
	} catch (error) {
		return fail(error instanceof Error ? error.message : "Bad request.", 400);
	}

	try {
		const series: PriceHistorySeries[] = [];
		const misses: LivePriceMiss[] = [];

		// One symbol may be held in several accounts but is one instrument, and
		// the caller already deduplicates; this guards the route's own N.
		const seen = new Set<string>();

		const fetched = await Promise.all(
			input.symbols
				.filter((entry) => !seen.has(entry.ticker) && seen.add(entry.ticker))
				.map(async (entry) => ({
					entry,
					result: await monthlyCloses(entry.ticker, input.from, input.to),
				})),
		);

		// The FX series is only worth a request if something is actually quoted in
		// US dollars, and that isn't knowable until the charts come back.
		const needsFx = fetched.some(
			(one) => one.result.kind === "ok" && one.result.currency === "USD",
		);
		const usdCadByMonth = needsFx
			? await monthlyCloses(USD_CAD_TICKER, input.from, input.to)
			: null;

		for (const { entry, result } of fetched) {
			if (result.kind === "miss") {
				misses.push({ ...entry, reason: result.reason });
				continue;
			}

			if (result.currency !== "CAD" && result.currency !== "USD") {
				misses.push({
					...entry,
					reason: `${entry.ticker} is quoted in ${result.currency || "an unknown currency"}, which this route can't convert to CAD.`,
				});
				continue;
			}

			// One auxiliary ticker failing is no reason to throw away forty chart
			// requests that worked — a portfolio that is almost entirely TSX-listed
			// needed that rate for nothing. So a US-quoted symbol with no FX series
			// is a miss here for exactly the reason an unconvertible currency is a
			// miss one branch up: this route can't state it in CAD, and the rest of
			// the response is still true.
			if (result.currency === "USD" && usdCadByMonth?.kind !== "ok") {
				misses.push({
					...entry,
					reason: `${entry.ticker} is quoted in USD, and no USD→CAD history came back to convert it with.`,
				});
				continue;
			}

			const monthlyCad: Record<string, number> = {};
			for (const [month, close] of Object.entries(result.closes)) {
				if (result.currency === "CAD") {
					monthlyCad[month] = round(close);
					continue;
				}

				// Each month converts at *its own* close, not today's rate. Using one
				// rate across four years would restate every past year in terms of
				// where the dollar happens to sit this morning.
				const rate =
					usdCadByMonth?.kind === "ok" && usdCadByMonth.closes[month];
				if (!rate) continue;
				monthlyCad[month] = round(close * rate);
			}

			if (Object.keys(monthlyCad).length === 0) {
				misses.push({
					...entry,
					reason: `Yahoo has no usable history for ${entry.ticker} over this period.`,
				});
				continue;
			}

			series.push({ ...entry, currency: result.currency, monthlyCad });
		}

		const body: PriceHistoryResponse = {
			fetchedAt: new Date().toISOString(),
			misses,
			series,
			usdCadByMonth:
				usdCadByMonth?.kind === "ok" ? roundAll(usdCadByMonth.closes) : {},
		};

		return Response.json(body, { headers: { "cache-control": "no-store" } });
	} catch (error) {
		// Log the error's class and a symbol count, not `error.message` or the
		// symbols themselves — that message is Yahoo's raw response body, which is
		// not something to relay to an unauthenticated caller.
		console.warn(
			"Yahoo Finance history failed:",
			error instanceof Error ? error.constructor.name : typeof error,
			`for ${input.symbols.length} symbols`,
		);
		return fail("Yahoo Finance didn't answer. Try again in a moment.", 502);
	}
}

type ChartResult =
	| { kind: "ok"; currency: string; closes: Record<string, number> }
	| { kind: "miss"; reason: string };

/**
 * One ticker's monthly closes, keyed `YYYY-MM`.
 *
 * A symbol Yahoo doesn't know throws rather than returning empty, which is why
 * this catches per symbol: one delisted ticker should cost its own row, not the
 * whole page's history.
 */
async function monthlyCloses(
	ticker: string,
	from: string,
	to: string,
): Promise<ChartResult> {
	try {
		const chart = await yahooFinance.chart(ticker, {
			interval: "1mo",
			period1: from,
			period2: to,
		});

		// The exchange's own timezone, straight from the response that carried the
		// bars — see `marketMonth` for why reading them in UTC silently shifts a
		// London-quoted series by a month for half the year.
		const timeZone =
			typeof chart.meta.exchangeTimezoneName === "string"
				? chart.meta.exchangeTimezoneName
				: null;

		const closes: Record<string, number> = {};
		for (const bar of chart.quotes) {
			if (bar.close === null || !Number.isFinite(bar.close)) continue;
			closes[marketMonth(bar.date, timeZone)] = bar.close;
		}

		if (Object.keys(closes).length === 0) {
			return { kind: "miss", reason: `Yahoo has no history for ${ticker}.` };
		}

		return {
			closes,
			currency: String(chart.meta.currency ?? "").toUpperCase(),
			kind: "ok",
		};
	} catch {
		// Not `error.message`: it's Yahoo's raw response body, and this reason
		// ships in a 200. The ticker is already known here, which is the useful
		// part — `historyFromResponse` discards `reason` anyway.
		return { kind: "miss", reason: `Yahoo couldn't chart ${ticker}.` };
	}
}

function readRequest(body: unknown): {
	symbols: PriceRequestSymbol[];
	from: string;
	to: string;
} {
	const input = body as PriceHistoryRequest | null;
	const symbols = readRequestSymbols(
		input?.symbols,
		"chart",
		MAX_HISTORY_SYMBOLS,
	);

	const from = isoDate(input?.from);
	const to = isoDate(input?.to);
	if (!from || !to) {
		throw new Error("`from` and `to` must be `YYYY-MM-DD` dates.");
	}
	if (from > to) {
		throw new Error("`from` is after `to`.");
	}

	return { from, symbols, to };
}

function isoDate(value: unknown): string | null {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
		? value
		: null;
}

function round(value: number): number {
	return Math.round(value * 10_000) / 10_000;
}

function roundAll(values: Record<string, number>): Record<string, number> {
	return Object.fromEntries(
		Object.entries(values).map(([key, value]) => [key, round(value)]),
	);
}

function fail(error: string, status: number): Response {
	return Response.json({ error }, { status });
}
