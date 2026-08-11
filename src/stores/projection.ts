"use client";

import { create } from "zustand";
import {
	type ContributionFrequency,
	type ContributionPlan,
	contributionWeights,
	type ProjectionInputs,
	type StartingBalances,
} from "@/lib/projection";

/**
 * The analytics page's assumptions, and any starting balance the reader typed
 * over.
 *
 * `localStorage` rather than IndexedDB, and its own store rather than a corner
 * of the dataset store: this is a handful of numbers describing what the reader
 * wants to *ask*, not anything derived from their files. Rebuilding a merged
 * dataset because someone dragged a slider would be absurd.
 */

const KEY = "ws-analytics:projection";

/**
 * The figures the sliders set: everything in `ProjectionInputs` except the
 * per-account plans, which are held beside them rather than inside them. They
 * are edited a row at a time, they only apply in advanced mode, and keeping
 * them out of here means every value in this record is a plain number.
 */
export type ProjectionRates = Omit<ProjectionInputs, "plans">;

export const DEFAULT_INPUTS: ProjectionRates = {
	years: 30,
	// This is the one number a reader is most likely to leave as they found it,
	// so it is the long-run equity average the slider's own hint quotes rather
	// than anything more optimistic — and that average is before fees.
	annualReturn: 0.07,
	monthlyContribution: 1000,
	annualInflation: 0.02,
	withdrawalRate: 0,
};

/**
 * Which set of contribution controls is in force.
 *
 * Only contributions: the horizon, the rates and the starting balances are the
 * same question either way, so they stay shared and switching tabs never
 * silently changes them.
 */
export type ProjectionMode = "simple" | "advanced";

const FREQUENCIES: ContributionFrequency[] = ["weekly", "biweekly", "monthly"];

interface ProjectionState {
	inputs: ProjectionRates;
	/** Account type -> starting balance, replacing the one derived from the data. */
	overrides: Record<string, number>;
	mode: ProjectionMode;
	/** Account type -> saving plan. Only consulted in advanced mode. */
	plans: Record<string, ContributionPlan>;
	/** Whether the stored values have been read yet. */
	hydrated: boolean;
	hydrate: () => void;
	setInput: <K extends keyof ProjectionRates>(
		key: K,
		value: ProjectionRates[K],
	) => void;
	setOverride: (accountType: string, value: number | null) => void;
	/**
	 * Switching to advanced with `seed` seeds a plan per account from the simple
	 * contribution, but only when there are no plans yet — see `seedPlans`.
	 */
	setMode: (mode: ProjectionMode, seed?: StartingBalances) => void;
	setPlan: (accountType: string, patch: Partial<ContributionPlan>) => void;
	reset: () => void;
}

interface Persisted {
	inputs?: Partial<ProjectionRates>;
	overrides?: Record<string, number>;
	mode?: ProjectionMode;
	plans?: Record<string, unknown>;
}

type PersistedState = Pick<
	ProjectionState,
	"inputs" | "overrides" | "mode" | "plans"
>;

function persist(state: PersistedState): void {
	try {
		window.localStorage.setItem(
			KEY,
			JSON.stringify({
				inputs: state.inputs,
				overrides: state.overrides,
				mode: state.mode,
				plans: state.plans,
			}),
		);
	} catch {
		// Private browsing can refuse storage; losing the assumptions on reload
		// is survivable, and the defaults are sane.
	}
}

/**
 * One plan per account, carrying the simple tab's monthly figure split the way
 * simple mode would have split it.
 *
 * Seeded once, on the first switch, and never re-synced: the point is that the
 * chart doesn't jump and the reader edits real numbers instead of a blank form,
 * not that the two tabs stay tied together afterwards.
 */
function seedPlans(
	starting: StartingBalances,
	monthlyContribution: number,
): Record<string, ContributionPlan> {
	const weights = contributionWeights(starting);
	const plans: Record<string, ContributionPlan> = {};
	for (const [type, weight] of Object.entries(weights)) {
		plans[type] = {
			amount: Math.round(monthlyContribution * weight * 100) / 100,
			frequency: "monthly",
			room: null,
			roomIncrease: 0,
			overflowTo: null,
		};
	}
	return plans;
}

