import { describe, expect, it } from "vitest";
import {
	ALL_ACCOUNT_TYPES,
	applyOverrides,
	type Coverage,
	coveredMonths,
	earnedFrom,
	median,
	startingBalances,
	yearAccountStats,
	yearTotals,
} from "@/lib/analytics";
import { computeKpis } from "@/lib/metrics";
import { buildPositions } from "@/lib/positions";
import type { Activity } from "@/lib/wealthsimple";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
	return {
		transactionDate: "2026-01-15",
		effectiveAt: null,
		settlementDate: null,
		accountId: "TEST0001CAD",
		accountType: "TFSA",
		activityType: "MoneyMovement",
		activitySubType: "EFT",
		description: "Deposit",
		symbol: null,
		name: null,
		currency: "CAD",
		quantity: 100,
		unitPrice: null,
		commission: null,
		netCashAmount: 100,
		...overrides,
	};
}

/** A bank deposit — the wording is what `isBankDeposit` keys on. */
function deposit(
	amount: number,
	transactionDate: string,
	overrides: Partial<Activity> = {},
): Activity {
	return makeActivity({
		description: "Deposit",
		netCashAmount: amount,
		quantity: amount,
		transactionDate,
		...overrides,
	});
}

function withdrawal(
	amount: number,
	transactionDate: string,
	overrides: Partial<Activity> = {},
): Activity {
	return makeActivity({
		description: "Withdrawal",
		netCashAmount: -amount,
		quantity: -amount,
		transactionDate,
		...overrides,
	});
}

/** Net cash is derived from quantity and price, as in the real file (I1). */
function trade(
	overrides: Partial<Activity> & {
		quantity: number;
		transactionDate: string;
		unitPrice: number;
	},
): Activity {
	const symbol = overrides.symbol ?? "ZAG";
	return makeActivity({
		activitySubType: overrides.quantity > 0 ? "BUY" : "SELL",
		activityType: "Trade",
		description: `${symbol} - Fund: ${overrides.quantity > 0 ? "Bought" : "Sold"} shares`,
		name: "BMO Aggregate Bond Index ETF",
		symbol,
		...overrides,
		netCashAmount: -(overrides.quantity * overrides.unitPrice),
	});
}

const FULL: Coverage = { start: "2025-01-01", end: "2026-12-31" };

describe("median", () => {
	it("takes the middle of an odd count", () => {
		expect(median([5, 1, 3])).toBe(3);
	});

	it("averages the two middles of an even count", () => {
		expect(median([1, 2, 3, 10])).toBe(2.5);
	});

	it("is zero for nothing at all", () => {
		expect(median([])).toBe(0);
	});

	it("leaves the caller's array alone", () => {
		const values = [3, 1, 2];
		median(values);
		expect(values).toEqual([3, 1, 2]);
	});
});

describe("coveredMonths", () => {
	it("returns all twelve when the year is fully covered", () => {
		expect(coveredMonths("2026", FULL)).toHaveLength(12);
	});

	it("starts at the month the files start in", () => {
		const months = coveredMonths("2026", {
			start: "2026-09-14",
			end: "2026-12-31",
		});
		expect(months).toEqual(["2026-09", "2026-10", "2026-11", "2026-12"]);
	});

	it("stops at the month the files end in", () => {
		const months = coveredMonths("2026", {
			start: "2025-01-01",
			end: "2026-03-04",
		});
		expect(months).toEqual(["2026-01", "2026-02", "2026-03"]);
	});

	it("covers nothing for a year outside the files", () => {
		expect(coveredMonths("2020", FULL)).toEqual([]);
	});
});

describe("earnedFrom", () => {
	it("adds income and takes costs off, on top of the realised gain", () => {
		const kpis = computeKpis([
			makeActivity({
				activitySubType: null,
				activityType: "Dividend",
				description: "ZAG distribution",
				netCashAmount: 40,
			}),
			makeActivity({
				activitySubType: null,
				activityType: "Interest",
				description: "Interest",
				netCashAmount: 5,
			}),
			makeActivity({
				activitySubType: "CASHBACK",
				activityType: "BonusPayment",
				description: "Cash back",
				netCashAmount: 7,
			}),
			makeActivity({
				activitySubType: null,
				activityType: "Fee",
				description: "Management fee",
				netCashAmount: -12,
			}),
		]);

		const earned = earnedFrom(kpis, 100);

		expect(earned).toMatchObject({
			bonuses: 7,
			dividends: 40,
			feesAndTax: 12,
			interest: 5,
			realized: 100,
		});
		expect(earned.total).toBeCloseTo(100 + 40 + 5 + 7 - 12, 6);
	});

	it("keeps the total equal to the sum of its parts", () => {
		const earned = earnedFrom(computeKpis([]), 250);
		expect(earned.total).toBe(250);
	});
});

