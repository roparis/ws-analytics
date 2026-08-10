import { describe, expect, it } from "vitest";
import { marketMonth } from "@/lib/market-month";

/**
 * Every timestamp below was taken from a real `chart(…, { interval: "1mo" })`
 * response, not invented. That matters: the whole bug was a wrong assumption
 * about where Yahoo puts a bar, and a fixture built from the same assumption
 * would have agreed with it.
 */

describe("marketMonth", () => {
	describe("a London-quoted series, which is where this broke", () => {
		// USDCAD=X, exchangeTimezoneName "Europe/London". Midnight BST is 23:00
		// UTC the day before; midnight GMT is 00:00 UTC on the day itself.
		const LONDON = "Europe/London";

		it("reads a summer bar as the month it opens, not the evening before", () => {
			expect(marketMonth(new Date("2022-09-30T23:00:00Z"), LONDON)).toBe(
				"2022-10",
			);
			expect(marketMonth(new Date("2022-08-31T23:00:00Z"), LONDON)).toBe(
				"2022-09",
			);
			expect(marketMonth(new Date("2022-07-31T23:00:00Z"), LONDON)).toBe(
				"2022-08",
			);
		});

		it("reads a winter bar, stamped an hour later, as the same kind of month", () => {
			expect(marketMonth(new Date("2022-11-01T00:00:00Z"), LONDON)).toBe(
				"2022-11",
			);
			expect(marketMonth(new Date("2022-12-01T00:00:00Z"), LONDON)).toBe(
				"2022-12",
			);
		});

		it("gives consecutive bars distinct months across the DST change", () => {
			// The regression that matters. Reading these in UTC produced
			// 2022-07, -08, -09, -11, -12: three months holding the next month's
			// close, and October gone entirely.
			const bars = [
				"2022-07-31T23:00:00Z",
				"2022-08-31T23:00:00Z",
				"2022-09-30T23:00:00Z",
				"2022-11-01T00:00:00Z",
				"2022-12-01T00:00:00Z",
			].map((iso) => marketMonth(new Date(iso), LONDON));

			expect(bars).toEqual([
				"2022-08",
				"2022-09",
				"2022-10",
				"2022-11",
				"2022-12",
			]);
			expect(new Set(bars).size).toBe(bars.length);
		});
	});

	describe("the western and neutral exchanges, which were never wrong", () => {
		it("keeps a Toronto bar on its own month, either side of DST", () => {
			// VFV.TO: 04:00 UTC on EDT, 05:00 on EST.
			expect(
				marketMonth(new Date("2022-10-01T04:00:00Z"), "America/Toronto"),
			).toBe("2022-10");
			expect(
				marketMonth(new Date("2022-12-01T05:00:00Z"), "America/Toronto"),
			).toBe("2022-12");
		});

		it("keeps a New York bar on its own month", () => {
			expect(
				marketMonth(new Date("2022-10-01T04:00:00Z"), "America/New_York"),
			).toBe("2022-10");
		});

		it("keeps a UTC-quoted bar — crypto — on its own month", () => {
			expect(marketMonth(new Date("2022-10-01T00:00:00Z"), "UTC")).toBe(
				"2022-10",
			);
		});
	});

	describe("without a usable timezone", () => {
		it("still lands an eastern bar in the month it opens", () => {
			// The fallback carries the same series the London case does.
			expect(marketMonth(new Date("2022-09-30T23:00:00Z"))).toBe("2022-10");
			expect(marketMonth(new Date("2022-09-30T23:00:00Z"), null)).toBe(
				"2022-10",
			);
		});

		it("holds for the furthest zones either side of Greenwich", () => {
			// Midnight on 1 October in UTC+14 is 10:00 on 30 September; in UTC-12
			// it is noon on 1 October. Both are October.
			expect(marketMonth(new Date("2022-09-30T10:00:00Z"))).toBe("2022-10");
			expect(marketMonth(new Date("2022-10-01T12:00:00Z"))).toBe("2022-10");
		});

		it("falls back rather than throwing on a timezone it doesn't know", () => {
			expect(
				marketMonth(new Date("2022-10-01T04:00:00Z"), "Mars/Olympus"),
			).toBe("2022-10");
		});

		it("crosses a year end without losing the year", () => {
			expect(marketMonth(new Date("2022-12-31T15:00:00Z"))).toBe("2023-01");
		});
	});

	it("rolls the year over for an eastern exchange, where a year end does shift", () => {
		// Midnight on 1 January in Tokyo is 15:00 on 31 December in UTC — the same
		// shift as the London summer, landing on a year boundary. London itself is
		// back on GMT by December, which is why the year-end closes that drive the
		// analytics page came out right even while the summer months were wrong.
		expect(marketMonth(new Date("2022-12-31T15:00:00Z"), "Asia/Tokyo")).toBe(
			"2023-01",
		);
		expect(marketMonth(new Date("2023-01-01T00:00:00Z"), "Europe/London")).toBe(
			"2023-01",
		);
	});

	it("refuses an invalid date rather than keying on NaN", () => {
		expect(() => marketMonth(new Date("not a date"))).toThrow(RangeError);
	});
});
