import { describe, expect, it } from "vitest";
import type { SecurityProfileResult } from "@/lib/live-prices";
import { buildPositions } from "@/lib/positions";
import type { PriceSnapshot } from "@/lib/price-snapshot";
import {
	breakdownBySector,
	type ProfileStore,
	type SecurityProfiles,
	symbolsNeedingProfiles,
} from "@/lib/sectors";
import type { Activity } from "@/lib/wealthsimple";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
	return {
		transactionDate: "2026-01-15",
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
	overrides: Partial<Activity> & {
		symbol: string;
		quantity: number;
		unitPrice: number;
	},
): Activity {
	return makeActivity({
		activitySubType: overrides.quantity > 0 ? "BUY" : "SELL",
		activityType: "Trade",
		description: `${overrides.symbol} - Fund: ${overrides.quantity > 0 ? "Bought" : "Sold"} shares`,
		name: overrides.symbol,
		...overrides,
		netCashAmount: -(overrides.quantity * overrides.unitPrice),
	});
}

/**
 * One directly-held equity (AAPL, Technology / Consumer Electronics), one
 * broad-market fund (VFV, look-through into eleven sectors), and one crypto
 * holding — bought at book cost that stays deliberately round, so a test can
 * check a dollar figure by eye rather than trusting the arithmetic it's
 * verifying.
 */
const ACTIVITIES: Activity[] = [
	makeActivity({ netCashAmount: 100_000, quantity: 100_000 }),
	trade({ quantity: 10, symbol: "AAPL", unitPrice: 150 }), // $1,500 book cost
	trade({ quantity: 10, symbol: "VFV", unitPrice: 100 }), // $1,000 book cost
	trade({
		accountId: "Crypto0001CAD",
		accountType: "Crypto",
		quantity: 1,
		symbol: "BTC",
		unitPrice: 500,
	}), // $500 book cost
];

const REPORT = buildPositions(ACTIVITIES);

/** Yahoo's real VFV.TO response, trimmed to the fields this app reads. */
const VFV_PROFILE: SecurityProfileResult = {
	bondPosition: 0,
	cashPosition: 0.0022,
	categoryName: null,
	family: "Vanguard Investments Canada Inc",
	industry: null,
	kind: "fund",
	otherPosition: 0.002,
	sector: null,
	sectorKey: null,
	sectorWeights: {
		basic_materials: 0.0166,
		communication_services: 0.0991,
		consumer_cyclical: 0.0951,
		consumer_defensive: 0.0453,
		energy: 0.0298,
		financial_services: 0.1141,
		healthcare: 0.089,
		industrials: 0.0846,
		realestate: 0.0183,
		technology: 0.3861,
		utilities: 0.022,
	},
	stockPosition: 0.9957,
	symbol: "VFV",
	ticker: "VFV.TO",
};

const AAPL_PROFILE: SecurityProfileResult = {
	bondPosition: null,
	cashPosition: null,
	categoryName: null,
	family: null,
	industry: "Consumer Electronics",
	kind: "equity",
	otherPosition: null,
	sector: "Technology",
	sectorKey: "technology",
	sectorWeights: null,
	stockPosition: null,
	symbol: "AAPL",
	ticker: "AAPL",
};

const PROFILES: SecurityProfiles = { AAPL: AAPL_PROFILE, VFV: VFV_PROFILE };

function snapshotAt(pricesCad: Record<string, number>): PriceSnapshot {
	return {
		asOf: "2026-08-19",
		matched: Object.keys(pricesCad),
		pricesCad,
		source: "yahoo",
		unpriced: [],
	};
}

