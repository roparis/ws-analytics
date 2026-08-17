import { describe, expect, it } from "vitest";
import {
	type Activity,
	extractExportedOn,
	parseActivities,
	validateDataset,
} from "@/lib/wealthsimple";

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
		// The correction has to be preceded by the shares it corrects, or it trips
		// I3 (a symbol can't go short) on the way past.
		expect(
			validateDataset([
				makeActivity({ quantity: 250, netCashAmount: 250 }),
				buy({
					description: "TWOU - 2U Inc.: Bought 20 shares at $10.00 per share",
					netCashAmount: -200,
					quantity: 20,
					symbol: "TWOU",
					unitPrice: 10,
				}),
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

	it("flags a symbol whose shares go negative (I3)", () => {
		const problems = validateDataset([
			makeActivity({ quantity: 250, netCashAmount: 250 }),
			buy({ netCashAmount: 200, quantity: -2, unitPrice: 100 }),
		]);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("which is negative");
	});

	it("flags a closed position that left a rounding residual (I4)", () => {
		const problems = validateDataset([
			makeActivity({ quantity: 250, netCashAmount: 250 }),
			buy({ netCashAmount: -200, quantity: 2, unitPrice: 100 }),
			buy({ netCashAmount: 200, quantity: -1.9999999, unitPrice: 100.000005 }),
		]);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("rather than exactly 0");
	});

	it("flags an account whose cash residual went negative (I5)", () => {
		const problems = validateDataset([buy()]);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("not a plausible cash balance");
	});

	it("lets a margin account go negative — that is the loan, not a gap", () => {
		// Everywhere else a negative balance means rows are missing. On margin it
		// is ordinary: borrowing against the portfolio is what the account does.
		expect(
			validateDataset([
				makeActivity({
					accountType: "Non-registered margin",
					activitySubType: "TRANSFER",
					description: "Money transfer out of the account",
					netCashAmount: -500,
					quantity: -500,
				}),
			]),
		).toEqual([]);

		// The same rows in an ordinary account are still a problem.
		expect(
			validateDataset([
				makeActivity({
					activitySubType: "TRANSFER",
					description: "Money transfer out of the account",
					netCashAmount: -500,
					quantity: -500,
				}),
			]),
		).toHaveLength(1);
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

describe("extractExportedOn", () => {
	it("reads the date out of a well-formed footer", () => {
		expect(extractExportedOn("As of 2026-08-03 16:48 GMT-04:00")).toBe(
			"2026-08-03",
		);
	});

	it("ignores the offset, which varies with the season", () => {
		expect(extractExportedOn("As of 2026-08-03 16:48 GMT-05:00")).toBe(
			"2026-08-03",
		);
	});

	it("accepts the prefix in any case", () => {
		expect(extractExportedOn("as of 2026-08-03 16:48 GMT-04:00")).toBe(
			"2026-08-03",
		);
	});

	it("returns null for a missing value", () => {
		expect(extractExportedOn(undefined)).toBeNull();
	});

	it("returns null for an empty value", () => {
		expect(extractExportedOn("")).toBeNull();
	});

	// The two that matter: a real row must never be read as provenance.
	it("does not mistake a bare transaction date for a footer", () => {
		expect(extractExportedOn("2026-01-15")).toBeNull();
	});

	it("does not mistake a full ISO timestamp for a footer", () => {
		expect(extractExportedOn("2026-08-06T15:31:21-04:00")).toBeNull();
	});

	it("returns null when the prefix carries no date", () => {
		expect(extractExportedOn("As of yesterday")).toBeNull();
	});

	it("does not match a date that merely appears later in the text", () => {
		expect(extractExportedOn("Bought 2 shares on 2026-08-03")).toBeNull();
	});
});

/**
 * The unit cases above test a pure function. These test the seam that actually
 * changed: reading the footer means a second reader now touches the same raw
 * row the activity filter exists to remove, and §1.1 calls that filter "the
 * only thing standing between the footer and a `NaN` in every total".
 *
 * A synthetic export in the modern (`effective_at`) shape, small invented
 * numbers, real footer — nothing here is personal data.
 */
const HEADER =
	"effective_at,settlement_date,account_id,account_type,activity_type,activity_sub_type,description,symbol,name,currency,quantity,unit_price,commission,net_cash_amount,status";

const ROWS = [
	"2026-01-15T10:00:00-05:00,2026-01-15,TEST0001CAD,TFSA,MoneyMovement,EFT,Deposit,,,CAD,500,,,500,",
	'2026-01-16T21:30:00-05:00,2026-01-17,TEST0001CAD,TFSA,Trade,BUY,"VFV: Bought 2 shares at $100.00 per share",VFV,Vanguard,CAD,2,100,0,-200,',
].join("\n");

const WITH_FOOTER = `${HEADER}\n${ROWS}\n\n"As of 2026-08-03 16:48 GMT-04:00",,,,,,,,,,,,,,\n`;
const WITHOUT_FOOTER = `${HEADER}\n${ROWS}\n`;

describe("parseActivities — the footer is read but never becomes data", () => {
	it("captures the export date while keeping the footer out of activities", async () => {
		const source = await parseActivities(WITH_FOOTER, "with-footer.csv");

		expect(source.exportedOn).toBe("2026-08-03");
		// Two data rows in, two activities out — the footer is not a third.
		expect(source.activities).toHaveLength(2);
		// The failure §1.1 warns about announces itself as a NaN total.
		expect(source.activities.reduce((sum, a) => sum + a.netCashAmount, 0)).toBe(
			300,
		);
		// 21:30 on the 16th stays on the 16th; parsing to a `Date` would have
		// pushed it to the 17th, into another month at a month boundary.
		expect(source.activities[1].transactionDate).toBe("2026-01-16");
	});

	it("produces identical activities with and without the footer", async () => {
		const withFooter = await parseActivities(WITH_FOOTER, "with-footer.csv");
		const withoutFooter = await parseActivities(
			WITHOUT_FOOTER,
			"without-footer.csv",
		);

		// The load-bearing assertion: capturing the date changed no row, no
		// figure, and no count. Only the provenance differs.
		expect(withFooter.activities).toEqual(withoutFooter.activities);
		expect(withFooter.problems).toEqual(withoutFooter.problems);
		// A file with no footer is normal, not an error.
		expect(withoutFooter.exportedOn).toBeNull();
	});
});
