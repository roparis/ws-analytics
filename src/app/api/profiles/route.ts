import YahooFinance from "yahoo-finance2";
import {
	type LivePriceMiss,
	MAX_PROFILE_SYMBOLS,
	type PriceRequestSymbol,
	type ProfileKind,
	type ProfileRequest,
	type ProfileResponse,
	readRequestSymbols,
	type SecurityProfileResult,
} from "@/lib/live-prices";

/**
 * What each ticker actually *is* — sector, industry, or a fund's mix of both.
 *
 * The two sibling routes answer "worth now" and "worth then". This one answers
 * a question no quote or chart can: a `VFV.TO` and a `SHOP.TO` quote the same
 * way, but one is 500 companies and the other is one — the export has no
 * security metadata to tell them apart (`docs/wealthsimple-csv-format.md` §8).
 *
 * Same amplification as the history route — Yahoo's `quoteSummary` takes one
 * ticker per call — so it inherits the same concurrency ceiling for the same
 * reason: raising it is how an unofficial API starts refusing.
 */

const yahooFinance = new YahooFinance({
	suppressNotices: ["yahooSurvey"],
	validation: { logErrors: false },
	queue: { concurrency: 4 },
});

export async function POST(request: Request): Promise<Response> {
	// Same guards as the sibling routes, for the same reason — see
	// `api/prices/history/route.ts` for the reasoning this mirrors verbatim.
	const secFetchSite = request.headers.get("sec-fetch-site");
	if (secFetchSite && secFetchSite !== "same-origin") {
		return fail("Cross-site requests aren't accepted.", 403);
	}
	if (
		!(request.headers.get("content-type") ?? "").includes("application/json")
	) {
		return fail("Expected a JSON body.", 403);
	}

	let symbols: PriceRequestSymbol[];
	try {
		symbols = readRequest(await request.json());
	} catch (error) {
		return fail(error instanceof Error ? error.message : "Bad request.", 400);
	}

	try {
		const profiles: SecurityProfileResult[] = [];
		const misses: LivePriceMiss[] = [];

		// Grouped by ticker rather than deduplicated down to one entry per
		// ticker: two distinct symbols can share a ticker (`CTC.A` and `CTC-A`
		// both hyphenate to `CTC-A.TO` via `yahooTickerGuess`), and a naive
		// dedup that kept only the first would silently drop the second from
		// both `profiles` and `misses` — a symbol asked for that never comes
		// back. Grouping still costs one upstream call per unique ticker; every
		// symbol in the group just gets a copy of that one result.
		const byTicker = new Map<string, PriceRequestSymbol[]>();
		for (const entry of symbols) {
			const group = byTicker.get(entry.ticker);
			if (group) group.push(entry);
			else byTicker.set(entry.ticker, [entry]);
		}

		const fetched = await Promise.all(
			[...byTicker.entries()].map(async ([ticker, entries]) => ({
				entries,
				result: await profileFor(ticker),
			})),
		);

		for (const { entries, result } of fetched) {
			for (const entry of entries) {
				if (result.kind === "miss") {
					misses.push({ ...entry, reason: result.reason });
					continue;
				}
				profiles.push({ ...entry, ...result.profile });
			}
		}

		const body: ProfileResponse = {
			fetchedAt: new Date().toISOString(),
			misses,
			profiles,
		};

		return Response.json(body, { headers: { "cache-control": "no-store" } });
	} catch (error) {
		// Log the error's class and a symbol count, not `error.message` or the
		// symbols themselves — that message is Yahoo's raw response body, which
		// isn't something to relay to an unauthenticated caller.
		console.warn(
			"Yahoo Finance profile lookup failed:",
			error instanceof Error ? error.constructor.name : typeof error,
			`for ${symbols.length} symbols`,
		);
		return fail("Yahoo Finance didn't answer. Try again in a moment.", 502);
	}
}

