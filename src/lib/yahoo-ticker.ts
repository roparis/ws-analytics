import type { Position } from "@/lib/positions";

/**
 * Yahoo's symbol for a holding — the same guess `googleTickerGuess` makes, in
 * a different dialect.
 *
 * The two exchanges' conventions diverge in exactly the places you'd expect a
 * ticker to be unambiguous:
 *
 * - Google prefixes the exchange (`TSE:VFV`), Yahoo suffixes it (`VFV.TO`).
 * - Google keeps the export's dot for class shares (`CTC.A`), Yahoo hyphenates
 *   it (`CTC-A.TO`, `BRK-B`) because the dot is already spoken for by the
 *   exchange suffix.
 * - Google prices spot crypto through a currency pair (`CURRENCY:BTCCAD`),
 *   Yahoo lists it as its own instrument (`BTC-CAD`).
 *
 * US-listed symbols resolve bare, so nothing is added rather than guessing
 * between NYSE, NASDAQ and NYSEARCA — the same call `googleTickerGuess` makes,
 * for the same reason.
 *
 * This is a guess and stays a guess. A ticker Yahoo doesn't recognise comes
 * back unpriced rather than wrong, and the holding falls through to book cost.
 */
export function yahooTickerGuess(
	position: Pick<Position, "symbol" | "listing">,
): string {
	const symbol = position.symbol.trim().toUpperCase();

	switch (position.listing) {
		case "ca":
			return `${hyphenateClass(symbol)}.TO`;
		case "crypto":
			// Asking for the CAD pair directly saves converting through USD, and
			// spares us the rounding of two conversions on a volatile price.
			return `${symbol}-CAD`;
		default:
			return hyphenateClass(symbol);
	}
}

/** `CTC.A` -> `CTC-A`. Leaves everything else alone. */
function hyphenateClass(symbol: string): string {
	return symbol.replaceAll(".", "-");
}

/**
 * Yahoo quotes currencies as instruments too. This one reads "one US dollar,
 * priced in Canadian dollars" — the multiplier for a US-listed holding.
 */
export const USD_CAD_TICKER = "USDCAD=X";

/**
 * The distinct symbols worth quoting, with the ticker to quote each one under.
 *
 * A symbol held in three accounts is one quote: prices are a property of the
 * instrument, not of the account holding it, and the snapshot is keyed by
 * symbol for exactly that reason.
 */
export function tickersFor(
	positions: Pick<Position, "symbol" | "listing">[],
): { symbol: string; ticker: string }[] {
	const bySymbol = new Map<string, string>();

	for (const position of positions) {
		if (!position.symbol) continue;
		if (bySymbol.has(position.symbol)) continue;
		bySymbol.set(position.symbol, yahooTickerGuess(position));
	}

	return [...bySymbol]
		.map(([symbol, ticker]) => ({ symbol, ticker }))
		.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
