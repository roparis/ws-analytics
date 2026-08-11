"use client";

import { Loader2, Zap } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	fetchLivePrices,
	fetchPriceHistory,
	type LivePriceResponse,
	snapshotFromLivePrices,
} from "@/lib/live-prices";
import { formatCurrency } from "@/lib/metrics";
import type { PositionsReport } from "@/lib/positions";
import { historyFromResponse } from "@/lib/price-history";
import { valueWith } from "@/lib/price-snapshot";
import { tickersFor } from "@/lib/yahoo-ticker";
import { usePriceStore } from "@/stores/prices";

/**
 * One click instead of the export-open-download-import loop.
 *
 * It sits in the sidebar, below the data card: the prices it fetches feed every
 * page, so pinning it to Investments or Analytics made a global switch look
 * like it belonged to whichever page you happened to be on. The tooltip carries
 * what a button that reaches the network owes the reader — what it asks for,
 * what leaves the device, and what changes once it lands.
 *
 * The sheet round trip stays exactly where it was, and on purpose: it needs no
 * server, it survives Yahoo changing its mind, and its ticker column is
 * editable when a guess is wrong. This is the fast path, not the replacement —
 * both write the same snapshot, and whichever ran last is what the page shows.
 *
 * Two requests, deliberately in that order. The quote lands in well under a
 * second and lights up every page that asks what things are worth *now*; the
 * monthly history is one Yahoo request per holding and only the analytics page
 * needs it. Waiting for the second before showing the first would make the fast
 * answer as slow as the slow one.
 */

interface LivePricesButtonProps {
	report: PositionsReport;
	currency: string;
	/** The period to pull monthly closes for — `dataset.dateRange`. */
	range: { start: string; end: string };
	variant?: "default" | "outline";
	/** Applied to the button, so the sidebar can stretch it to the full width. */
	className?: string;
	/** Icon only, for the mobile header where the label doesn't fit. */
	compact?: boolean;
	/** Extra lines for the tooltip — how fresh the prices on hand are. */
	hint?: ReactNode;
}

export function LivePricesButton({
	className,
	compact = false,
	currency,
	hint,
	range,
	report,
	variant = "default",
}: LivePricesButtonProps) {
	const setSnapshot = usePriceStore((state) => state.setSnapshot);
	const setHistory = usePriceStore((state) => state.setHistory);
	const [pending, setPending] = useState<null | "quotes" | "history">(null);

	const symbols = tickersFor(report.open);

	async function fetchPrices() {
		setPending("quotes");
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
			return;
		} finally {
			setPending(null);
		}

		// A failed history leaves the snapshot standing: the investment page is
		// already correct, and the analytics page falls back to book cost the way
		// it did before any of this existed.
		setPending("history");
		try {
			const history = historyFromResponse(
				await fetchPriceHistory(symbols, range.start, range.end),
			);
			setHistory(history);

			const years = new Set<string>();
			for (const months of Object.values(history.monthlyCad)) {
				for (const month of Object.keys(months)) years.add(month.slice(0, 4));
			}

			toast.success(
				`Year-by-year values ready across ${years.size} ${years.size === 1 ? "year" : "years"}.`,
				{
					description:
						history.unpriced.length > 0
							? `No history for ${history.unpriced.join(", ")} — held at book cost in those years.`
							: "The analytics page now counts what your holdings gained without being sold.",
				},
			);
		} catch (error) {
			toast.error(
				error instanceof Error
					? `Today's prices are in, but the history isn't: ${error.message}`
					: "Couldn't fetch the price history.",
			);
		} finally {
			setPending(null);
		}
	}

	const label =
		pending === "quotes"
			? "Fetching prices…"
			: pending === "history"
				? "Fetching history…"
				: "Fetch live prices";

	return (
		<Tooltip>
			{/* The trigger *is* the button — a wrapper around it would put a
			non-interactive element between the pointer and the click target. */}
			<TooltipTrigger
				onClick={() => void fetchPrices()}
				render={
					<Button
						aria-label={compact ? label : undefined}
						className={className}
						disabled={pending !== null || symbols.length === 0}
						size={compact ? "icon-sm" : "default"}
						variant={variant}
					/>
				}
			>
				{pending ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Zap className="size-4" />
				)}
				{!compact && label}
			</TooltipTrigger>
			<TooltipContent className="max-w-xs">
				<span className="flex flex-col gap-1">
					<span>
						Asks Yahoo Finance today&apos;s price for the {symbols.length}{" "}
						{symbols.length === 1 ? "ticker" : "tickers"} you hold, then the
						monthly closes behind them. Only those symbols leave this device.
					</span>
					<span>
						Every page then values your holdings at the market instead of what
						you paid, and the analytics page gains its year-by-year columns.
					</span>
					{hint}
				</span>
			</TooltipContent>
		</Tooltip>
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
