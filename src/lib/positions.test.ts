import { describe, expect, it } from "vitest";
import { type Coverage, yearAccountStats } from "@/lib/analytics";
import {
	buildPositions,
	detectListing,
	extractFxRate,
	normalizeName,
} from "@/lib/positions";
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

/**
 * A trade row that satisfies I1 by construction — `netCashAmount` is derived
 * from quantity, price and commission rather than typed independently, so a
 * fixture can't accidentally assert against arithmetic the real file never
 * produces.
 */
function trade(
	overrides: Partial<Activity> & { quantity: number; unitPrice: number },
): Activity {
	const commission = overrides.commission ?? 0;
	const netCashAmount =
		overrides.netCashAmount ??
		-(overrides.quantity * overrides.unitPrice) - commission;

	return makeActivity({
		activityType: "Trade",
		activitySubType: overrides.quantity > 0 ? "BUY" : "SELL",
		settlementDate: overrides.transactionDate ?? "2026-01-15",
		symbol: "ZAG",
		name: "BMO Aggregate Bond Index ETF",
		description: `${overrides.symbol ?? "ZAG"} - Fund: ${overrides.quantity > 0 ? "Bought" : "Sold"} shares`,
		commission,
		...overrides,
		netCashAmount,
	});
}

/** Deposits enough cash that the account clears the I5 residual check. */
function funding(amount: number, overrides: Partial<Activity> = {}): Activity {
	return makeActivity({
		netCashAmount: amount,
		quantity: amount,
		...overrides,
	});
}

function onlyPosition(activities: Activity[]) {
	const report = buildPositions(activities);
	expect(report.positions).toHaveLength(1);
	return report.positions[0];
}

describe("book cost", () => {
	it("pools two buys at their combined cost", () => {
		const position = onlyPosition([
			funding(1000),
			trade({ quantity: 10, unitPrice: 10, transactionDate: "2026-01-02" }),
			trade({ quantity: 10, unitPrice: 20, transactionDate: "2026-01-03" }),
		]);

		expect(position.shares).toBe(20);
		expect(position.bookCost).toBeCloseTo(300, 6);
		expect(position.averageCost).toBeCloseTo(15, 6);
	});

	it("counts commission once — it is already inside net cash", () => {
		// I1: net cash is -(qty x price) - commission, so |net cash| is the whole
		// cost. Adding `commission` on top would double-count it.
		const position = onlyPosition([
			funding(1000),
			trade({ quantity: 10, unitPrice: 10, commission: 5 }),
		]);

		expect(position.bookCost).toBeCloseTo(105, 6);
		expect(position.averageCost).toBeCloseTo(10.5, 6);
		expect(position.commission).toBe(5);
	});

	it("never multiplies unit price by the FX rate", () => {
		// The single most expensive mistake this file can make: `unit_price` is
		// already CAD on FX rows (§4), so a US-listed buy costs what the cash
		// column says, not ~38% more.
		const position = onlyPosition([
			funding(1000),
			trade({
				description:
					"VTI - Vanguard Total Stock Market ETF: Bought 1 shares at $513.45 per share (executed at 2026-07-30), FX Rate: 1.3800",
				quantity: 1,
				symbol: "VTI",
				unitPrice: 513.45,
			}),
		]);

		expect(position.bookCost).toBeCloseTo(513.45, 6);
		expect(position.listing).toBe("us");
		expect(position.lastFxRate).toBe(1.38);
	});

	it("releases cost at the pool average when shares are sold", () => {
		const position = onlyPosition([
			funding(1000),
			trade({ quantity: 10, unitPrice: 10, transactionDate: "2026-01-02" }),
			trade({ quantity: 10, unitPrice: 20, transactionDate: "2026-01-03" }),
			trade({ quantity: -5, transactionDate: "2026-01-04", unitPrice: 25 }),
		]);

		expect(position.shares).toBe(15);
		expect(position.bookCost).toBeCloseTo(225, 6);
		expect(position.realizedPnl).toBeCloseTo(50, 6);
	});

	it("takes sell commission out of proceeds, not out of cost", () => {
		const position = onlyPosition([
			funding(1000),
			trade({ quantity: 10, unitPrice: 10, transactionDate: "2026-01-02" }),
			trade({
				commission: 5,
				quantity: -10,
				transactionDate: "2026-01-03",
				unitPrice: 12.5,
			}),
		]);

		expect(position.proceeds).toBeCloseTo(120, 6);
		expect(position.realizedPnl).toBeCloseTo(20, 6);
	});
});

