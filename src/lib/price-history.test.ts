import { describe, expect, it } from "vitest";
import {
	ALL_ACCOUNT_TYPES,
	yearAccountStats,
	yearTotals,
} from "@/lib/analytics";
import { buildPositions } from "@/lib/positions";
import {
	type PriceHistory,
	valuationKey,
	valueYears,
	withValuations,
} from "@/lib/price-history";
import type { Activity } from "@/lib/wealthsimple";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
	return {
		transactionDate: "2024-01-15",
		effectiveAt: null,
		settlementDate: null,
		accountId: "TFSA0001CAD",
		accountType: "TFSA",
		activityType: "MoneyMovement",
		activitySubType: "EFT",
		description: "Deposit",
		symbol: null,
		name: null,
		currency: "CAD",
		quantity: 1000,
		unitPrice: null,
		commission: null,
		netCashAmount: 1000,
		...overrides,
	};
}

function trade(
	overrides: Partial<Activity> & { quantity: number; unitPrice: number },
): Activity {
	const symbol = overrides.symbol ?? "VFV";
	return makeActivity({
		activitySubType: overrides.quantity > 0 ? "BUY" : "SELL",
		activityType: "Trade",
		description: `${symbol} - Fund: ${overrides.quantity > 0 ? "Bought" : "Sold"} shares`,
		name: "Vanguard S&P 500 Index ETF",
		symbol,
		...overrides,
		netCashAmount: -(overrides.quantity * overrides.unitPrice),
	});
}

/**
 * Bought 100 VFV at $100 at the start of 2024 and held. The 2024 close is
 * $120, the 2025 close is $150 — so 2024 gained $2,000 on paper and 2025
 * gained $3,000 more, none of it sold.
 */
const ACTIVITIES: Activity[] = [
	makeActivity({ netCashAmount: 10_000, quantity: 10_000 }),
	trade({ quantity: 100, transactionDate: "2024-01-20", unitPrice: 100 }),
	makeActivity({
		netCashAmount: 50,
		quantity: 50,
		transactionDate: "2025-06-30",
		activityType: "Dividend",
		activitySubType: null,
		description: "VFV - Cash Dividend",
		symbol: "VFV",
	}),
];

const COVERAGE = { start: "2024-01-15", end: "2025-08-10" };

const HISTORY: PriceHistory = {
	fetchedAt: "2025-08-10T12:00:00.000Z",
	source: "yahoo",
	monthlyCad: { VFV: { "2024-12": 120, "2025-08": 150 } },
	unpriced: [],
};

