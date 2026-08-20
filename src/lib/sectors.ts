import type { SecurityProfileResult } from "@/lib/live-prices";
import {
	MONEY_EPSILON,
	type Position,
	type PositionsReport,
} from "@/lib/positions";
import { type PriceSnapshot, valuePosition } from "@/lib/price-snapshot";

/**
 * What a holding is invested in, not just what it's worth.
 *
 * The export carries no security metadata beyond ticker and name
 * (`docs/wealthsimple-csv-format.md` §8), so this is entirely an overlay on
 * top of Yahoo's classification — exactly the way `price-snapshot.ts` overlays
 * a price without touching a share count or a book cost. Nothing here changes
 * a `Position`.
 *
 * Two things make this harder than it looks:
 *
 * 1. **A fund reports no sector of its own.** `assetProfile.sector` is null
 *    for every ETF checked; what a fund carries instead is
 *    `sectorWeights`, the mix of what it holds. Attributing a fund to a
 *    single sector (its category, "Large Blend") and attributing it by
 *    look-through (38.6% technology, 11.4% financial services, …) are two
 *    different questions with two different answers — `view` picks which one
 *    this function answers.
 * 2. **Fund weights are normalized to the equity sleeve, not the fund.**
 *    `VFV.TO`'s `sectorWeights` sum to exactly 1.0000 while its
 *    `stockPosition` is 0.9957 — the rest sits in cash and "other". A weight
 *    applied to a holding's full value without scaling by `stockPosition`
 *    first hands that remainder to the sectors for free, and the breakdown
 *    stops reconciling with what the holding is actually worth.
 */

export type FundView = "look-through" | "fund";

/** Profiles keyed by the export's own symbol — the same key a snapshot uses. */
export type SecurityProfiles = Record<string, SecurityProfileResult>;

/**
 * One profile as kept in `usePriceStore`, with the clock a repeat visit needs.
 *
 * A profile barely changes — a company's sector essentially never does, and a
 * fund's weights drift quarterly — which is what makes this worth persisting
 * at all: `symbolsNeedingProfiles` is the difference between a repeat fetch
 * costing zero upstream requests and costing one per holding, every time.
 *
 * `profile` is null for a confirmed miss — a symbol Yahoo couldn't classify.
 * That answer barely changes either, so it's cached exactly like a real
 * profile and ages out on the same clock; without this, an unclassifiable
 * symbol (a bond, a wrong ticker guess) would be re-requested from Yahoo on
 * every single fetch, forever, since `symbolsNeedingProfiles` would never see
 * a stored entry for it.
 */
export interface StoredProfile {
	profile: SecurityProfileResult | null;
	/** ISO instant this symbol was fetched, not when the batch around it was. */
	fetchedAt: string;
}

/** The persisted set, keyed by the export's own symbol. */
export type ProfileStore = Record<string, StoredProfile>;

/** How long a stored profile is trusted before it's worth asking Yahoo again. */
export const PROFILE_MAX_AGE_DAYS = 30;

/**
 * The symbols worth asking Yahoo about: held now, and either never profiled or
 * profiled longer ago than `maxAgeDays`.
 *
 * This is the request-shrinking step the plan calls for — without it, clicking
 * "Fetch live prices" would re-profile every holding on every visit, for data
 * that essentially never changes.
 */
export function symbolsNeedingProfiles(
	symbols: string[],
	store: ProfileStore | null,
	now = new Date(),
	maxAgeDays = PROFILE_MAX_AGE_DAYS,
): string[] {
	const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
	return symbols.filter((symbol) => {
		const entry = store?.[symbol];
		if (!entry) return true;
		return new Date(entry.fetchedAt).getTime() < cutoff;
	});
}

/**
 * Flattens a `ProfileStore` to the plain map `breakdownBySector` reads —
 * staleness is the store's concern, not the breakdown's. A cached miss
 * (`entry.profile === null`) is dropped rather than passed through: the
 * absence of an entry is exactly what makes `breakdownBySector` fall through
 * to "Unclassified", which is the correct read for a confirmed miss.
 */
export function flattenProfileStore(
	store: ProfileStore | null,
): SecurityProfiles {
	if (!store) return {};
	const flat: SecurityProfiles = {};
	for (const [symbol, entry] of Object.entries(store)) {
		if (entry.profile) flat[symbol] = entry.profile;
	}
	return flat;
}

/** Yahoo's `sectorKey` vocabulary, in the display text this app shows. */
const SECTOR_LABELS: Record<string, string> = {
	basic_materials: "Basic materials",
	communication_services: "Communication services",
	consumer_cyclical: "Consumer cyclical",
	consumer_defensive: "Consumer defensive",
	energy: "Energy",
	financial_services: "Financial services",
	healthcare: "Healthcare",
	industrials: "Industrials",
	realestate: "Real estate",
	technology: "Technology",
	utilities: "Utilities",
};