describe("closing a position", () => {
	it("lands on exactly zero shares, not float dust", () => {
		const buy = (transactionDate: string) =>
			trade({
				description: "Purchase of 0.00019052 BTC, FX Rate: 1.3942",
				name: "Bitcoin",
				quantity: 0.00019052,
				symbol: "BTC",
				transactionDate,
				unitPrice: 128638.82,
			});

		const position = onlyPosition([
			funding(1000),
			buy("2026-01-02"),
			buy("2026-01-03"),
			buy("2026-01-04"),
			trade({
				description: "Sale of BTC, FX Rate: 1.3942",
				quantity: -0.00057156,
				symbol: "BTC",
				transactionDate: "2026-02-01",
				unitPrice: 130000,
			}),
		]);

		expect(position.shares).toBe(0);
		expect(position.bookCost).toBe(0);
		expect(position.averageCost).toBeNull();
	});

	it("realizes every remaining dollar of cost on a full exit", () => {
		// Quantities that don't sum cleanly: the pool still has to close on 0 and
		// the residual basis has to land in realized P&L rather than vanish.
		const position = onlyPosition([
			funding(1000),
			trade({ quantity: 0.1, transactionDate: "2026-01-02", unitPrice: 100 }),
			trade({ quantity: 0.2, transactionDate: "2026-01-03", unitPrice: 100 }),
			trade({
				quantity: -0.30000000000000004,
				transactionDate: "2026-01-04",
				unitPrice: 110,
			}),
		]);

		expect(position.shares).toBe(0);
		expect(position.bookCost).toBe(0);
		expect(position.costBasis - position.proceeds).toBeCloseTo(
			-position.realizedPnl,
			6,
		);
	});

	it("floors book cost at zero when more shares are sold than held", () => {
		const report = buildPositions([
			funding(1000),
			trade({ quantity: 10, unitPrice: 10, transactionDate: "2026-01-02" }),
			trade({ quantity: -15, transactionDate: "2026-01-03", unitPrice: 12 }),
		]);
		const position = report.positions[0];

		expect(position.shares).toBe(0);
		expect(position.bookCost).toBe(0);
		expect(position.issues.map((issue) => issue.flag)).toContain(
			"sold-more-than-held",
		);
		expect(report.byAccount[0].historyConfidence).toBe("suspect");
	});
});

