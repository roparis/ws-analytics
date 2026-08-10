"use client";

import { useEffect } from "react";
import { useDatasetStore } from "@/stores/dataset";
import { usePriceStore } from "@/stores/prices";

/**
 * Reads persisted sources once for the whole app. Mounted in the root layout so
 * every route — not just the dashboard — has data after a direct load.
 */
export function StoreHydrator() {
	const hydrate = useDatasetStore((state) => state.hydrate);
	const hydratePrices = usePriceStore((state) => state.hydrate);

	useEffect(() => {
		void hydrate();
		// Both open the same database, and both are needed before the first
		// figure renders — reading them together avoids a second round of
		// "loaded, now re-render everything".
		void hydratePrices();
	}, [hydrate, hydratePrices]);

	return null;
}