describe("yearTotals", () => {
	const activities = [
		deposit(1000, "2025-02-10"),
		trade({ quantity: 50, transactionDate: "2025-03-01", unitPrice: 10 }),
		deposit(2000, "2026-01-10"),
		trade({ quantity: 40, transactionDate: "2026-02-01", unitPrice: 12 }),
		withdrawal(300, "2026-06-15"),
	];
	const report = buildPositions(activities);

	it("runs newest year first", () => {
		const rows = yearTotals(activities, report, FULL);
		expect(rows.map((row) => row.year)).toEqual(["2026", "2025"]);
	});

	it("carries the all-types marker rather than a real type name", () => {
		const rows = yearTotals(activities, report, FULL);
		expect(rows[0].accountType).toBe(ALL_ACCOUNT_TYPES);
	});

	it("reports deposits and withdrawals", () => {
		const [current] = yearTotals(activities, report, FULL);

		expect(current.deposited).toBeCloseTo(2000, 6);
		expect(current.withdrawn).toBeCloseTo(300, 6);
	});

	it("counts a month with no deposit as a real zero in the median", () => {
		// One $2000 deposit in a fully-covered year is not a $2000-a-month habit.
		const [current] = yearTotals(activities, report, FULL);

		expect(current.monthsCovered).toBe(12);
		expect(current.monthsDeposited).toBe(1);
		expect(current.medianMonthlyDeposited).toBe(0);
	});

	it("reports the deposit itself when only that month is covered", () => {
		const [current] = yearTotals(activities, report, {
			start: "2026-01-01",
			end: "2026-01-31",
		});

		expect(current.monthsCovered).toBe(1);
		expect(current.medianMonthlyDeposited).toBeCloseTo(2000, 6);
	});
});

describe("yearAccountStats", () => {
	it("separates the same year's account types", () => {
		const activities = [
			deposit(1000, "2026-01-10"),
			deposit(500, "2026-01-10", {
				accountId: "TEST0002CAD",
				accountType: "RRSP",
			}),
		];
		const rows = yearAccountStats(activities, buildPositions(activities), FULL);

		expect(rows.map((row) => row.accountType)).toEqual(["RRSP", "TFSA"]);
		expect(rows[0].deposited).toBeCloseTo(500, 6);
		expect(rows[1].deposited).toBeCloseTo(1000, 6);
	});

	it("keeps an account type whose name contains a space intact", () => {
		// Types are free-form labels out of the CSV, not identifiers.
		const activities = [
			deposit(750, "2026-04-01", {
				accountId: "TEST0003CAD",
				accountType: "Non-registered margin",
			}),
		];
		const rows = yearAccountStats(activities, buildPositions(activities), FULL);

		expect(rows).toHaveLength(1);
		expect(rows[0].accountType).toBe("Non-registered margin");
	});

	it("leaves out year and type pairs that had no activity", () => {
		const activities = [
			deposit(1000, "2025-05-01"),
			deposit(500, "2026-05-01", {
				accountId: "TEST0002CAD",
				accountType: "RRSP",
			}),
		];
		const rows = yearAccountStats(activities, buildPositions(activities), FULL);

		// Two pairs, not the four a padded cross-tab would produce.
		expect(rows).toHaveLength(2);
		expect(rows.map((row) => `${row.year} ${row.accountType}`)).toEqual([
			"2026 RRSP",
			"2025 TFSA",
		]);
	});

	it("credits a realised gain to the year of the sale, not the buy", () => {
		const activities = [
			deposit(5000, "2025-01-05"),
			trade({ quantity: 100, transactionDate: "2025-02-01", unitPrice: 10 }),
			trade({ quantity: -100, transactionDate: "2026-02-01", unitPrice: 13 }),
		];
		const rows = yearAccountStats(activities, buildPositions(activities), FULL);
		const byYear = new Map(rows.map((row) => [row.year, row]));

		expect(byYear.get("2025")?.earned.realized).toBeCloseTo(0, 6);
		expect(byYear.get("2026")?.earned.realized).toBeCloseTo(300, 6);
	});

	it("keeps each type's realised gain to that type", () => {
		const activities = [
			deposit(5000, "2025-01-05"),
			deposit(5000, "2025-01-05", {
				accountId: "TEST0002CAD",
				accountType: "RRSP",
			}),
			trade({ quantity: 100, transactionDate: "2025-02-01", unitPrice: 10 }),
			trade({ quantity: -100, transactionDate: "2026-02-01", unitPrice: 13 }),
			trade({
				accountId: "TEST0002CAD",
				accountType: "RRSP",
				quantity: 50,
				transactionDate: "2025-02-01",
				unitPrice: 10,
			}),
			trade({
				accountId: "TEST0002CAD",
				accountType: "RRSP",
				quantity: -50,
				transactionDate: "2026-03-01",
				unitPrice: 20,
			}),
		];
		const rows = yearAccountStats(activities, buildPositions(activities), FULL);
		const current = new Map(
			rows
				.filter((row) => row.year === "2026")
				.map((row) => [row.accountType, row]),
		);

		expect(current.get("TFSA")?.earned.realized).toBeCloseTo(300, 6);
		expect(current.get("RRSP")?.earned.realized).toBeCloseTo(500, 6);
	});

	it("adds up across types to the same figures the year total reports", () => {
		// The check that makes the cross-tab trustworthy: splitting a year by
		// account type must not change the year.
		const activities = [
			deposit(1000, "2026-01-10"),
			deposit(500, "2026-03-10", {
				accountId: "TEST0002CAD",
				accountType: "RRSP",
			}),
			trade({ quantity: 40, transactionDate: "2026-02-01", unitPrice: 12 }),
			trade({
				accountId: "TEST0002CAD",
				accountType: "RRSP",
				quantity: 20,
				transactionDate: "2026-04-01",
				unitPrice: 15,
			}),
			withdrawal(200, "2026-06-15"),
		];
		const report = buildPositions(activities);
		const [total] = yearTotals(activities, report, FULL);
		const parts = yearAccountStats(activities, report, FULL).filter(
			(row) => row.year === "2026",
		);

		const sum = (pick: (row: (typeof parts)[number]) => number) =>
			parts.reduce((running, row) => running + pick(row), 0);

		expect(sum((row) => row.deposited)).toBeCloseTo(total.deposited, 6);
		expect(sum((row) => row.withdrawn)).toBeCloseTo(total.withdrawn, 6);
		expect(sum((row) => row.transfers)).toBeCloseTo(total.transfers, 6);
		expect(sum((row) => row.earned.total)).toBeCloseTo(total.earned.total, 6);
	});
});

