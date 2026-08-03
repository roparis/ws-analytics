"use client";

import { useEffect } from "react";
import { useDatasetStore } from "@/stores/dataset";

/**
 * Reads persisted sources once for the whole app. Mounted in the root layout so
 * every route — not just the dashboard — has data after a direct load.
 */
export function StoreHydrator() {
	const hydrate = useDatasetStore((state) => state.hydrate);

	useEffect(() => {
		void hydrate();
	}, [hydrate]);

	return null;
}
