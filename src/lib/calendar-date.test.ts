import { describe, expect, it } from "vitest";
import {
	addDays,
	addMonths,
	daysBetween,
	toLocalIso,
	todayLocalIso,
} from "@/lib/calendar-date";

describe("toLocalIso", () => {
	it("reads the local date, not the UTC one", () => {
		// `toISOString().slice(0, 10)` on this moment gives 2026-08-08 anywhere
		// west of Greenwich, which would put tomorrow's date on tonight's export.
		const evening = new Date(2026, 7, 7, 22, 30);
		expect(toLocalIso(evening)).toBe("2026-08-07");
	});

	it("zero-pads month and day", () => {
		expect(toLocalIso(new Date(2026, 0, 1))).toBe("2026-01-01");
	});

	it("gets a year boundary right", () => {
		// A UTC slice of this moment gives 2027-01-01 anywhere west of Greenwich
		// — the worst version of this bug, since it also rolls the year.
		expect(toLocalIso(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
	});
});

describe("todayLocalIso", () => {
	it("equals toLocalIso(now) for an explicit now", () => {
		const now = new Date(2026, 7, 7, 22, 30);
		expect(todayLocalIso(now)).toBe(toLocalIso(now));
	});

	it("defaults to today's date with no argument", () => {
		expect(todayLocalIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe("addDays", () => {
	it("subtracts across a month boundary", () => {
		expect(addDays("2026-05-31", -30)).toBe("2026-05-01");
	});

	it("subtracts across a non-leap and a leap February", () => {
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
		expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
	});

	it("adds across a year boundary, and zero is a no-op", () => {
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDays("2026-08-07", 0)).toBe("2026-08-07");
	});

	it("crosses DST boundaries in the pinned zone without drift", () => {
		// These only have teeth because of the vitest.config.mts TZ pin — a naive
		// local `setDate` is what gets the spring-forward/fall-back hour wrong.
		expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
		expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
	});
});

describe("addMonths", () => {
	it("clamps a month-end date instead of overflowing", () => {
		// Today's code (`setMonth` on a `Date`) gives 2026-03-03.
		expect(addMonths("2026-05-31", -3)).toBe("2026-02-28");
	});

	it("clamps to a leap February", () => {
		expect(addMonths("2024-05-31", -3)).toBe("2024-02-29");
	});

	it("clamps 31 -> 30 across a year cross", () => {
		expect(addMonths("2026-05-31", -6)).toBe("2025-11-30");
	});

	it("needs no clamp when the target month is as long", () => {
		expect(addMonths("2026-05-31", -12)).toBe("2025-05-31");
	});

	it("clamps forward too", () => {
		expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
	});

	it("underflows the year correctly", () => {
		expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
	});
});

describe("daysBetween", () => {
	it("counts whole days forward, same-day, and backward", () => {
		expect(daysBetween("2026-08-01", "2026-08-09")).toBe(8);
		expect(daysBetween("2026-08-01", "2026-08-01")).toBe(0);
		expect(daysBetween("2026-08-09", "2026-08-01")).toBe(-8);
	});

	it("is exact across the fall-back DST boundary", () => {
		// Proves the answer is exact rather than a value that happened to round.
		expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
	});
});