describe("corporate actions", () => {
	it("treats an unpaired share delta as a split — cost is unchanged", () => {
		const position = onlyPosition([
			funding(1000),
			trade({ quantity: 10, unitPrice: 10, transactionDate: "2026-01-02" }),
			makeActivity({
				activitySubType: "NAME_CHANGE",
				activityType: "LegacyCorporateAction",
				description: "ZAG - Fund: Corrected quantity of shares by 10",
				netCashAmount: 0,
				quantity: 10,
				symbol: "ZAG",
				transactionDate: "2026-01-03",
			}),
		]);

		expect(position.shares).toBe(20);
		expect(position.bookCost).toBeCloseTo(100, 6);
		expect(position.averageCost).toBeCloseTo(5, 6);
		expect(position.issues.map((issue) => issue.flag)).toContain(
			"corporate-action-unpaired",
		);
	});

	it("carries the cost pool across a ticker rename without inventing a gain", () => {
		const rename = (symbol: string, quantity: number) =>
			makeActivity({
				activitySubType: "NAME_CHANGE",
				activityType: "LegacyCorporateAction",
				description: `${symbol} - 2U Inc.: Corrected quantity of shares by ${quantity}`,
				name: "2U Inc.",
				netCashAmount: 0,
				quantity,
				symbol,
				transactionDate: "2026-06-01",
			});

		const report = buildPositions([
			funding(1000),
			trade({
				name: "2U Inc.",
				quantity: 20,
				symbol: "TWOU",
				transactionDate: "2026-01-02",
				unitPrice: 10,
			}),
			rename("TWOU", -20),
			rename("TWOUQ", 20),
			trade({
				name: "2U Inc.",
				quantity: -20,
				symbol: "TWOUQ",
				transactionDate: "2026-12-01",
				unitPrice: 7.5,
			}),
		]);

		// One pool, not two — otherwise TWOUQ receives 20 shares at zero cost and
		// its sale books a $150 gain that never happened.
		expect(report.positions).toHaveLength(1);
		const position = report.positions[0];
		expect(position.symbol).toBe("TWOUQ");
		expect(position.aliases).toContain("TWOU");
		expect(position.shares).toBe(0);
		expect(position.realizedPnl).toBeCloseTo(-50, 6);
		expect(position.issues.map((issue) => issue.flag)).toContain("renamed");
	});

	it("carries the pool across a rename that also changes the share ratio", () => {
		// The real shape of this event in a Wealthsimple export: 20 TWOU became
		// 0.6667 TWOUQ on 2024-06-14 — a ticker change and a 1-for-30 reverse
		// split booked together, so the two corrections do *not* cancel. Requiring
		// them to would split one holding into a fabricated $30.50 loss on the old
		// ticker and a fabricated $5.52 gain on the new one.
		const correction = (symbol: string, quantity: number) =>
			makeActivity({
				activitySubType: "NAME_CHANGE",
				activityType: "LegacyCorporateAction",
				description: `${symbol} - 2U Inc.: Corrected quantity of shares by ${quantity}`,
				name: "2U Inc.",
				netCashAmount: 0,
				quantity,
				symbol,
				transactionDate: "2024-06-14",
			});

		const report = buildPositions([
			funding(1000),
			trade({
				description:
					"TWOU - 2U Inc.: Bought 20.0000 shares at $1.52 per share, FX Rate: 1.3616",
				name: "2U Inc.",
				netCashAmount: -30.5,
				quantity: 20,
				symbol: "TWOU",
				transactionDate: "2024-01-05",
				unitPrice: 1.52499984,
			}),
			correction("TWOUQ", 0.6667),
			correction("TWOU", -20),
			trade({
				description:
					"TWOUQ - 2U Inc.: Sold 0.6667 shares at $8.28 per share, FX Rate: 1.3489",
				name: "2U Inc.",
				netCashAmount: 5.52,
				quantity: -0.6667,
				symbol: "TWOUQ",
				transactionDate: "2024-06-17",
				unitPrice: 8.2869006087,
			}),
		]);

		expect(report.positions).toHaveLength(1);
		const position = report.positions[0];
		expect(position.symbol).toBe("TWOUQ");
		expect(position.shares).toBe(0);
		// The whole $30.50 cost is released against the $5.52 of proceeds.
		expect(position.realizedPnl).toBeCloseTo(-24.98, 2);
		expect(position.issues.map((issue) => issue.flag)).toEqual(["renamed"]);
		expect(report.byAccount[0].historyConfidence).toBe("complete");
	});
});

