import { describe, expect, it } from "vitest";
import {
	computeKpis,
	flowBreakdown,
	isExternalMoneyMovement,
} from "@/lib/metrics";
import type { Activity } from "@/lib/wealthsimple";

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

/** One row per line in `CATEGORIES`, so the breakdown is exercised end to end. */
function everyCategoryFixture(): Activity[] {
	return [
		makeActivity({
			accountType: "Chequing",
			activitySubType: "AFT_IN",
			description: "Direct deposit received",
			quantity: 1910.4,
			netCashAmount: 1910.4,
		}),
		makeActivity({ netCashAmount: 500, quantity: 500 }),
		makeActivity({
			description: "Withdrawal",
			quantity: -250,
			netCashAmount: -250,
		}),
		makeActivity({
			accountType: "Chequing",
			activitySubType: "E_TRFOUT",
			description: "Interac e-Transfer® Out",
			quantity: -50,
			netCashAmount: -50,
		}),
		makeActivity({
			accountType: "Chequing",
			activitySubType: "AFT_OUT",
			description: "Pre-authorized Debit",
			quantity: -69,
			netCashAmount: -69,
		}),
		makeActivity({
			accountType: "Chequing",
			activitySubType: "TRANSFER",
			description: "Credit card payment",
			quantity: -430.61,
			netCashAmount: -430.61,
		}),
		makeActivity({
			activitySubType: "TRANSFER",
			description: "Money transfer into the account (executed at 2026-01-15)",
			quantity: 300,
			netCashAmount: 300,
		}),
		makeActivity({
			activitySubType: "TRANSFER_TF",
			description: "Money transfer out of the account (executed at 2026-01-15)",
			quantity: -218.39,
			netCashAmount: -218.39,
		}),
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
		}),
		makeActivity({
			activityType: "Trade",
			activitySubType: "SELL",
			settlementDate: "2026-01-16",
			description: "VFV: Sold 1 shares at $100.00 per share",
			symbol: "VFV",
			quantity: -1,
			unitPrice: 100,
			commission: 0,
			netCashAmount: 100,
		}),
		makeActivity({
			activityType: "Dividend",
			activitySubType: null,
			description: "ZAG: Cash dividend distribution",
			symbol: "ZAG",
			quantity: 12.31,
			netCashAmount: 12.31,
		}),
		makeActivity({
			accountType: "Chequing",
			activityType: "Interest",
			activitySubType: null,
			description: "Interest received (executed at 2026-01-15)",
			quantity: 3.39,
			netCashAmount: 3.39,
		}),
		makeActivity({
			accountType: "Chequing",
			activityType: "BonusPayment",
			activitySubType: "CASHBACK",
			description: "Cash back - Credit card",
			quantity: 25.78,
			netCashAmount: 25.78,
		}),
		makeActivity({
			accountType: "Chequing",
			activityType: "BonusPayment",
			activitySubType: "REFER",
			description: "Referral bonus (2026-01-15)",
			quantity: 25,
			netCashAmount: 25,
		}),
		makeActivity({
			activityType: "Fee",
			activitySubType: null,
			description: "Management fee (executed at 2026-01-15)",
			quantity: -22.19,
			netCashAmount: -22.19,
		}),
		makeActivity({
			accountType: "Non-registered margin",
			activityType: "InterestCharged",
			activitySubType: null,
			description: "Margin Interest Charges",
			quantity: -3.93,
			netCashAmount: -3.93,
		}),
		makeActivity({
			activityType: "Tax",
			activitySubType: "NRT",
			description: "Non-resident tax (executed at 2026-01-15)",
			quantity: -11.54,
			netCashAmount: -11.54,
		}),
		makeActivity({
			activityType: "AdministrativePayment",
			activitySubType: "MANAGEMENT_FEE_REFUND",
			description: "CAD credited (executed at 2026-01-15)",
			quantity: 14.55,
			netCashAmount: 14.55,
		}),
	];
}

function lineIn(
	breakdown: ReturnType<typeof flowBreakdown>,
	sectionKey: string,
	lineKey: string,
) {
	return breakdown.sections
		.find((section) => section.key === sectionKey)
		?.lines.find((line) => line.key === `${sectionKey}:${lineKey}`);
}