describe("breakdownBySector", () => {
	it("uses book cost with no snapshot, and reports basis accordingly", () => {
		const result = breakdownBySector(REPORT, PROFILES, null, "look-through");

		expect(result.basis).toBe("book");
		// $1,500 AAPL + $1,000 VFV + $500 BTC.
		expect(result.total).toBeCloseTo(3000, 2);
	});

	it("switches to market value once a snapshot prices a holding", () => {
		const snapshot = snapshotAt({ AAPL: 200, VFV: 100 });
		const result = breakdownBySector(
			REPORT,
			PROFILES,
			snapshot,
			"look-through",
		);

		expect(result.basis).toBe("market");
		const technology = result.slices.find((s) => s.key === "technology");
		// AAPL: 10 shares * $200 = $2,000, entirely Technology.
		// VFV look-through technology slice adds on top of that — checked below.
		expect(technology?.amount ?? 0).toBeGreaterThan(2000);
	});

	it("falls back to book cost for a symbol the snapshot didn't price", () => {
		// Snapshot prices AAPL only; VFV must fall back to its $1,000 book cost
		// rather than being dropped, matching `valueWith`'s rule.
		const snapshot = snapshotAt({ AAPL: 200 });
		const result = breakdownBySector(
			REPORT,
			PROFILES,
			snapshot,
			"look-through",
		);

		// AAPL priced at $2,000 + VFV at book cost $1,000 + BTC at book cost $500.
		expect(result.total).toBeCloseTo(3500, 2);
	});

	it("scales a fund's sector weights by its equity sleeve, not its full value", () => {
		const result = breakdownBySector(REPORT, PROFILES, null, "look-through");

		// VFV's book cost is $1,000. Its technology weight is 0.3861 *of the
		// equity sleeve*, and the sleeve itself is only 0.9957 of the fund — so
		// the technology dollars VFV contributes are 1000 * 0.9957 * 0.3861,
		// not 1000 * 0.3861. Getting this wrong (skipping the stockPosition
		// scale) would overstate every sector by the fund's cash and other
		// remainder.
		const technology = result.slices.find((s) => s.key === "technology");
		const fromVfv = 1000 * 0.9957 * 0.3861;
		const fromAapl = 1500; // AAPL's whole book cost is Technology.
		expect(technology?.amount ?? 0).toBeCloseTo(fromVfv + fromAapl, 1);
	});

	it("reconciles every slice, in both fund views and both bases, to the holdings total", () => {
		const snapshot = snapshotAt({ AAPL: 200, VFV: 100 });
		for (const basis of [null, snapshot]) {
			for (const view of ["look-through", "fund"] as const) {
				const result = breakdownBySector(REPORT, PROFILES, basis, view);
				const summed = result.slices.reduce((sum, s) => sum + s.amount, 0);
				expect(summed).toBeCloseTo(result.total, 1);
			}
		}
	});

	it("classifies a fund with cash-only weights entirely as cash", () => {
		const cashProfile: SecurityProfileResult = {
			...VFV_PROFILE,
			bondPosition: 0,
			cashPosition: 1,
			otherPosition: 0,
			sectorWeights: Object.fromEntries(
				Object.keys(VFV_PROFILE.sectorWeights ?? {}).map((key) => [key, 0]),
			),
			stockPosition: 0,
			symbol: "CASH",
			ticker: "CASH.TO",
		};
		const activities: Activity[] = [
			makeActivity({ netCashAmount: 1000, quantity: 1000 }),
			trade({ quantity: 20, symbol: "CASH", unitPrice: 50 }),
		];
		const report = buildPositions(activities);
		const result = breakdownBySector(
			report,
			{ CASH: cashProfile },
			null,
			"look-through",
		);

		const cash = result.slices.find((s) => s.key === "cash");
		expect(cash?.amount).toBeCloseTo(1000, 2);
		expect(result.slices.filter((s) => s.amount > 0)).toHaveLength(1);
	});

	it("names a symbol with no profile as unclassified, at book cost", () => {
		const result = breakdownBySector(
			REPORT,
			{ AAPL: AAPL_PROFILE },
			null,
			"look-through",
		);

		expect(result.unclassifiedSymbols).toEqual(["VFV"]);
		const unclassified = result.slices.find((s) => s.key === "unclassified");
		expect(unclassified?.amount).toBeCloseTo(1000, 2); // VFV's book cost.
	});

	it("classifies crypto from the export's own listing, with no profile at all", () => {
		const result = breakdownBySector(REPORT, PROFILES, null, "look-through");

		const crypto = result.slices.find((s) => s.key === "crypto");
		expect(crypto?.amount).toBeCloseTo(500, 2);
		expect(result.unclassifiedSymbols).not.toContain("BTC");
	});

	it("keeps a fund as one slice in fund view, using categoryName over family", () => {
		const withCategory: SecurityProfileResult = {
			...VFV_PROFILE,
			categoryName: "Large Blend",
		};
		const result = breakdownBySector(
			REPORT,
			{ AAPL: AAPL_PROFILE, VFV: withCategory },
			null,
			"fund",
		);

		const fund = result.slices.find((s) => s.label === "Large Blend");
		expect(fund?.amount).toBeCloseTo(1000, 2);
		// AAPL is held directly, not through a fund, so it still lands in its own
		// sector in fund view — only VFV's dollars collapse into the fund slice.
		const technology = result.slices.find((s) => s.key === "technology");
		expect(technology?.amount).toBeCloseTo(1500, 2);
	});

	it("falls back to family when a fund has no categoryName", () => {
		const result = breakdownBySector(REPORT, PROFILES, null, "fund");

		const fund = result.slices.find(
			(s) => s.label === "Vanguard Investments Canada Inc",
		);
		expect(fund?.amount).toBeCloseTo(1000, 2);
	});

	it("lists the holdings behind a slice — direct equity and fund look-through alike", () => {
		const result = breakdownBySector(REPORT, PROFILES, null, "look-through");

		// VFV's book cost is $1,000, and its technology weight (0.3861) applies
		// to the equity sleeve (stockPosition 0.9957), not the full fund — same
		// scaling the "reconciles" test above checks.
		const fromVfv = Math.round(1000 * 0.9957 * 0.3861 * 100) / 100;
		const technology = result.slices.find((s) => s.key === "technology");

		// AAPL's whole $1,500 book cost outweighs VFV's look-through slice, so
		// it sorts first.
		expect(technology?.holdings).toEqual([
			{
				amount: 1500,
				industry: "Consumer Electronics",
				name: "AAPL",
				symbol: "AAPL",
				viaFund: false,
			},
			{
				amount: fromVfv,
				industry: null,
				name: "VFV",
				symbol: "VFV",
				viaFund: true,
			},
		]);
	});

	it("merges a symbol's contributions across accounts into one holding row", () => {
		const activities: Activity[] = [
			makeActivity({
				accountId: "TFSA0001CAD",
				netCashAmount: 1000,
				quantity: 1000,
			}),
			trade({
				accountId: "TFSA0001CAD",
				quantity: 5,
				symbol: "AAPL",
				unitPrice: 100,
			}),
			makeActivity({
				accountId: "RRSP0001CAD",
				accountType: "RRSP",
				netCashAmount: 1000,
				quantity: 1000,
			}),
			trade({
				accountId: "RRSP0001CAD",
				accountType: "RRSP",
				quantity: 5,
				symbol: "AAPL",
				unitPrice: 100,
			}),
		];
		const report = buildPositions(activities);
		const result = breakdownBySector(
			report,
			{ AAPL: AAPL_PROFILE },
			null,
			"look-through",
		);

		const technology = result.slices.find((s) => s.key === "technology");
		expect(technology?.holdings).toHaveLength(1);
		expect(technology?.holdings[0]?.amount).toBeCloseTo(1000, 2); // 5+5 shares at $100.
	});

	it("routes the shortfall to Other fund assets when sectorWeights don't sum to 1", () => {
		// Every real fund checked (VFV, XEQT, VTI) happens to sum to 1.0000, but
		// nothing guarantees it — Yahoo omitting a sector for some fund is a
		// live possibility, and the split has to still account for the fund's
		// full value when that happens rather than silently dropping the gap.
		const partial: SecurityProfileResult = {
			...VFV_PROFILE,
			bondPosition: 0,
			cashPosition: 0,
			otherPosition: 0,
			sectorWeights: { energy: 0.3, technology: 0.5 }, // sums to 0.8, not 1.
			stockPosition: 1,
			symbol: "PART",
			ticker: "PART.TO",
		};
		const activities: Activity[] = [
			makeActivity({ netCashAmount: 1000, quantity: 1000 }),
			trade({ quantity: 10, symbol: "PART", unitPrice: 100 }),
		];
		const report = buildPositions(activities);
		const result = breakdownBySector(
			report,
			{ PART: partial },
			null,
			"look-through",
		);

		expect(result.total).toBeCloseTo(1000, 2);
		const summed = result.slices.reduce((sum, s) => sum + s.amount, 0);
		expect(summed).toBeCloseTo(result.total, 2); // Nothing lost.

		const remainder = result.slices.find((s) => s.key === "other");
		expect(remainder?.amount).toBeCloseTo(200, 2); // The un-weighted 20%.
		expect(result.slices.find((s) => s.key === "technology")?.amount).toBe(500);
		expect(result.slices.find((s) => s.key === "energy")?.amount).toBe(300);
	});

	it("reports book cost as the basis when the snapshot prices nothing in this report", () => {
		// A snapshot can exist and still price none of *this* report's symbols —
		// routine on an account-scoped page, where the global snapshot prices
		// other accounts' holdings but not this one's. `basis` has to reflect
		// what was actually priced, not just whether a snapshot was passed in.
		const snapshot = snapshotAt({ SOME_OTHER_SYMBOL: 42 });
		const result = breakdownBySector(
			REPORT,
			PROFILES,
			snapshot,
			"look-through",
		);

		expect(result.basis).toBe("book");
	});
});