describe("incomplete history", () => {
	it("flags a position that opens with a sale", () => {
		const report = buildPositions([
			funding(1000),
			trade({ quantity: -10, transactionDate: "2026-01-02", unitPrice: 12 }),
		]);

		expect(report.positions[0].issues.map((issue) => issue.flag)).toContain(
			"first-trade-is-sell",
		);
		expect(report.byAccount[0].historyConfidence).toBe("suspect");
	});

	it("flags distributions on a holding that was never bought", () => {
		const report = buildPositions([
			funding(1000),
			makeActivity({
				activitySubType: null,
				activityType: "Dividend",
				description: "ZAG - Fund: Cash dividend distribution",
				netCashAmount: 12.5,
				quantity: 12.5,
				symbol: "ZAG",
			}),
		]);

		expect(report.positions[0].issues.map((issue) => issue.flag)).toContain(
			"income-without-trades",
		);
		expect(report.incomeOnly).toHaveLength(1);
	});

	it("flags an impossible cash balance even when the positions look clean", () => {
		// I5: Σ net cash per account is its uninvested balance, so a negative
		// residual can only mean rows are missing.
		const report = buildPositions([
			funding(100),
			trade({ quantity: 10, unitPrice: 50, transactionDate: "2026-01-02" }),
		]);

		expect(report.byAccount[0].historyConfidence).toBe("suspect");
		expect(report.byAccount[0].historyReasons.join(" ")).toContain(
			"activity is missing",
		);
	});

	it("doesn't call a drawn margin account incomplete", () => {
		const report = buildPositions([
			makeActivity({
				accountType: "Non-registered margin",
				activitySubType: "TRANSFER",
				description: "Money transfer out of the account",
				netCashAmount: -500,
				quantity: -500,
			}),
		]);

		expect(report.byAccount[0].historyConfidence).toBe("complete");
	});

	it("orders same-day rows by timestamp when the export provides one", () => {
		// Newer exports carry `effective_at`, so a same-day sell that genuinely
		// preceded its buy is walked in that order rather than reordered by the
		// buys-first convention the date-only format forces.
		const report = buildPositions([
			funding(1000),
			trade({
				effectiveAt: "2026-05-01T09:30:00-04:00",
				quantity: 10,
				transactionDate: "2026-05-01",
				unitPrice: 10,
			}),
			trade({
				effectiveAt: "2026-05-01T15:45:00-04:00",
				quantity: -10,
				transactionDate: "2026-05-01",
				unitPrice: 12,
			}),
		]);

		expect(report.positions[0].issues).toEqual([]);
		expect(report.positions[0].realizedPnl).toBeCloseTo(20, 6);
	});

	it("leaves a complete account alone", () => {
		const report = buildPositions([
			funding(1000),
			trade({ quantity: 10, unitPrice: 10, transactionDate: "2026-01-02" }),
			trade({ quantity: -4, transactionDate: "2026-03-02", unitPrice: 12 }),
		]);

		expect(report.byAccount[0].historyConfidence).toBe("complete");
		expect(report.byAccount[0].historyReasons).toEqual([]);
		expect(report.issues).toEqual([]);
		expect(report.positions[0].issues).toEqual([]);
	});
});

describe("listing inference", () => {
	it("reads US-listed from an FX marker on any one row", () => {
		expect(
			detectListing([
				makeActivity({ description: "VTI - Fund: Bought 1 shares" }),
				makeActivity({
					description: "VTI - Fund: Bought 1 shares, FX Rate: 1.3601",
				}),
			]),
		).toBe("us");
	});

	it("reads Canadian-listed when no row carries an FX marker", () => {
		expect(
			detectListing([makeActivity({ description: "ZAG - Fund: Bought 1" })]),
		).toBe("ca");
	});

	it("lets the crypto account win over the FX marker", () => {
		expect(
			detectListing([
				makeActivity({
					accountType: "Crypto",
					description: "Purchase of 0.0001 BTC, FX Rate: 1.3942",
				}),
			]),
		).toBe("crypto");
	});

	it("parses the FX rate and returns null when there isn't one", () => {
		expect(
			extractFxRate(
				"Bought 1 shares (executed at 2026-07-30), FX Rate: 1.3601",
			),
		).toBe(1.3601);
		expect(
			extractFxRate("Bought 1 shares (executed at 2026-07-30)"),
		).toBeNull();
	});
});

