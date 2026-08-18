import { describe, expect, it } from "vitest";
import {
	type ContributionPlan,
	contributionWeights,
	depletionYear,
	type ProjectionInputs,
	projectSeries,
	roomLimitYears,
	usablePlans,
} from "@/lib/projection";

/** Every rate off, so a test can turn on exactly the one it is about. */
function makeInputs(
	overrides: Partial<ProjectionInputs> = {},
): ProjectionInputs {
	return {
		years: 10,
		annualReturn: 0,
		monthlyContribution: 0,
		annualInflation: 0,
		withdrawalRate: 0,
		...overrides,
	};
}

/** An unlimited monthly plan, so a test can add only the limit it is about. */
function makePlan(overrides: Partial<ContributionPlan> = {}): ContributionPlan {
	return {
		amount: 0,
		frequency: "monthly",
		room: null,
		roomIncrease: 0,
		overflowTo: null,
		...overrides,
	};
}

/**
 * Fixed so the date labels are assertable rather than whatever today is, and
 * deliberately at a local *evening* — 21:00 in Toronto is already tomorrow in
 * UTC, so a fixture pinned to a UTC instant would agree with a UTC-derived
 * date in every timezone and prove nothing about the local calendar.
 */
const START = new Date(2026, 0, 15, 21, 0);
const AT = { startDate: START };

describe("contributionWeights", () => {
	it("splits in proportion to what each account type already holds", () => {
		expect(contributionWeights({ TFSA: 300, RRSP: 100 })).toEqual({
			TFSA: 0.75,
			RRSP: 0.25,
		});
	});

	it("splits evenly when there is no balance to weight by", () => {
		expect(contributionWeights({ TFSA: 0, RRSP: 0 })).toEqual({
			TFSA: 0.5,
			RRSP: 0.5,
		});
	});

	it("treats a negative balance as zero weight rather than a negative share", () => {
		// A margin account can legitimately sit below zero; contributing a
		// negative share of the monthly figure to it would be nonsense.
		expect(contributionWeights({ TFSA: 100, Margin: -50 })).toEqual({
			TFSA: 1,
			Margin: 0,
		});
	});

	it("returns nothing for no account types", () => {
		expect(contributionWeights({})).toEqual({});
	});
});