describe("valueYears", () => {
	it("values each year end at that year's own close", () => {
		const valuations = valueYears(ACTIVITIES, HISTORY, COVERAGE);

		expect(valuations.get(valuationKey("2024", "TFSA"))?.marketValue).toBe(
			12_000,
		);
		expect(valuations.get(valuationKey("2025", "TFSA"))?.marketValue).toBe(
			15_000,
		);
	});

	it("reads share counts from the history as it stood at that date", () => {
		// Sold half in 2025, so the 2025 close applies to 50 shares and the 2024
		// close still applies to 100 — the point of re-walking rather than
		// applying today's share count to every past year.
		const sold = [
			...ACTIVITIES,
			trade({ quantity: -50, transactionDate: "2025-07-01", unitPrice: 140 }),
		];
		const valuations = valueYears(sold, HISTORY, COVERAGE);

		expect(valuations.get(valuationKey("2024", "TFSA"))?.marketValue).toBe(
			12_000,
		);
		expect(valuations.get(valuationKey("2025", "TFSA"))?.marketValue).toBe(
			7_500,
		);
	});

	it("measures the unrealised change against the year before", () => {
		const valuations = valueYears(ACTIVITIES, HISTORY, COVERAGE);

		// 2024 opened with nothing held, so its change is the whole paper gain.
		expect(valuations.get(valuationKey("2024", "TFSA"))?.unrealised).toBe(2000);
		expect(valuations.get(valuationKey("2024", "TFSA"))?.unrealisedChange).toBe(
			2000,
		);
		// 2025 carries $5,000 but only $3,000 of it happened that year.
		expect(valuations.get(valuationKey("2025", "TFSA"))?.unrealised).toBe(5000);
		expect(valuations.get(valuationKey("2025", "TFSA"))?.unrealisedChange).toBe(
			3000,
		);
	});

	it("values the current year at the last day the files cover", () => {
		// There is no 31 December 2025 yet, and inventing one would price the
		// portfolio at a date the export doesn't reach.
		expect(valuations2025().asOf).toBe("2025-08-10");
	});

	it("counts cash beside the holdings", () => {
		const valuation = valuations2025();
		// $10,000 in, $10,000 spent on shares, $50 of dividends left in cash.
		expect(valuation.cashBalance).toBe(50);
		expect(valuation.value).toBe(15_050);
	});

	it("holds an unpriced symbol at book cost rather than at zero", () => {
		const valuations = valueYears(
			ACTIVITIES,
			{ ...HISTORY, monthlyCad: {} },
			COVERAGE,
		);
		const valuation = valuations.get(valuationKey("2025", "TFSA"));

		expect(valuation?.missingSymbols).toEqual(["VFV"]);
		expect(valuation?.marketValue).toBe(0);
		// Book cost of the holding, plus the cash — never a wiped-out account.
		expect(valuation?.value).toBe(10_050);
		expect(valuation?.unrealisedChange).toBe(0);
	});

	it("totals every account type into one row per year", () => {
		const withRrsp = [
			...ACTIVITIES,
			makeActivity({
				accountId: "RRSP0001CAD",
				accountType: "RRSP",
				netCashAmount: 5000,
				quantity: 5000,
				transactionDate: "2024-02-01",
			}),
		];
		const valuations = valueYears(withRrsp, HISTORY, COVERAGE);

		const tfsa = valuations.get(valuationKey("2024", "TFSA"));
		const rrsp = valuations.get(valuationKey("2024", "RRSP"));
		const all = valuations.get(valuationKey("2024", ALL_ACCOUNT_TYPES));

		expect(all?.value).toBe((tfsa?.value ?? 0) + (rrsp?.value ?? 0));
	});

	it("values nothing without a history", () => {
		expect(valueYears(ACTIVITIES, null, COVERAGE).size).toBe(0);
	});
});

function valuations2025() {
	const valuation = valueYears(ACTIVITIES, HISTORY, COVERAGE).get(
		valuationKey("2025", "TFSA"),
	);
	if (!valuation) throw new Error("expected a 2025 TFSA valuation");
	return valuation;
}

describe("withValuations", () => {
	const report = buildPositions(ACTIVITIES);

	it("adds the paper gain to what the year paid out in cash", () => {
		const stats = withValuations(
			yearTotals(ACTIVITIES, report, COVERAGE),
			valueYears(ACTIVITIES, HISTORY, COVERAGE),
		);
		const year = stats.find((row) => row.year === "2025");

		// $50 of dividends is what the cash record can prove; the other $3,000 is
		// the holding moving, which is exactly what "Earned" alone can't see.
		expect(year?.earned.total).toBe(50);
		expect(year?.totalReturn).toBe(3050);
	});

	it("leaves the total return null when a year couldn't be valued", () => {
		const stats = withValuations(
			yearTotals(ACTIVITIES, report, COVERAGE),
			new Map(),
		);

		// Null, not equal to `earned` — that would silently claim the unsold
		// holdings did nothing all year.
		expect(stats.every((row) => row.totalReturn === null)).toBe(true);
		expect(stats.every((row) => row.valuation === null)).toBe(true);
	});

	it("joins per account type as well as per year", () => {
		const stats = withValuations(
			yearAccountStats(ACTIVITIES, report, COVERAGE),
			valueYears(ACTIVITIES, HISTORY, COVERAGE),
		);
		const tfsa = stats.find(
			(row) => row.year === "2024" && row.accountType === "TFSA",
		);

		expect(tfsa?.valuation?.value).toBe(12_000);
	});
});
