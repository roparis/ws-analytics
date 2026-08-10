/**
 * Which month a monthly price bar belongs to.
 *
 * Yahoo stamps a `1mo` bar at **midnight on the first, in the exchange's own
 * timezone**, and hands it over as an instant. Read that instant in UTC and any
 * market east of Greenwich files its bar under the month before:
 *
 * ```
 * USDCAD=X trades on Europe/London
 *   2022-09-30T23:00:00Z  ← this is October, at midnight BST
 *   2022-11-01T00:00:00Z  ← this is November, at midnight GMT
 * ```
 *
 * Getting that wrong is not a missing month, which would be obvious. It is a
 * *shifted* one: October's rate lands on September's key and overwrites the
 * real September rate, so every summer month reads one month early and only
 * the last bar of the run disappears. Every figure built on those keys is
 * quietly wrong by a month, and nothing about it looks broken.
 *
 * The exchange's timezone comes back in the chart's own metadata, so the month
 * is read in the timezone the bar was stamped in — no guessing, and correct
 * across daylight saving, which is exactly where the shift moves.
 */

/**
 * `Intl.DateTimeFormat` construction is the expensive part, and a portfolio of
 * forty holdings asks for the same handful of timezones a few thousand times.
 */
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
	const cached = formatters.get(timeZone);
	if (cached !== undefined) return cached;

	let formatter: Intl.DateTimeFormat | null = null;
	try {
		formatter = new Intl.DateTimeFormat("en-US", {
			month: "2-digit",
			timeZone,
			year: "numeric",
		});
	} catch {
		// An unknown zone throws rather than falling back to UTC, and a zone Yahoo
		// invents tomorrow shouldn't take the page's history with it.
		formatter = null;
	}

	formatters.set(timeZone, formatter);
	return formatter;
}

/**
 * The bar's month as `YYYY-MM`.
 *
 * `exchangeTimezoneName` from `chart.meta`; anything falsy or unrecognised
 * falls through to the boundary rule below.
 */
export function marketMonth(
	date: Date,
	exchangeTimezone?: string | null,
): string {
	if (Number.isNaN(date.getTime())) {
		throw new RangeError("marketMonth was given an invalid date");
	}

	const formatter = exchangeTimezone ? formatterFor(exchangeTimezone) : null;
	if (formatter) {
		// `formatToParts` rather than `format`: assembling the key from named
		// parts can't be broken by a locale that decides to write the month first.
		const parts = formatter.formatToParts(date);
		const year = parts.find((part) => part.type === "year")?.value;
		const month = parts.find((part) => part.type === "month")?.value;
		if (year && month) return `${year}-${month}`;
	}

	return snapToBoundary(date);
}

/**
 * Without a timezone, the boundary itself is the evidence.
 *
 * A bar stamped at midnight local sits within one day of the UTC month it
 * belongs to — at most fourteen hours early for the furthest zone east, at most
 * twelve hours late for the furthest west. Adding a day lands every one of them
 * inside its own month, and cannot reach the next: the latest a monthly bar is
 * ever stamped is the first trading day, and a month's first trading day is
 * never its 31st.
 */
function snapToBoundary(date: Date): string {
	return new Date(date.getTime() + 86_400_000).toISOString().slice(0, 7);
}