describe("ordering and grouping", () => {
	it("processes same-day buys before sells", () => {
		// §1.2: rows within a date are not in execution order, so a rebalance can
		// list the sells first. Processing them in file order would report a sale
		// larger than the holding.
		const report = buildPositions([
			funding(1000),
			trade({ quantity: -10, transactionDate: "2026-05-01", unitPrice: 12 }),
			trade({ quantity: 10, transactionDate: "2026-05-01", unitPrice: 10 }),
		]);

		expect(report.positions[0].issues).toEqual([]);
		expect(report.positions[0].shares).toBe(0);
		expect(report.positions[0].realizedPnl).toBeCloseTo(20, 6);
	});

	it("groups on symbol, not on the dirty name field", () => {
		const position = onlyPosition([
			funding(1000),
			trade({
				name: "BMO Aggregate Bond Index ETF ",
				quantity: 10,
				transactionDate: "2026-01-02",
				unitPrice: 10,
			}),
			trade({
				name: "BMO Aggregate Bond Index ETF",
				quantity: 10,
				transactionDate: "2026-01-03",
				unitPrice: 10,
			}),
		]);

		expect(position.shares).toBe(20);
		expect(position.name).toBe("BMO Aggregate Bond Index ETF");
	});

	it("rolls three accounts of one type into a single type row", () => {
		const inAccount = (accountId: string) => [
			funding(1000, { accountId }),
			trade({
				accountId,
				quantity: 10,
				transactionDate: "2026-01-02",
				unitPrice: 10,
			}),
		];

		const report = buildPositions([
			...inAccount("TFSA0001CAD"),
			...inAccount("TFSA0002CAD"),
			...inAccount("TFSA0003CAD"),
		]);

		expect(report.byAccount).toHaveLength(3);
		expect(report.byAccountType).toHaveLength(1);
		expect(report.byAccountType[0].accountType).toBe("TFSA");
		expect(report.byAccountType[0].bookCost).toBeCloseTo(300, 6);
		expect(report.byAccountType[0].bookCostByListing.ca).toBeCloseTo(300, 6);
	});
});

describe("account figures", () => {
	it("reports fees net of refunds and tax as a positive magnitude", () => {
		const report = buildPositions([
			funding(1000),
			makeActivity({
				activitySubType: null,
				activityType: "Fee",
				description: "Management fee",
				netCashAmount: -10,
				quantity: -10,
			}),
			makeActivity({
				activitySubType: "MANAGEMENT_FEE_REFUND",
				activityType: "AdministrativePayment",
				description: "CAD credited",
				netCashAmount: 2.5,
				quantity: 2.5,
			}),
			makeActivity({
				activitySubType: "NRT",
				activityType: "Tax",
				description: "Non-resident tax",
				netCashAmount: -4,
				quantity: -4,
			}),
		]);

		expect(report.byAccount[0].fees).toBeCloseTo(7.5, 6);
		expect(report.byAccount[0].withholdingTax).toBeCloseTo(4, 6);
		expect(report.totals.cashBalance).toBeCloseTo(988.5, 6);
	});
});