/**
 * What a slice fundamentally *is*, independent of its label. `"sector"` is
 * one of the eleven Yahoo sector keys; `"fundCategory"` is a "by fund" row
 * (an open-ended label, not one of the eleven); the rest are the buckets
 * outside the sector taxonomy entirely. The UI reads this to decide how to
 * render each slice — colour included, but that's its concern, documented
 * where it's decided (`sector-breakdown.tsx`), not here.
 */
export type SliceKind =
	| "sector"
	| "fundCategory"
	| "crypto"
	| "bonds"
	| "cash"
	| "fundRemainder"
	| "unclassified";

const CRYPTO: SliceIdentity = {
	key: "crypto",
	kind: "crypto",
	label: "Crypto",
};
const BONDS: SliceIdentity = { key: "bonds", kind: "bonds", label: "Bonds" };
const CASH: SliceIdentity = { key: "cash", kind: "cash", label: "Cash" };
const FUND_REMAINDER: SliceIdentity = {
	key: "other",
	kind: "fundRemainder",
	label: "Other fund assets",
};
const UNCLASSIFIED: SliceIdentity = {
	key: "unclassified",
	kind: "unclassified",
	label: "Unclassified",
};

interface SliceIdentity {
	key: string;
	label: string;
	kind: SliceKind;
}

/**
 * One holding's contribution to a slice — the answer to "which stocks are
 * actually in here". A direct equity contributes its whole value to one
 * slice; a fund contributes a fraction of its value, split across several.
 */
export interface SliceHolding {
	symbol: string;
	name: string | null;
	amount: number;
	/** Real industry, for a directly-held equity. Null for everything else —
	 * Yahoo publishes a fund's sector mix, never what sits inside each sector,
	 * so there is nothing honest to put here for a fund-derived amount. */
	industry: string | null;
	/** True when this amount passed through a fund's look-through rather than
	 * being held directly. */
	viaFund: boolean;
}

export interface SectorSlice {
	key: string;
	label: string;
	kind: SliceKind;
	amount: number;
	/** Of the breakdown's `total` — 0 to 1. */
	share: number;
	/** Every holding that contributed dollars here, descending by amount. */
	holdings: SliceHolding[];
}

export interface SectorBreakdown {
	/** Descending by amount. */
	slices: SectorSlice[];
	/** "market" once any holding in the report is priced, "book" otherwise. */
	basis: "book" | "market";
	total: number;
	/** Symbols with no usable classification — named, not folded away. */
	unclassifiedSymbols: string[];
}

interface Bucket {
	key: string;
	label: string;
	kind: SliceKind;
	amount: number;
	holdings: Map<string, SliceHolding>;
}

/**
 * Below this, a contribution is float noise rather than money — a fund with a
 * sector weight of `0` would otherwise still leave a $0.00 row behind. Same
 * threshold `positions.ts` uses for "close enough to zero not to exist".
 */
const AMOUNT_EPSILON = MONEY_EPSILON;

/**
 * Groups every open holding's value by sector (or, in `"fund"` view, by fund
 * category for anything that is one), and keeps the individual holdings that
 * make up each slice so a reader can see what's actually behind the number.
 *
 * Valued the way `valueWith` values a holding: market price when the snapshot
 * has one for this symbol, book cost otherwise — a symbol the snapshot missed
 * is counted at what was paid for it, never dropped. `basis` describes the
 * report as a whole; individual symbols can still fall back within it.
 */
export function breakdownBySector(
	report: PositionsReport,
	profiles: SecurityProfiles,
	snapshot: PriceSnapshot | null,
	view: FundView,
): SectorBreakdown {
	const buckets = new Map<string, Bucket>();
	const unclassified = new Set<string>();
	let total = 0;
	// Whether the snapshot actually priced anything *in this report* — not
	// just whether a snapshot exists. A global snapshot can price other
	// accounts' holdings and none of this one's, which is routine on the
	// account-scoped pages; `basis` below has to reflect that, not just the
	// snapshot's presence.
	let anyPriced = false;

	for (const position of report.open) {
		const { marketValue, bookCost } = valuePosition(position, snapshot);
		if (marketValue !== null) anyPriced = true;
		const value = marketValue ?? bookCost;
		if (value <= 0) continue;
		total += value;

		if (position.listing === "crypto") {
			// Yahoo returns nothing at all for a `CRYPTOCURRENCY` quote type — no
			// sector, no category — so this is classified from the export's own
			// `listing` rather than waiting on a profile that will never help.
			addHolding(buckets, CRYPTO, position, value, null, false);
			continue;
		}

		const profile = profiles[position.symbol];
		if (!profile) {
			unclassified.add(position.symbol);
			addHolding(buckets, UNCLASSIFIED, position, value, null, false);
			continue;
		}

		if (profile.kind === "equity" && profile.sectorKey) {
			const identity = sectorIdentity(profile.sectorKey);
			addHolding(buckets, identity, position, value, profile.industry, false);
			continue;
		}

		if (profile.kind === "fund") {
			if (view === "fund") {
				const label = profile.categoryName ?? profile.family ?? "Fund";
				addHolding(
					buckets,
					{ key: fundKey(label), kind: "fundCategory", label },
					position,
					value,
					null,
					false,
				);
				continue;
			}

			if (explodeFund(buckets, position, value, profile)) continue;
		}

		// A fund with no usable weights, an equity Yahoo priced but didn't
		// sector, a bond, an index — every case Yahoo's classification doesn't
		// reach lands here, named rather than guessed at.
		unclassified.add(position.symbol);
		addHolding(buckets, UNCLASSIFIED, position, value, null, false);
	}

	const slices = [...buckets.values()]
		.filter((bucket) => bucket.amount > AMOUNT_EPSILON)
		.map(
			(bucket): SectorSlice => ({
				amount: round(bucket.amount),
				holdings: [...bucket.holdings.values()]
					.filter((holding) => holding.amount > AMOUNT_EPSILON)
					.map((holding) => ({ ...holding, amount: round(holding.amount) }))
					.sort((a, b) => b.amount - a.amount),
				key: bucket.key,
				kind: bucket.kind,
				label: bucket.label,
				share: total > 0 ? bucket.amount / total : 0,
			}),
		)
		.sort((a, b) => b.amount - a.amount);

	return {
		basis: anyPriced ? "market" : "book",
		slices,
		total: round(total),
		unclassifiedSymbols: [...unclassified].sort(),
	};
}

