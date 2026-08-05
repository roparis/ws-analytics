import { describe, expect, it } from "vitest";
import { type Activity, validateDataset } from "@/lib/wealthsimple";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
	return {
		transactionDate: "2026-01-15",
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

const buy = (overrides: Partial<Activity> = {}) =>
	makeActivity({
		activityType: "Trade",
		activitySubType: "BUY",
		settlementDate: "2026-01-16",
		description: "VFV: Bought 2 shares at $100.00 per share",
		symbol: "VFV",
		quantity: 2,
		unitPrice: 100,
		commission: 0,
		netCashAmount: -200,
		...overrides,
	});

describe("validateDataset", () => {
	it("passes a well-formed dataset", () => {
		// Deposit funds the buy; the account is left with $50 idle cash.
		expect(
			validateDataset([
				makeActivity({ quantity: 250, netCashAmount: 250 }),
				buy(),
			]),
		).toEqual([]);
	});

	it("flags a trade whose net cash breaks the price identity (I1)", () => {
		const problems = validateDataset([
			makeActivity({ quantity: 250, netCashAmount: 250 }),
			buy({ netCashAmount: -150 }),
		]);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("-(qty x price) - commission");
	});

	it("accounts for commission in the price identity", () => {
		const problems = validateDataset([
			makeActivity({ quantity: 250, netCashAmount: 250 }),
			buy({ commission: 5, netCashAmount: -205 }),
		]);

		expect(problems).toEqual([]);
	});

	it("flags a non-trade row where quantity isn't the cash amount (I2)", () => {
		const problems = validateDataset([
			makeActivity({ quantity: 999, netCashAmount: 100 }),
		]);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("on a non-trade row");
	});

	it("exempts corporate actions, which carry a share delta and no cash", () => {
		expect(
			validateDataset([
				makeActivity({
					activityType: "LegacyCorporateAction",
					activitySubType: "NAME_CHANGE",
					description: "TWOU - 2U Inc.: Corrected quantity of shares by -20",
					symbol: "TWOU",
					quantity: -20,
					netCashAmount: 0,
				}),
			]),
		).toEqual([]);
	});

	it("flags an account whose cash residual went negative (I5)", () => {
		const problems = validateDataset([buy()]);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("not a plausible cash balance");
	});

	it("flags an implausibly large residual", () => {
		const problems = validateDataset([
			makeActivity({ quantity: 500_000, netCashAmount: 500_000 }),
		]);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("not a plausible cash balance");
	});

	it("checks the residual per account, not across the file", () => {
		// One account overdrawn, another holding the offsetting cash — summing
		// across accounts would hide this.
		const problems = validateDataset([
			buy({ accountId: "AAA0000001CAD" }),
			makeActivity({
				accountId: "BBB0000002CAD",
				quantity: 200,
				netCashAmount: 200,
			}),
		]);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("AAA0000001CAD");
	});
});