describe("realisations", () => {
	it("dates each realised gain to the sale that produced it", () => {
		const report = buildPositions([
			funding(1000),
			trade({ quantity: 10, transactionDate: "2025-03-01", unitPrice: 10 }),
			trade({ quantity: -4, transactionDate: "2025-09-01", unitPrice: 15 }),
			trade({ quantity: -6, transactionDate: "2026-04-01", unitPrice: 20 }),
		]);

		// Cost released at the pool average of $10: 4 shares at $15 realises $20,
		// then the closing 6 at $20 realises $60.
		expect(report.realizations).toHaveLength(2);
		expect(report.realizations[0]).toMatchObject({
			accountId: "TEST0001CAD",
			accountType: "TFSA",
			date: "2025-09-01",
			symbol: "ZAG",
		});
		expect(report.realizations[0].amount).toBeCloseTo(20, 6);
		expect(report.realizations[1].date).toBe("2026-04-01");
		expect(report.realizations[1].amount).toBeCloseTo(60, 6);
	});

	it("sums to the same realised gain the position reports", () => {
		// The invariant that lets a per-year table trust this log: splitting a
		// figure by date must not change the figure.
		const report = buildPositions([
			funding(5000),
			trade({ quantity: 10, transactionDate: "2025-03-01", unitPrice: 10 }),
			trade({ quantity: -4, transactionDate: "2025-09-01", unitPrice: 15 }),
			trade({ quantity: 5, transactionDate: "2025-11-01", unitPrice: 12 }),
			trade({ quantity: -11, transactionDate: "2026-04-01", unitPrice: 20 }),
			trade({
				quantity: 3,
				symbol: "VTI",
				transactionDate: "2026-05-01",
				unitPrice: 100,
			}),
			trade({
				quantity: -1,
				symbol: "VTI",
				transactionDate: "2026-06-01",
				unitPrice: 130,
			}),
		]);

		const logged = report.realizations.reduce(
			(total, event) => total + event.amount,
			0,
		);
		expect(logged).toBeCloseTo(report.totals.realizedPnl, 6);

		for (const position of report.positions) {
			const forSymbol = report.realizations
				.filter((event) => event.symbol === position.symbol)
				.reduce((total, event) => total + event.amount, 0);
			expect(forSymbol).toBeCloseTo(position.realizedPnl, 6);
		}
	});

	it("logs nothing when nothing has been sold", () => {
		const report = buildPositions([
			funding(1000),
			trade({ quantity: 10, unitPrice: 10 }),
		]);

		expect(report.realizations).toEqual([]);
	});

	it("runs oldest first", () => {
		const report = buildPositions([
			funding(5000),
			trade({ quantity: 10, transactionDate: "2024-01-02", unitPrice: 10 }),
			trade({ quantity: -2, transactionDate: "2026-05-01", unitPrice: 15 }),
			trade({ quantity: -2, transactionDate: "2024-06-01", unitPrice: 12 }),
			trade({ quantity: -2, transactionDate: "2025-02-01", unitPrice: 14 }),
		]);

		const dates = report.realizations.map((event) => event.date);
		expect(dates).toEqual([...dates].sort());
	});
});

