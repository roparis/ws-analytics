import { describe, expect, it } from "vitest";
import { resolveDateFrom } from "@/lib/date-range";

describe("resolveDateFrom", () => {
	it("returns null for 'all' or an empty dataset", () => {
		expect(resolveDateFrom("all", "2026-05-31")).toBeNull();
		expect(resolveDateFrom("3m", "")).toBeNull();
	});

	// Characterization pins: `ytd` returns early via pure string arithmetic and
	// was already correct before this file existed. Not touched by the fix
	// below — these two cases prove the move preserved that.
	it("resolves ytd to January 1st of the dataset's own year", () => {
		expect(resolveDateFrom("ytd", "2026-05-31")).toBe("2026-01-01");
		expect(resolveDateFrom("ytd", "2026-01-01")).toBe("2026-01-01");
	});

	// The flagship cases. These fail in *every* timezone, including a UTC box:
	// the `setMonth` overflow from a month-end date is not a timezone bug.
	// Today's code gives 2026-03-03 for the first two, and 2023-03-01 for the
	// third.
	it("steps back 3 months from a month end without overflowing", () => {
		expect(resolveDateFrom("3m", "2026-05-31")).toBe("2026-02-28");
	});

	it("steps back 6 months from a month end without overflowing", () => {
		expect(resolveDateFrom("6m", "2026-08-31")).toBe("2026-02-28");
	});

	it("steps back 12 months from a leap day, clamped", () => {
		// A leap day moves by two days here, not one: Feb 29 2024 minus 12 months
		// has no Feb 29 to land on, so it clamps to Feb 28 2023.
		expect(resolveDateFrom("12m", "2024-02-29")).toBe("2023-02-28");
	});

	it("steps back 30 days, including across a month and year boundary", () => {
		expect(resolveDateFrom("30d", "2026-05-31")).toBe("2026-05-01");
		expect(resolveDateFrom("30d", "2026-01-15")).toBe("2025-12-16");
	});
});

// A pinned America/Toronto suite (see vitest.config.mts) reproduces the
// west-of-Greenwich half of bug 5 — the local-midnight-parsed-as-UTC skew —
// but not the east-of-Greenwich half, since that requires a positive UTC
// offset the pin doesn't provide. That half isn't tested directly here: it
// is eliminated structurally, because the fixed resolveDateFrom constructs
// no Date at all, so there is no clock read left to be in the wrong
// timezone. Its observable effect is subsumed by the clamp cases above.