function sectorIdentity(sectorKey: string): SliceIdentity {
	return {
		key: sectorKey,
		kind: "sector",
		label: SECTOR_LABELS[sectorKey] ?? sectorKey,
	};
}

/** A fund category as a slice key, so two categories with the same display
 * text never collide with a same-named sector or with each other by accident. */
function fundKey(label: string): string {
	return `fund:${label}`;
}

/**
 * Splits a fund's value across sectors by look-through weight, plus its
 * bond/cash/"other" sleeves — and a residual for whatever those don't cover,
 * so the split always accounts for the fund's full value even when Yahoo
 * reports a sleeve (preferred, convertible) this app doesn't track, or omits
 * a sector from `sectorWeights` entirely.
 *
 * Returns `false`, doing nothing, when the fund has no weights to split by —
 * the caller falls through to "Unclassified" in that case.
 */
function explodeFund(
	buckets: Map<string, Bucket>,
	position: Position,
	value: number,
	profile: SecurityProfileResult,
): boolean {
	if (!profile.sectorWeights) return false;

	const stock = profile.stockPosition ?? 0;
	// Tracked because `sectorWeights` is not guaranteed to sum to 1 — a fund
	// where Yahoo omits a sector still has to have its full value land
	// somewhere, and `stock` alone (rather than `stock * weightsSum`) as the
	// "covered by sectors" fraction below would count the shortfall as
	// distributed when it never was, silently dropping it from the total.
	let weightsSum = 0;
	for (const [sectorKey, weight] of Object.entries(profile.sectorWeights)) {
		weightsSum += weight;
		const identity = sectorIdentity(sectorKey);
		addHolding(buckets, identity, position, value * stock * weight, null, true);
	}

	const bond = profile.bondPosition ?? 0;
	if (bond > 0) addHolding(buckets, BONDS, position, value * bond, null, true);

	const cash = profile.cashPosition ?? 0;
	if (cash > 0) addHolding(buckets, CASH, position, value * cash, null, true);

	const other = profile.otherPosition ?? 0;
	if (other > 0) {
		addHolding(buckets, FUND_REMAINDER, position, value * other, null, true);
	}

	// Whatever the sector weights, bond, cash and other sleeves don't cover —
	// an unweighted sector, or a preferred/convertible allocation this app
	// doesn't ask Yahoo for — still belongs to the fund's value. Folding it
	// into the same remainder bucket keeps the total reconciling without
	// inventing a sector for it.
	const covered = stock * weightsSum + bond + cash + other;
	const residual = value * Math.max(0, 1 - covered);
	if (residual > 0) {
		addHolding(buckets, FUND_REMAINDER, position, residual, null, true);
	}

	return true;
}

/** Adds one holding's contribution to a slice, merging into the same symbol's
 * row when this is the second account (or the second sleeve) it came from. */
function addHolding(
	buckets: Map<string, Bucket>,
	identity: SliceIdentity,
	position: Position,
	amount: number,
	industry: string | null,
	viaFund: boolean,
): void {
	if (amount <= 0) return;

	const target = bucket(buckets, identity);
	target.amount += amount;

	const existing = target.holdings.get(position.symbol);
	if (existing) {
		existing.amount += amount;
		return;
	}

	target.holdings.set(position.symbol, {
		amount,
		industry,
		name: position.name,
		symbol: position.symbol,
		viaFund,
	});
}

function bucket(buckets: Map<string, Bucket>, identity: SliceIdentity): Bucket {
	let existing = buckets.get(identity.key);
	if (!existing) {
		existing = {
			amount: 0,
			holdings: new Map(),
			key: identity.key,
			kind: identity.kind,
			label: identity.label,
		};
		buckets.set(identity.key, existing);
	}
	return existing;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