describe("closing write-off date", () => {
	it("dates the closing write-off to the sale that closed the position", () => {
		// Characterization: a sale that exactly zeroes the pool already carries
		// the right date on its own realisation, before and after the fix.
		const report = buildPositions([
			funding(1000),
			trade({ quantity: 10, transactionDate: "2025-01-10", unitPrice: 10 }),
			trade({ quantity: -10, transactionDate: "2025-06-15", unitPrice: 12 }),
		]);

		const closing = report.realizations.at(-1);
		expect(closing?.date).toBe("2025-06-15");
	});

	it("dates the closing write-off to the corporate action that zeroed the shares, not the last trade", () => {
		// The bug: the buy is the only trade, so `lastTradeDate` stays stuck in
		// year A. The unpaired correction two years later is what actually closes
		// the position, and the write-off belongs in year B.
		const report = buildPositions([
			funding(1000),
			trade({ quantity: 10, unitPrice: 10, transactionDate: "2024-02-01" }),
			makeActivity({
				activitySubType: "NAME_CHANGE",
				activityType: "LegacyCorporateAction",
				description: "ZAG - Fund: Corrected quantity of shares by -10",
				netCashAmount: 0,
				quantity: -10,
				symbol: "ZAG",
				transactionDate: "2026-03-01",
			}),
		]);
		const position = report.positions[0];

		expect(position.shares).toBe(0);
		expect(position.issues.map((issue) => issue.flag)).toContain(
			"corporate-action-unpaired",
		);

		const closing = report.realizations.at(-1);
		expect(closing?.date).toBe("2026-03-01");
	});

	it("lands the closing write-off in the corporate action's year, not the last trade's, once bucketed by yearAccountStats", () => {
		const activities = [
			funding(1000),
			trade({ quantity: 10, unitPrice: 10, transactionDate: "2024-02-01" }),
			makeActivity({
				activitySubType: "NAME_CHANGE",
				activityType: "LegacyCorporateAction",
				description: "ZAG - Fund: Corrected quantity of shares by -10",
				netCashAmount: 0,
				quantity: -10,
				symbol: "ZAG",
				transactionDate: "2026-03-01",
			}),
		];
		const report = buildPositions(activities);
		const coverage: Coverage = { start: "2024-01-01", end: "2026-12-31" };
		const rows = yearAccountStats(activities, report, coverage);

		const rowA = rows.find(
			(row) => row.year === "2024" && row.accountType === "TFSA",
		);
		const rowB = rows.find(
			(row) => row.year === "2026" && row.accountType === "TFSA",
		);

		expect(rowB?.earned.realized).toBeCloseTo(-100, 6);
		expect(rowA?.earned.realized ?? 0).toBeCloseTo(0, 6);
	});

	it("dates the closing write-off to the corporate action, not a dividend that arrived after the last trade", () => {
		// Proves the field tracks the row that actually closed the pool, not
		// merely "any later row": the dividend sits between the trade and the
		// closing correction, and must not be mistaken for the closing event.
		const report = buildPositions([
			funding(1000),
			trade({ quantity: 10, unitPrice: 10, transactionDate: "2024-02-01" }),
			makeActivity({
				activityType: "Dividend",
				activitySubType: "DIV",
				description: "ZAG - Fund: Cash distribution",
				netCashAmount: 5,
				quantity: 5,
				symbol: "ZAG",
				transactionDate: "2024-06-01",
			}),
			makeActivity({
				activitySubType: "NAME_CHANGE",
				activityType: "LegacyCorporateAction",
				description: "ZAG - Fund: Corrected quantity of shares by -10",
				netCashAmount: 0,
				quantity: -10,
				symbol: "ZAG",
				transactionDate: "2026-03-01",
			}),
		]);

		const closing = report.realizations.at(-1);
		expect(closing?.date).toBe("2026-03-01");
		expect(closing?.date).not.toBe("2024-06-01");
	});

	it("keeps the realisation-sum invariant on the corporate-action-closed fixture", () => {
		// Same safety net as `positions.test.ts:622-626`, re-run on the fixture
		// this plan is fixing — amounts must not move, only dates.
		const report = buildPositions([
			funding(1000),
			trade({ quantity: 10, unitPrice: 10, transactionDate: "2024-02-01" }),
			makeActivity({
				activitySubType: "NAME_CHANGE",
				activityType: "LegacyCorporateAction",
				description: "ZAG - Fund: Corrected quantity of shares by -10",
				netCashAmount: 0,
				quantity: -10,
				symbol: "ZAG",
				transactionDate: "2026-03-01",
			}),
		]);

		const logged = report.realizations.reduce(
			(total, event) => total + event.amount,
			0,
		);
		expect(logged).toBeCloseTo(report.totals.realizedPnl, 6);

		for (const position of report.positions) {
			const forSymbol = report.realizations
				.filter((event) => event.symbol === position.symbol)
				.reduce((total, event) => total + event.amount, 0);
			expect(forSymbol).toBeCloseTo(position.realizedPnl, 6);
		}
	});
});

describe("normalizeName", () => {
	it("collapses non-breaking spaces and trailing whitespace", () => {
		expect(normalizeName("2U Inc.  ")).toBe("2U Inc.");
		expect(normalizeName("   ")).toBeNull();
		expect(normalizeName(null)).toBeNull();
	});
});