/**
 * A stored plan, read defensively. Anything malformed is dropped rather than
 * projected: this blob outlives the shape that wrote it.
 */
function readPlan(value: unknown): ContributionPlan | null {
	if (typeof value !== "object" || value === null) return null;
	const stored = value as Record<string, unknown>;

	const amount = stored.amount;
	if (typeof amount !== "number" || !Number.isFinite(amount)) return null;

	const room = stored.room;
	const roomIncrease = stored.roomIncrease;
	const overflowTo = stored.overflowTo;

	return {
		amount,
		frequency: FREQUENCIES.includes(stored.frequency as ContributionFrequency)
			? (stored.frequency as ContributionFrequency)
			: "monthly",
		room: typeof room === "number" && Number.isFinite(room) ? room : null,
		// An account whose room can't grow is the ordinary case, so a missing or
		// broken increase means zero rather than dropping the whole plan.
		roomIncrease:
			typeof roomIncrease === "number" && Number.isFinite(roomIncrease)
				? roomIncrease
				: 0,
		overflowTo: typeof overflowTo === "string" ? overflowTo : null,
	};
}

export const useProjectionStore = create<ProjectionState>((set, get) => ({
	inputs: DEFAULT_INPUTS,
	overrides: {},
	mode: "simple",
	plans: {},
	hydrated: false,

	// Read in an effect rather than in the initialiser: touching localStorage
	// during render would make the server and client markup disagree.
	hydrate: () => {
		if (get().hydrated) return;

		let stored: Persisted = {};
		try {
			const raw = window.localStorage.getItem(KEY);
			if (raw) stored = JSON.parse(raw) as Persisted;
		} catch {
			// Unreadable or malformed: fall through to the defaults rather than
			// leaving the page unable to render.
		}

		// Merged onto the defaults key by key, so a stored blob written before a
		// new input existed doesn't leave that input undefined.
		const inputs = { ...DEFAULT_INPUTS };
		for (const key of Object.keys(
			DEFAULT_INPUTS,
		) as (keyof ProjectionRates)[]) {
			const value = stored.inputs?.[key];
			if (typeof value === "number" && Number.isFinite(value)) {
				inputs[key] = value;
			}
		}

		const overrides: Record<string, number> = {};
		for (const [type, value] of Object.entries(stored.overrides ?? {})) {
			if (typeof value === "number" && Number.isFinite(value)) {
				overrides[type] = value;
			}
		}

		const plans: Record<string, ContributionPlan> = {};
		for (const [type, value] of Object.entries(stored.plans ?? {})) {
			const plan = readPlan(value);
			if (plan) plans[type] = plan;
		}

		set({
			hydrated: true,
			inputs,
			overrides,
			mode: stored.mode === "advanced" ? "advanced" : "simple",
			plans,
		});
	},

	setInput: (key, value) => {
		const inputs = { ...get().inputs, [key]: value };
		set({ inputs });
		persist({ ...get(), inputs });
	},

	setOverride: (accountType, value) => {
		const overrides = { ...get().overrides };
		// Null clears the override rather than storing a zero — "back to whatever
		// the files say" and "this account holds nothing" are different answers.
		if (value === null) delete overrides[accountType];
		else overrides[accountType] = value;

		set({ overrides });
		persist({ ...get(), overrides });
	},

	setMode: (mode, seed) => {
		const state = get();
		const plans =
			mode === "advanced" &&
			seed &&
			Object.keys(state.plans).length === 0 &&
			Object.keys(seed).length > 0
				? seedPlans(seed, state.inputs.monthlyContribution)
				: state.plans;

		set({ mode, plans });
		persist({ ...state, mode, plans });
	},

	setPlan: (accountType, patch) => {
		const current = get().plans[accountType] ?? {
			amount: 0,
			frequency: "monthly" as const,
			room: null,
			roomIncrease: 0,
			overflowTo: null,
		};
		const plans = { ...get().plans, [accountType]: { ...current, ...patch } };

		set({ plans });
		persist({ ...get(), plans });
	},

	reset: () => {
		const cleared: PersistedState = {
			inputs: DEFAULT_INPUTS,
			overrides: {},
			mode: "simple",
			plans: {},
		};
		set(cleared);
		persist(cleared);
	},
}));