type ProfileResult =
	| { kind: "ok"; profile: Omit<SecurityProfileResult, "symbol" | "ticker"> }
	| { kind: "miss"; reason: string };

/**
 * One ticker's classification.
 *
 * A symbol Yahoo doesn't know throws rather than returning empty, which is why
 * this catches per symbol — one delisted or mistyped ticker should cost its
 * own row, not the whole response, exactly as in the history route.
 */
async function profileFor(ticker: string): Promise<ProfileResult> {
	try {
		const result = await yahooFinance.quoteSummary(ticker, {
			modules: ["quoteType", "assetProfile", "fundProfile", "topHoldings"],
		});

		const kind = classify(result.quoteType?.quoteType);
		const holdings = result.topHoldings;

		return {
			kind: "ok",
			profile: {
				bondPosition: numberOrNull(holdings?.bondPosition),
				cashPosition: numberOrNull(holdings?.cashPosition),
				categoryName: result.fundProfile?.categoryName ?? null,
				family: result.fundProfile?.family ?? null,
				industry: result.assetProfile?.industry ?? null,
				kind,
				otherPosition: numberOrNull(holdings?.otherPosition),
				sector: result.assetProfile?.sector ?? null,
				sectorKey: normalizeSectorKey(result.assetProfile?.sectorKey),
				// Yahoo ships this as an array of single-key objects —
				// `[{ technology: 0.3861 }, { energy: 0.0298 }, ...]` — rather than one
				// object. Flattened here so every downstream reader gets a plain map
				// instead of relearning that shape.
				sectorWeights: flattenSectorWeights(holdings?.sectorWeightings),
				stockPosition: numberOrNull(holdings?.stockPosition),
			},
		};
	} catch {
		// Not `error.message`: it's Yahoo's raw response body, and this reason
		// ships in a 200. The ticker is already known here, which is the useful
		// part. Deliberately the weaker claim — "couldn't classify" rather than
		// "doesn't recognize" — because this branch also catches a rate limit or
		// a network blip, not only a ticker Yahoo has genuinely never heard of;
		// the history route says the same weaker thing for the same reason.
		return { kind: "miss", reason: `Yahoo couldn't classify ${ticker}.` };
	}
}

/**
 * `assetProfile.sectorKey`'s hyphenated dialect, translated to the
 * underscored one `topHoldings.sectorWeightings` speaks — see the field
 * comment on `SecurityProfileResult.sectorKey` for why this has to exist.
 *
 * Every sector but one is a plain hyphen-to-underscore swap. Real estate is
 * the exception: Yahoo's weightings key is `realestate`, with no separator at
 * all, so that one case is named rather than derived.
 */
function normalizeSectorKey(sectorKey: string | undefined): string | null {
	if (!sectorKey) return null;
	if (sectorKey === "real-estate") return "realestate";
	return sectorKey.replaceAll("-", "_");
}

function classify(quoteType: string | undefined): ProfileKind {
	switch (quoteType) {
		case "EQUITY":
			return "equity";
		case "ETF":
		case "MUTUALFUND":
			return "fund";
		case "CRYPTOCURRENCY":
			return "crypto";
		default:
			return "other";
	}
}

function flattenSectorWeights(
	weightings: { [key: string]: unknown }[] | undefined,
): Record<string, number> | null {
	if (!weightings || weightings.length === 0) return null;

	const flat: Record<string, number> = {};
	for (const entry of weightings) {
		for (const [key, value] of Object.entries(entry)) {
			if (typeof value === "number" && Number.isFinite(value)) {
				flat[key] = value;
			}
		}
	}
	return Object.keys(flat).length > 0 ? flat : null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readRequest(body: unknown): PriceRequestSymbol[] {
	const input = body as ProfileRequest | null;
	return readRequestSymbols(input?.symbols, "profile", MAX_PROFILE_SYMBOLS);
}

function fail(error: string, status: number): Response {
	return Response.json({ error }, { status });
}