describe("flowBreakdown / computeKpis reconciliation", () => {
	it("agrees with computeKpis on net cash flow", () => {
		const activities = everyCategoryFixture();

		expect(flowBreakdown(activities).net).toBeCloseTo(
			computeKpis(activities).netCashFlow,
			10,
		);
	});

	it("files every activity into exactly one line", () => {
		const activities = everyCategoryFixture();
		const breakdown = flowBreakdown(activities);

		const counted = breakdown.sections
			.flatMap((section) => section.lines)
			.reduce((sum, line) => sum + line.count, 0);

		expect(counted).toBe(activities.length);
	});

	it("routes an unrecognized activity type to Other rather than dropping it", () => {
		const activities = [
			makeActivity({
				activityType: "SomeNewWealthsimpleType",
				activitySubType: null,
				quantity: 42,
				netCashAmount: 42,
			}),
		];
		const breakdown = flowBreakdown(activities);

		expect(lineIn(breakdown, "other", "other_in")?.value).toBe(42);
		expect(breakdown.net).toBe(42);
	});

	it("section totals sum back to the net", () => {
		const breakdown = flowBreakdown(everyCategoryFixture());
		const fromSections = breakdown.sections.reduce(
			(sum, section) => sum + section.total,
			0,
		);

		expect(fromSections).toBeCloseTo(breakdown.net, 10);
	});
});

describe("credit card payments are spending, not internal transfers", () => {
	const ccPayment = makeActivity({
		accountType: "Chequing",
		activitySubType: "TRANSFER",
		description: "Credit card payment",
		quantity: -430.61,
		netCashAmount: -430.61,
	});

	it("files them under Money out", () => {
		const breakdown = flowBreakdown([ccPayment]);

		expect(lineIn(breakdown, "out", "cc_payment")?.value).toBe(-430.61);
	});

	it("keeps them out of the internal transfer line", () => {
		const breakdown = flowBreakdown([ccPayment]);

		expect(lineIn(breakdown, "internal", "transfer")).toBeUndefined();
		expect(breakdown.sections.some((s) => s.key === "internal")).toBe(false);
	});

	it("still counts a genuine account transfer as internal", () => {
		const transfer = makeActivity({
			activitySubType: "TRANSFER",
			description: "Money transfer into the account (executed at 2026-01-15)",
			quantity: 300,
			netCashAmount: 300,
		});
		const breakdown = flowBreakdown([transfer]);

		expect(lineIn(breakdown, "internal", "transfer")?.value).toBe(300);
	});
});

describe("cashback is card cash back only", () => {
	const refer = makeActivity({
		accountType: "Chequing",
		activityType: "BonusPayment",
		activitySubType: "REFER",
		description: "Referral bonus (2026-01-15)",
		quantity: 25,
		netCashAmount: 25,
	});

	it("reports a referral bonus as promo, not cashback", () => {
		const kpis = computeKpis([refer]);

		expect(kpis.cashback).toBe(0);
		expect(kpis.promo).toBe(25);
	});

	it("reports a giveaway as promo", () => {
		const giveaway = makeActivity({
			accountType: "Chequing",
			activityType: "BonusPayment",
			activitySubType: "GIVEAWAY",
			description: "Giveaway received",
			quantity: 5,
			netCashAmount: 5,
		});

		expect(computeKpis([giveaway]).promo).toBe(5);
	});

	it("reports CASHBACK as cashback", () => {
		const cashback = makeActivity({
			accountType: "Chequing",
			activityType: "BonusPayment",
			activitySubType: "CASHBACK",
			description: "Cash back - Credit card",
			quantity: 25.78,
			netCashAmount: 25.78,
		});
		const kpis = computeKpis([cashback]);

		expect(kpis.cashback).toBe(25.78);
		expect(kpis.promo).toBe(0);
	});

	it("counts both toward total income", () => {
		const kpis = computeKpis(everyCategoryFixture());

		expect(kpis.cashback).toBe(25.78);
		expect(kpis.promo).toBe(25);
		// dividends 12.31 + interest 3.39 + cashback 25.78 + promo 25
		expect(kpis.income).toBeCloseTo(66.48, 10);
	});
});

describe("isExternalMoneyMovement", () => {
	it("accepts an EFT into an investment account", () => {
		expect(isExternalMoneyMovement(makeActivity())).toBe(true);
	});

	it("rejects a cash-account EFT", () => {
		expect(
			isExternalMoneyMovement(makeActivity({ accountType: "Chequing" })),
		).toBe(false);
	});

	it("rejects transfers between the owner's accounts", () => {
		expect(
			isExternalMoneyMovement(makeActivity({ activitySubType: "TRANSFER" })),
		).toBe(false);
		expect(
			isExternalMoneyMovement(makeActivity({ activitySubType: "TRANSFER_TF" })),
		).toBe(false);
	});

	it("rejects non-money-movement rows", () => {
		expect(
			isExternalMoneyMovement(
				makeActivity({ activityType: "Dividend", activitySubType: null }),
			),
		).toBe(false);
	});

	it("selects exactly the rows behind moneyIn/moneyOut", () => {
		const activities = everyCategoryFixture();
		const kpis = computeKpis(activities);

		const fromPredicate = activities
			.filter(isExternalMoneyMovement)
			.reduce((sum, activity) => sum + activity.netCashAmount, 0);

		expect(fromPredicate).toBeCloseTo(kpis.moneyIn - kpis.moneyOut, 10);
	});
});
