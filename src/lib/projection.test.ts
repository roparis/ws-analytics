import { describe, expect, it } from "vitest";
import {
	contributionWeights,
	depletionYear,
	type ProjectionInputs,
	projectSeries,
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

/** Fixed so the date labels are assertable rather than whatever today is. */
const START = new Date(Date.UTC(2026, 0, 15));
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

	it("clamps a leap-day start back into February", () => {
		const points = projectSeries({ TFSA: 1 }, makeInputs({ years: 1 }), {
			startDate: new Date(Date.UTC(2024, 1, 29)),
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
});