describe("startingBalances", () => {
	it("adds each type's book cost to the cash sitting beside it", () => {
		const activities = [
			deposit(1000, "2026-01-05"),
			trade({ quantity: 40, transactionDate: "2026-02-01", unitPrice: 10 }),
		];
		const balances = startingBalances(buildPositions(activities));

		// $400 of book cost and $600 of cash left over.
		expect(balances.TFSA).toBeCloseTo(1000, 6);
	});

	it("gives every account type in the report a balance", () => {
		const activities = [
			deposit(1000, "2026-01-05"),
			deposit(500, "2026-01-05", {
				accountId: "TEST0002CAD",
				accountType: "RRSP",
			}),
		];
		const balances = startingBalances(buildPositions(activities));

		expect(Object.keys(balances).sort()).toEqual(["RRSP", "TFSA"]);
	});

	it("leaves chequing-style accounts out of the projection entirely", () => {
		// That balance is salary waiting to be spent, and compounding it at an
		// equity return would pad the projection with next month's rent.
		const activities = [
			deposit(1000, "2026-01-05"),
			makeActivity({
				accountId: "CASH0001CAD",
				accountType: "Cash",
				activitySubType: "AFT_IN",
				description: "Direct deposit received",
				netCashAmount: 3200,
				transactionDate: "2026-01-05",
			}),
		];
		const balances = startingBalances(buildPositions(activities));

		expect(Object.keys(balances)).toEqual(["TFSA"]);
	});
});

describe("applyOverrides", () => {
	it("replaces a default the reader has typed over", () => {
		expect(applyOverrides({ TFSA: 100, RRSP: 200 }, { TFSA: 5000 })).toEqual({
			TFSA: 5000,
			RRSP: 200,
		});
	});

	it("ignores an override for a type the files no longer contain", () => {
		expect(applyOverrides({ TFSA: 100 }, { LIRA: 9000 })).toEqual({
			TFSA: 100,
		});
	});

	it("ignores a value that isn't a real number", () => {
		expect(applyOverrides({ TFSA: 100 }, { TFSA: Number.NaN })).toEqual({
			TFSA: 100,
		});
	});

	it("allows an override of zero", () => {
		// A reader zeroing an account out is a choice, not a missing value.
		expect(applyOverrides({ TFSA: 100 }, { TFSA: 0 })).toEqual({ TFSA: 0 });
	});
});
