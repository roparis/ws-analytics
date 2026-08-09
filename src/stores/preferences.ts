"use client";

import { create } from "zustand";

/**
 * Small UI preferences that outlive a page view.
 *
 * Kept out of the dataset store deliberately: that one owns parsed files and
 * rehydrates from IndexedDB, and a preference has no business forcing it to
 * recompute. This is `localStorage` because it is two booleans, not megabytes.
 */

const AMOUNTS_HIDDEN_KEY = "ws-analytics:amounts-hidden";

interface PreferencesState {
	/** Blurs every currency figure, for reading the app in public. */
	amountsHidden: boolean;
	/** Whether the stored preference has been read yet. */
	hydrated: boolean;
	toggleAmounts: () => void;
	hydrate: () => void;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
	amountsHidden: false,
	hydrated: false,

	// Read in an effect rather than in the initialiser: touching localStorage
	// during render would make the server and client markup disagree.
	hydrate: () => {
		if (get().hydrated) return;
		let amountsHidden = false;
		try {
			amountsHidden =
				window.localStorage.getItem(AMOUNTS_HIDDEN_KEY) === "true";
		} catch {
			// Private browsing can refuse storage entirely; the default stands.
		}
		set({ amountsHidden, hydrated: true });
	},

	toggleAmounts: () => {
		const amountsHidden = !get().amountsHidden;
		set({ amountsHidden });
		try {
			window.localStorage.setItem(AMOUNTS_HIDDEN_KEY, String(amountsHidden));
		} catch {
			// Not being able to remember the choice is survivable.
		}
	},
}));
