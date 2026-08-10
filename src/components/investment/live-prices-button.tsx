"use client";

import { Loader2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	fetchLivePrices,
	type LivePriceResponse,
	snapshotFromLivePrices,
} from "@/lib/live-prices";
import { formatCurrency } from "@/lib/metrics";
import type { PositionsReport } from "@/lib/positions";
import { valueWith } from "@/lib/price-snapshot";
import { tickersFor } from "@/lib/yahoo-ticker";
import { usePriceStore } from "@/stores/prices";

/**
 * One click instead of the export-open-download-import loop.
 *
 * The sheet round trip stays exactly where it was, and on purpose: it needs no
 * server, it survives Yahoo changing its mind, and its ticker column is
 * editable when a guess is wrong. This is the fast path, not the replacement —
 * both write the same snapshot, and whichever ran last is what the page shows.
 */

interface LivePricesButtonProps {
	report: PositionsReport;
	currency: string;
	variant?: "default" | "outline";
}

export function LivePricesButton({
	currency,
	report,
	variant = "default",
}: LivePricesButtonProps) {
	const setSnapshot = usePriceStore((state) => state.setSnapshot);
	const [pending, setPending] = useState(false);

	const symbols = tickersFor(report.open);

	async function fetchPrices() {
		setPending(true);
		try {
			const response = await fetchLivePrices(symbols);
			const snapshot = snapshotFromLivePrices(response);

			if (snapshot.matched.length === 0) {
				toast.error("Yahoo priced none of your holdings.", {
					description: response.misses[0]?.reason,
				});
				return;
			}

			setSnapshot(snapshot);

			const valued = valueWith(report, snapshot);
			const marketValue =
				valued?.byAccountType.reduce((sum, row) => sum + row.marketValue, 0) ??
				0;

			toast.success(
				`${snapshot.matched.length} of ${symbols.length} priced — ${formatCurrency(marketValue, currency)}.`,
				{ description: describe(response) },
			);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't fetch prices.",
			);
		} finally {
			setPending(false);
		}
	}

	return (
		<Button
			disabled={pending || symbols.length === 0}
			onClick={() => void fetchPrices()}
			variant={variant}
		>
			{pending ? (
				<Loader2 className="size-4 animate-spin" />
			) : (
				<Zap className="size-4" />
			)}
			{pending ? "Fetching prices…" : "Fetch live prices"}
		</Button>
	);
}

/**
 * The two things a reader needs after a fetch: how old these prices are, and
 * which holdings didn't get one. A closed exchange is the common case — saying
 * "last close" is more honest than a timestamp that looks live.
 */
function describe(response: LivePriceResponse): string {
	const parts: string[] = [];

	const open = response.quotes.some((quote) => quote.marketState === "REGULAR");
	parts.push(open ? "Markets are open." : "Prices are the last close.");

	if (response.usdCad) {
		parts.push(`US listings converted at ${response.usdCad.toFixed(4)} CAD.`);
	}

	if (response.misses.length > 0) {
		parts.push(
			`No price for ${response.misses.map((miss) => miss.symbol).join(", ")} — counted at what you paid.`,
		);
	}

	return parts.join(" ");
}