describe("projectSeries", () => {
	it("returns the starting balance untouched as year zero", () => {
		const points = projectSeries(
			{ TFSA: 1000, RRSP: 500 },
			makeInputs({ annualReturn: 0.07, monthlyContribution: 200 }),
			AT,
		);

		expect(points[0]).toMatchObject({
			year: 0,
			date: "2026-01-15",
			byType: { TFSA: 1000, RRSP: 500 },
			total: 1500,
			contributed: 1500,
			withdrawn: 0,
		});
	});

	it("samples one point per year, plus year zero", () => {
		const points = projectSeries({ TFSA: 1000 }, makeInputs({ years: 5 }), AT);

		expect(points).toHaveLength(6);
		expect(points.map((point) => point.year)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(points.map((point) => point.date)).toEqual([
			"2026-01-15",
			"2027-01-15",
			"2028-01-15",
			"2029-01-15",
			"2030-01-15",
			"2031-01-15",
		]);
	});

	it("compounds monthly to exactly the annual rate over a year", () => {
		// Twelve applications of (1 + r)^(1/12) must land on (1 + r), or the
		// figure on screen wouldn't be the rate the reader typed in.
		const points = projectSeries(
			{ TFSA: 1000 },
			makeInputs({ years: 1, annualReturn: 0.12 }),
			AT,
		);

		expect(points[1].total).toBeCloseTo(1120, 10);
	});

	it("adds up to the principal exactly when nothing grows", () => {
		const points = projectSeries(
			{ TFSA: 1000 },
			makeInputs({ years: 2, monthlyContribution: 100 }),
			AT,
		);

		expect(points[2].total).toBeCloseTo(3400, 10);
		expect(points[2].contributed).toBeCloseTo(3400, 10);
	});

	it("splits the monthly contribution by weight, not evenly", () => {
		const points = projectSeries(
			{ TFSA: 300, RRSP: 100 },
			makeInputs({ years: 1, monthlyContribution: 100 }),
			AT,
		);

		// 75/25 on 100 a month for twelve months.
		expect(points[1].byType.TFSA).toBeCloseTo(300 + 900, 10);
		expect(points[1].byType.RRSP).toBeCloseTo(100 + 300, 10);
	});

	it("grows before it contributes, so a deposit earns nothing the month it lands", () => {
		const points = projectSeries(
			{ TFSA: 0 },
			makeInputs({ years: 1, annualReturn: 0.12, monthlyContribution: 100 }),
			AT,
		);

		const monthly = 1.12 ** (1 / 12) - 1;
		// An ordinary annuity: twelve payments, the last of which has not
		// compounded at all.
		const expected = (100 * ((1 + monthly) ** 12 - 1)) / monthly;
		expect(points[1].total).toBeCloseTo(expected, 8);
		// Contributing first would make it an annuity *due*, worth one extra
		// month's growth on every payment. Landing short of that is the giveaway
		// that each deposit was credited after the month's return, not before it.
		expect(points[1].total).toBeLessThan(expected * (1 + monthly));
		expect(points[1].total).toBeGreaterThan(1200);
	});

	it("counts each account's own deposits, starting balance included", () => {
		const points = projectSeries(
			{ TFSA: 300, RRSP: 100 },
			makeInputs({ years: 1, annualReturn: 0.07, monthlyContribution: 100 }),
			AT,
		);

		// 75/25 of 100 a month for twelve months, on top of what each held.
		expect(points[1].contributedByType).toEqual({
			TFSA: 300 + 900,
			RRSP: 100 + 300,
		});
		// The dashed line is the sum of the column beside it.
		expect(points[1].contributed).toBeCloseTo(1600, 10);
	});

	it("keeps every point's deposits adding up to the contributed line", () => {
		const points = projectSeries(
			{ TFSA: 1000, RRSP: 2000 },
			makeInputs({ years: 5, annualReturn: 0.06, monthlyContribution: 250 }),
			AT,
		);

		for (const point of points) {
			const sum = Object.values(point.contributedByType).reduce(
				(total, value) => total + value,
				0,
			);
			expect(point.contributed).toBeCloseTo(sum, 10);
		}
	});

	it("keeps total equal to the sum of its account types", () => {
		const points = projectSeries(
			{ TFSA: 1000, RRSP: 2000, Margin: -100 },
			makeInputs({ years: 3, annualReturn: 0.06, monthlyContribution: 150 }),
			AT,
		);

		for (const point of points) {
			const sum = Object.values(point.byType).reduce(
				(total, value) => total + value,
				0,
			);
			expect(point.total).toBeCloseTo(sum, 10);
		}
	});

	it("takes withdrawals as a share of the balance, once a year", () => {
		const points = projectSeries(
			{ TFSA: 1000 },
			makeInputs({ years: 2, withdrawalRate: 0.1 }),
			AT,
		);

		expect(points[1].total).toBeCloseTo(900, 10);
		expect(points[1].withdrawn).toBeCloseTo(100, 10);
		expect(points[2].total).toBeCloseTo(810, 10);
		expect(points[2].withdrawn).toBeCloseTo(190, 10);
	});

	it("empties an account rather than driving it into debt", () => {
		// A projected negative balance would be a forecast of borrowing, which
		// this model has no business making.
		const points = projectSeries(
			{ TFSA: 1000 },
			makeInputs({ years: 2, withdrawalRate: 1.5 }),
			AT,
		);

		expect(points[1].total).toBe(0);
		expect(points[1].withdrawn).toBeCloseTo(1000, 10);
		expect(points[2].total).toBe(0);
		expect(points[2].withdrawn).toBeCloseTo(1000, 10);
	});

	it("deflates the real-terms line by inflation and leaves the nominal alone", () => {
		const points = projectSeries(
			{ TFSA: 1000 },
			makeInputs({ years: 10, annualReturn: 0.07, annualInflation: 0.02 }),
			AT,
		);

		const last = points[10];
		expect(last.total).toBeCloseTo(1000 * 1.07 ** 10, 6);
		expect(last.totalReal).toBeCloseTo(last.total / 1.02 ** 10, 6);
		expect(last.totalReal).toBeLessThan(last.total);
	});

	it("leaves the real line equal to the nominal when inflation is off", () => {
		const points = projectSeries(
			{ TFSA: 1000 },
			makeInputs({ years: 5, annualReturn: 0.07 }),
			AT,
		);

		for (const point of points) {
			expect(point.totalReal).toBeCloseTo(point.total, 10);
		}
	});

	it("projects a flat zero when there are no accounts to project", () => {
		const points = projectSeries(
			{},
			makeInputs({ years: 3, monthlyContribution: 500 }),
			AT,
		);

		expect(points).toHaveLength(4);
		expect(points.every((point) => point.total === 0)).toBe(true);
		// Nothing was contributed either: with no account to receive it, the
		// money has nowhere to go.
		expect(points[3].contributed).toBe(0);
	});

	it("returns only year zero for a zero-year horizon", () => {
		const points = projectSeries({ TFSA: 1000 }, makeInputs({ years: 0 }), AT);
		expect(points).toHaveLength(1);
	});

	it("dates the projection from the local calendar, not UTC", () => {
		// 21:00 in Toronto on New Year's Eve is already January 1st in UTC, so
		// reading the instant's UTC components moved every horizon year forward.
		// `analytics-overview` slices this year out to say when contribution room
		// runs out, so the cost of the bug is a wrong year, not a wrong tick.
		const points = projectSeries({ TFSA: 1000 }, makeInputs({ years: 5 }), {
			startDate: new Date(2026, 11, 31, 21, 0),
		});

		expect(points[0].date).toBe("2026-12-31");
		expect(points[5].date).toBe("2031-12-31");
	});

	it("clamps a leap-day start back into February", () => {
		// A leap-day *evening* is already March 1st in UTC, which is what made
		// the hand-rolled clamp compare March against March and never fire.
		const points = projectSeries({ TFSA: 1 }, makeInputs({ years: 1 }), {
			startDate: new Date(2024, 1, 29, 21, 0),
		});

		expect(points[1].date).toBe("2025-02-28");
	});
});

describe("depletionYear", () => {
	it("names the first year the balance runs out", () => {
		const points = projectSeries(
			{ TFSA: 1000 },
			makeInputs({ years: 5, withdrawalRate: 1 }),
			AT,
		);

		expect(depletionYear(points)).toBe(1);
	});

	it("is null while there is still money left", () => {
		const points = projectSeries(
			{ TFSA: 1000 },
			makeInputs({ years: 5, annualReturn: 0.07, withdrawalRate: 0.04 }),
			AT,
		);

		expect(depletionYear(points)).toBeNull();
	});

	// `startingBalances` skips cash-style account types, so an export holding
	// only chequing/save accounts projects from `{}` — a year-0 total of zero
	// that was never a depletion, just an empty projection.
	it("is null for an empty set of starting balances", () => {
		const points = projectSeries({}, makeInputs({ years: 5 }), AT);

		expect(points[0].total).toBe(0);
		expect(depletionYear(points)).toBeNull();
	});

	it("is null when every starting balance is zero", () => {
		const points = projectSeries(
			{ TFSA: 0, RRSP: 0 },
			makeInputs({ years: 5 }),
			AT,
		);

		expect(depletionYear(points)).toBeNull();
	});

	// Year one is the boundary the year-0 guard is most likely to swallow, so a
	// real depletion there has to survive it. The withdrawal is a share of the
	// running balance, so only a rate of 1 ever reaches exactly zero.
	it("still names year one when the balance genuinely runs out there", () => {
		const points = projectSeries(
			{ TFSA: 1000, RRSP: 500 },
			makeInputs({ years: 5, annualReturn: 0.05, withdrawalRate: 1 }),
			AT,
		);

		expect(points[0].total).toBeGreaterThan(0);
		expect(depletionYear(points)).toBe(1);
	});

	it("is null for a balance left to grow untouched", () => {
		const points = projectSeries(
			{ TFSA: 1000 },
			makeInputs({ years: 5, annualReturn: 0.05 }),
			AT,
		);

		expect(depletionYear(points)).toBeNull();
	});
});

describe("projectSeries with per-account plans", () => {
	it("contributes a full year of periods, whatever the frequency", () => {
		// The monthly step spreads a weekly or bi-weekly plan evenly, so what has
		// to hold is the annual total: 52 weeks are 52, not 48.
		const weekly = projectSeries(
			{ TFSA: 0 },
			makeInputs({
				years: 1,
				plans: { TFSA: makePlan({ amount: 100, frequency: "weekly" }) },
			}),
			AT,
		);
		const biweekly = projectSeries(
			{ TFSA: 0 },
			makeInputs({
				years: 1,
				plans: { TFSA: makePlan({ amount: 100, frequency: "biweekly" }) },
			}),
			AT,
		);
		const monthly = projectSeries(
			{ TFSA: 0 },
			makeInputs({ years: 1, plans: { TFSA: makePlan({ amount: 100 }) } }),
			AT,
		);

		expect(weekly[1].total).toBeCloseTo(5200, 10);
		expect(biweekly[1].total).toBeCloseTo(2600, 10);
		expect(monthly[1].total).toBeCloseTo(1200, 10);
	});

	it("ignores the global monthly contribution entirely", () => {
		// The simple slider keeps its value while the advanced tab is open; it
		// must not add itself on top of the per-account figures.
		const points = projectSeries(
			{ TFSA: 0, RRSP: 0 },
			makeInputs({
				years: 1,
				monthlyContribution: 5000,
				plans: { TFSA: makePlan({ amount: 100 }) },
			}),
			AT,
		);

		expect(points[1].byType.TFSA).toBeCloseTo(1200, 10);
		expect(points[1].byType.RRSP).toBe(0);
	});

	it("funds only the accounts with a plan", () => {
		const points = projectSeries(
			{ TFSA: 0, RRSP: 500 },
			makeInputs({ years: 1, plans: { TFSA: makePlan({ amount: 100 }) } }),
			AT,
		);

		expect(points[1].byType.RRSP).toBe(500);
	});

	it("caps a contribution at the room left, carrying unused room forward", () => {
		// The worked example: 24k of room today, 1k a month, 7k more room each
		// year. Room outlasts the plan for three years and runs out in the fourth.
		const points = projectSeries(
			{ TFSA: 0 },
			makeInputs({
				years: 5,
				plans: {
					TFSA: makePlan({ amount: 1000, room: 24_000, roomIncrease: 7000 }),
				},
			}),
			AT,
		);

		expect(points.map((point) => point.roomLeft.TFSA)).toEqual([
			24_000, 12_000, 7000, 2000, 0, 0,
		]);
		expect(points[3].refused.TFSA).toBe(0);
		// Year four wants 12k against 9k of room.
		expect(points[4].refused.TFSA).toBeCloseTo(3000, 10);
		// Year five has 7k of new room against 12k wanted, so 5k more is refused.
		expect(points[5].refused.TFSA).toBeCloseTo(8000, 10);
		expect(roomLimitYears(points)).toEqual({ TFSA: 4 });
	});

	it("never caps an account with no room set", () => {
		const points = projectSeries(
			{ TFSA: 0 },
			makeInputs({ years: 30, plans: { TFSA: makePlan({ amount: 1000 }) } }),
			AT,
		);

		expect(points[30].total).toBeCloseTo(360_000, 10);
		expect(roomLimitYears(points)).toEqual({});
		expect(points[30].unfunded).toBe(0);
	});

	it("spills what the room refuses into the account named", () => {
		const points = projectSeries(
			{ TFSA: 0, RRSP: 0 },
			makeInputs({
				years: 2,
				plans: {
					TFSA: makePlan({ amount: 1000, room: 6000, overflowTo: "RRSP" }),
				},
			}),
			AT,
		);

		// A year and a half of deposits fits; the remaining eighteen months land
		// in the RRSP instead.
		expect(points[2].byType.TFSA).toBeCloseTo(6000, 10);
		expect(points[2].byType.RRSP).toBeCloseTo(18_000, 10);
		expect(points[2].total).toBeCloseTo(24_000, 10);
		expect(points[2].unfunded).toBe(0);
		// Every dollar still counts as money the reader put in, wherever it landed
		// — and it counts against the account that took it, not the one that
		// turned it away, so the deposit column matches the band above it.
		expect(points[2].contributed).toBeCloseTo(24_000, 10);
		expect(points[2].contributedByType.TFSA).toBeCloseTo(6000, 10);
		expect(points[2].contributedByType.RRSP).toBeCloseTo(18_000, 10);
	});

	it("reports what nowhere could take rather than dropping it", () => {
		const points = projectSeries(
			{ TFSA: 0 },
			makeInputs({
				years: 2,
				plans: { TFSA: makePlan({ amount: 1000, room: 6000 }) },
			}),
			AT,
		);

		expect(points[2].byType.TFSA).toBeCloseTo(6000, 10);
		expect(points[2].unfunded).toBeCloseTo(18_000, 10);
		expect(points[2].contributed).toBeCloseTo(6000, 10);
	});

	it("carries a refusal down a chain of three targets", () => {
		// The shape a reader actually builds: registered accounts in the order
		// they want them filled, with a taxable account at the end to catch what
		// is left. One account fills per year, and the fourth year's deposits
		// have to cross three full accounts before they land anywhere.
		const points = projectSeries(
			{ TFSA: 0, FHSA: 0, RRSP: 0, "Non-registered": 0 },
			makeInputs({
				years: 4,
				plans: {
					TFSA: makePlan({ amount: 1000, room: 12_000, overflowTo: "FHSA" }),
					FHSA: makePlan({ room: 12_000, overflowTo: "RRSP" }),
					RRSP: makePlan({ room: 12_000, overflowTo: "Non-registered" }),
				},
			}),
			AT,
		);

		const filled = points.map((point) =>
			["TFSA", "FHSA", "RRSP", "Non-registered"].map((type) =>
				Math.round(point.byType[type]),
			),
		);
		expect(filled).toEqual([
			[0, 0, 0, 0],
			[12_000, 0, 0, 0],
			[12_000, 12_000, 0, 0],
			[12_000, 12_000, 12_000, 0],
			[12_000, 12_000, 12_000, 12_000],
		]);

		// Nothing is lost on the way down the chain, and each account is credited
		// with what it actually took.
		expect(points[4].unfunded).toBe(0);
		expect(points[4].contributed).toBeCloseTo(48_000, 10);
		expect(points[4].contributedByType["Non-registered"]).toBeCloseTo(
			12_000,
			10,
		);
		// Each link reports the year its own room ran out, in chain order.
		expect(roomLimitYears(points)).toEqual({ TFSA: 2, FHSA: 3, RRSP: 4 });
	});

	it("stops a pair of accounts pointing at each other from looping", () => {
		const points = projectSeries(
			{ TFSA: 0, RRSP: 0 },
			makeInputs({
				years: 1,
				plans: {
					TFSA: makePlan({ amount: 1000, room: 0, overflowTo: "RRSP" }),
					RRSP: makePlan({ room: 0, overflowTo: "TFSA" }),
				},
			}),
			AT,
		);

		expect(points[1].total).toBe(0);
		expect(points[1].unfunded).toBeCloseTo(12_000, 10);
	});
});

describe("usablePlans", () => {
	it("drops a plan for an account type the dataset no longer has", () => {
		const plans = { TFSA: makePlan({ amount: 100 }), LIRA: makePlan() };

		expect(Object.keys(usablePlans(plans, { TFSA: 0 }))).toEqual(["TFSA"]);
	});

	it("points a departed overflow target at nothing", () => {
		const plans = { TFSA: makePlan({ overflowTo: "LIRA" }) };

		expect(usablePlans(plans, { TFSA: 0 }).TFSA.overflowTo).toBeNull();
	});

	it("keeps an overflow target the dataset still has", () => {
		const plans = { TFSA: makePlan({ overflowTo: "RRSP" }) };

		expect(usablePlans(plans, { TFSA: 0, RRSP: 0 }).TFSA.overflowTo).toBe(
			"RRSP",
		);
	});
});