describe("symbolsNeedingProfiles", () => {
	const NOW = new Date("2026-08-19T00:00:00Z");

	function storeAt(symbol: string, daysAgo: number): ProfileStore {
		const fetchedAt = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
		return {
			[symbol]: { fetchedAt: fetchedAt.toISOString(), profile: null },
		};
	}

	it("asks for a symbol that has never been profiled", () => {
		expect(symbolsNeedingProfiles(["AAPL"], null, NOW)).toEqual(["AAPL"]);
		expect(symbolsNeedingProfiles(["AAPL"], {}, NOW)).toEqual(["AAPL"]);
	});

	it("doesn't ask again for a symbol profiled within the last 30 days", () => {
		const store = storeAt("AAPL", 5);
		expect(symbolsNeedingProfiles(["AAPL"], store, NOW)).toEqual([]);
	});

	it("asks again once a stored profile is older than 30 days", () => {
		// Exactly 30 days old is still fresh — the function's own contract is
		// "profiled longer ago than maxAgeDays", a strict inequality.
		expect(symbolsNeedingProfiles(["AAPL"], storeAt("AAPL", 30), NOW)).toEqual(
			[],
		);
		expect(symbolsNeedingProfiles(["AAPL"], storeAt("AAPL", 31), NOW)).toEqual([
			"AAPL",
		]);
	});

	it("leaves a fresh symbol alone while re-asking for a stale one", () => {
		const store: ProfileStore = {
			...storeAt("FRESH", 1),
			...storeAt("STALE", 45),
		};
		expect(symbolsNeedingProfiles(["FRESH", "STALE"], store, NOW)).toEqual([
			"STALE",
		]);
	});
});
