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
	fetchProfiles,
	type LivePriceResponse,
	MAX_HISTORY_SYMBOLS,
	MAX_PROFILE_SYMBOLS,
	type ProfileResponse,
	snapshotFromLivePrices,
} from "@/lib/live-prices";
import { formatCurrency } from "@/lib/metrics";
import type { PositionsReport } from "@/lib/positions";
import { historyFromResponse } from "@/lib/price-history";
import { valueWith } from "@/lib/price-snapshot";
import type { ProfileStore } from "@/lib/sectors";
import { symbolsNeedingProfiles } from "@/lib/sectors";
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
 * Three requests, deliberately in that order, and over deliberately different
 * symbol sets. The quote lands in well under a second, asks only about what is
 * held now, and lights up every page that says what things are worth *now*; the
 * monthly history is one Yahoo request per symbol, asks about everything ever
 * held so past years aren't missing the holdings you sold, and only the
 * analytics page needs it. Waiting for the second before showing the first
 * would make the fast answer as slow as the slow one.
 *
 * The third leg — what sector each holding is in — trails both, and for a
 * reason neither of the others has: it is worth *not* asking about most of
 * the time. A profile barely changes, so `symbolsNeedingProfiles` narrows the
 * request to symbols this device has never classified or classified over a
 * month ago; a repeat click on an already-classified portfolio sends nothing.
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
	const profileStore = usePriceStore((state) => state.profiles);
	const addProfiles = usePriceStore((state) => state.addProfiles);
	const [pending, setPending] = useState<
		null | "quotes" | "history" | "profiles"
	>(null);

	const symbols = tickersFor(report.open);
	const historyRequest = historyTickersFor(report, symbols);

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
				await fetchPriceHistory(historyRequest.symbols, range.start, range.end),
			);
			setHistory(history);

			const years = new Set<string>();
			for (const months of Object.values(history.monthlyCad)) {
				for (const month of Object.keys(months)) years.add(month.slice(0, 4));
			}

			toast.success(
				`Year-by-year values ready across ${years.size} ${years.size === 1 ? "year" : "years"}.`,
				{ description: describeHistory(history.unpriced, historyRequest) },
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

		// Same "leave what already worked standing" rule as the history leg — a
		// failed classification shouldn't cast doubt on the price or the history
		// that already landed. Skipped entirely, not just quietly empty, when
		// nothing needs asking: no pending state to flash, no request to send.
		const needed = new Set(
			symbolsNeedingProfiles(
				symbols.map((entry) => entry.symbol),
				profileStore,
			),
		);
		const toClassifyAll = symbols.filter((entry) => needed.has(entry.symbol));
		if (toClassifyAll.length === 0) return;

		// Same cap-and-name pattern as `historyTickersFor` — this route
		// amplifies exactly as history does (one Yahoo request per symbol), so
		// it inherits the same ceiling, and the reader deserves to know when
		// something got left out rather than seeing a request silently 400.
		const toClassify = toClassifyAll.slice(0, MAX_PROFILE_SYMBOLS);
		const droppedProfiles = toClassifyAll
			.slice(MAX_PROFILE_SYMBOLS)
			.map((entry) => entry.symbol);

		setPending("profiles");
		try {
			const response = await fetchProfiles(toClassify);
			const entries: ProfileStore = {};
			for (const profile of response.profiles) {
				entries[profile.symbol] = { fetchedAt: response.fetchedAt, profile };
			}
			// A confirmed miss is cached too, the same as a real profile — Yahoo
			// not classifying a symbol barely changes, and without this the
			// symbol would fail `symbolsNeedingProfiles` forever and be
			// re-requested from Yahoo on every single click.
			for (const miss of response.misses) {
				entries[miss.symbol] = { fetchedAt: response.fetchedAt, profile: null };
			}
			addProfiles(entries);

			toast.success(
				`${response.profiles.length} of ${toClassify.length} classified.`,
				{ description: describeProfiles(response, droppedProfiles) },
			);
		} catch (error) {
			toast.error(
				error instanceof Error
					? `Prices and history are in, but sectors aren't: ${error.message}`
					: "Couldn't fetch sector data.",
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
				: pending === "profiles"
					? "Classifying holdings…"
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
						monthly closes for {historyRequest.symbols.length}
						{historyRequest.dropped.length > 0
							? ` — the most recently held of the ${historyRequest.symbols.length + historyRequest.dropped.length} you've ever held, so the ${historyRequest.dropped.length} oldest ${historyRequest.dropped.length === 1 ? "exit stays" : "exits stay"} at book cost.`
							: " — every symbol you've ever held, so past years count the holdings you've since sold."}{" "}
						Only those symbols leave this device.
					</span>
					<span>
						Every page then values your holdings at the market instead of what
						you paid, and the analytics page gains its year-by-year columns and
						a sector breakdown.
					</span>
					{hint}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

interface HistoryRequest {
	/** What to ask the history route for, open holdings first. */
	symbols: { symbol: string; ticker: string }[];
	/** How many of those are no longer held — the ones this widening added. */
	closedCount: number;
	/** Symbols the cap left out, newest-closed kept. Named in the toast. */
	dropped: string[];
}

/**
 * The symbols a *history* request needs, which is not the set a quote needs.
 *
 * A quote can only ask about what you hold now. A year-end valuation has to ask
 * about whatever you held at that year end, so a holding sold in 2023 still has
 * to be priced for 2021 and 2022 — otherwise `valueYears` re-derives the
 * position from the activity file, finds no close for it, and carries it at
 * book cost for years it was actually worth more.
 *
 * `report.bySymbol` is the right source: it rolls up *every* position, open and
 * closed alike, into one row per distinct symbol — which is the granularity the
 * response is keyed at anyway.
 *
 * The cap is the awkward part. `MAX_HISTORY_SYMBOLS` was sized against open
 * holdings, and this asks about every symbol ever held, so for a portfolio that
 * has traded a lot it can genuinely bind. Raising it is not the answer — it
 * exists to bound what a public deployment does to an unofficial upstream API —
 * so the overflow is dropped deterministically and named out loud: open
 * holdings are kept first (the market-value tile needs them), then closed ones
 * most recently closed first, on the reasoning that a recently-closed holding
 * was held for more of the window the analytics page shows and so prices more
 * year ends per request spent. The holdings that lose are the oldest, which is
 * precisely what the earliest years wanted; that cost is real, and the fix for
 * it is to make this request cheap enough to afford more symbols.
 */
function historyTickersFor(
	report: PositionsReport,
	open: { symbol: string; ticker: string }[],
): HistoryRequest {
	const isOpen = new Set(open.map((entry) => entry.symbol));

	// `bySymbol` already arrives book cost descending, so the open rows are in
	// the order worth keeping. Closed rows all carry a book cost of zero, which
	// is why they get sorted on their own terms.
	const held = report.bySymbol.filter((row) => isOpen.has(row.symbol));
	const exited = report.bySymbol
		.filter((row) => !isOpen.has(row.symbol))
		.sort(
			(a, b) =>
				(b.lastTradeDate ?? "").localeCompare(a.lastTradeDate ?? "") ||
				a.symbol.localeCompare(b.symbol),
		);

	const ranked = [...held, ...exited];
	const kept = ranked.slice(0, MAX_HISTORY_SYMBOLS);

	return {
		symbols: tickersFor(kept),
		closedCount: kept.filter((row) => !isOpen.has(row.symbol)).length,
		dropped: ranked.slice(MAX_HISTORY_SYMBOLS).map((row) => row.symbol),
	};
}

/**
 * What changed about the year-by-year numbers, in the order a reader cares.
 *
 * Sold holdings being priced is the point of the request, so it leads. A symbol
 * the cap left out is a different thing from one Yahoo couldn't price, and both
 * end up at book cost, so both are said — silently dropping either would leave
 * a number quietly lower than the truth with nothing on screen to explain it.
 */
function describeHistory(unpriced: string[], request: HistoryRequest): string {
	const parts: string[] = [];

	if (request.closedCount > 0) {
		parts.push(
			`Includes ${request.closedCount} ${request.closedCount === 1 ? "holding" : "holdings"} you no longer hold, priced for the years you did.`,
		);
	}

	if (request.dropped.length > 0) {
		parts.push(
			`Left out ${request.dropped.join(", ")} — one request tops out at ${MAX_HISTORY_SYMBOLS} symbols, so the oldest exits went first.`,
		);
	}

	if (unpriced.length > 0) {
		parts.push(
			`No history for ${unpriced.join(", ")} — held at book cost in those years.`,
		);
	}

	if (parts.length === 0) {
		parts.push(
			"The analytics page now counts what your holdings gained without being sold.",
		);
	}

	return parts.join(" ");
}

/**
 * What changed about the sector breakdown. Short by design: unlike a quote or
 * a history bar, a miss here isn't "no price" — a bond, an index, or a fund
 * Yahoo reports no weights for genuinely has no sector to give, and the page
 * already says so per-holding rather than repeating it in every toast.
 */
function describeProfiles(
	response: ProfileResponse,
	dropped: string[],
): string {
	const parts: string[] = [];

	if (response.misses.length > 0) {
		parts.push(
			`Yahoo doesn't classify ${response.misses.map((miss) => miss.symbol).join(", ")} — left out of the sector breakdown.`,
		);
	}

	if (dropped.length > 0) {
		parts.push(
			`Left out ${dropped.join(", ")} — one request tops out at ${MAX_PROFILE_SYMBOLS} symbols.`,
		);
	}

	if (parts.length === 0) {
		parts.push("Ready on the analytics page.");
	}

	return parts.join(" ");
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
