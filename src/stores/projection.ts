"use client";

import { create } from "zustand";
import type { ProjectionInputs } from "@/lib/projection";

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

export const DEFAULT_INPUTS: ProjectionInputs = {
	years: 20,
	// Deliberately unambitious. This is the one number a reader is most likely
	// to leave as they found it, so it should not be a number that flatters.
	annualReturn: 0.06,
	monthlyContribution: 500,
	annualInflation: 0.02,
	withdrawalRate: 0,
};

interface ProjectionState {
	inputs: ProjectionInputs;
	/** Account type -> starting balance, replacing the one derived from the data. */
	overrides: Record<string, number>;
	/** Whether the stored values have been read yet. */
	hydrated: boolean;
	hydrate: () => void;
	setInput: <K extends keyof ProjectionInputs>(
		key: K,
		value: ProjectionInputs[K],
	) => void;
	setOverride: (accountType: string, value: number | null) => void;
	reset: () => void;
}

interface Persisted {
	inputs?: Partial<ProjectionInputs>;
	overrides?: Record<string, number>;
}

function persist(state: Pick<ProjectionState, "inputs" | "overrides">): void {
	try {
		window.localStorage.setItem(
			KEY,
			JSON.stringify({ inputs: state.inputs, overrides: state.overrides }),
		);
	} catch {
		// Private browsing can refuse storage; losing the assumptions on reload
		// is survivable, and the defaults are sane.
	}
}

export const useProjectionStore = create<ProjectionState>((set, get) => ({
	inputs: DEFAULT_INPUTS,
	overrides: {},
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
		) as (keyof ProjectionInputs)[]) {
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

		set({ hydrated: true, inputs, overrides });
	},

	setInput: (key, value) => {
		const inputs = { ...get().inputs, [key]: value };
		set({ inputs });
		persist({ inputs, overrides: get().overrides });
	},

	setOverride: (accountType, value) => {
		const overrides = { ...get().overrides };
		// Null clears the override rather than storing a zero — "back to whatever
		// the files say" and "this account holds nothing" are different answers.
		if (value === null) delete overrides[accountType];
		else overrides[accountType] = value;

		set({ overrides });
		persist({ inputs: get().inputs, overrides });
	},

	reset: () => {
		set({ inputs: DEFAULT_INPUTS, overrides: {} });
		persist({ inputs: DEFAULT_INPUTS, overrides: {} });
	},
}));
