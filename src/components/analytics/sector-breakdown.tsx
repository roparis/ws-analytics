"use client";

import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { type RangeOption, Segmented } from "@/components/ui/range-pills";
import { formatCurrency } from "@/lib/metrics";
import type { PositionsReport } from "@/lib/positions";
import {
	type PriceSnapshot,
	snapshotAgeDays,
	sourceLabel,
} from "@/lib/price-snapshot";
import {
	breakdownBySector,
	type FundView,
	flattenProfileStore,
	type ProfileStore,
	type SectorSlice,
} from "@/lib/sectors";
import { cn } from "@/lib/utils";

/**
 * What the money is invested in, not just where it sits or what it's worth.
 *
 * `AllocationChart` answers "which account, which listing"; this answers "which
 * sector" — the one axis Yahoo can supply and the export never could
 * (`docs/wealthsimple-csv-format.md` §8). Same book-cost-first, market-value-
 * once-priced convention as the rest of this page: the breakdown works the
 * moment a file is loaded, and upgrades in place once a snapshot exists.
 *
 * Each of the eleven sectors gets its own hue, plus Crypto, Bonds and Cash —
 * fourteen fixed colours, evenly spaced around the hue wheel with the
 * lightness/chroma alternated between neighbours (`scripts/validate_palette.js`,
 * the dataviz skill) so two adjacent-hued sectors don't also land at the same
 * lightness, which is what actually separates them under colour-vision
 * deficiency. Fourteen is past the skill's own safely-distinguishable range —
 * every row prints its own full label for exactly that reason, so colour is
 * always a supplementary cue on top of an unambiguous one, never the only way
 * identity is read. One pair (Utilities/Real estate) still sits under the
 * strict full-vision floor after several rounds of widening; accepted rather
 * than chased further, since the label makes the two impossible to actually
 * confuse. A "by fund" category is open-ended text ("Large Blend", a fund
 * family's name), not one of the fixed fourteen, and hashing it into that
 * same set was tried and reverted — a fund can land on the exact hex a real
 * sector or Crypto is using in the same breakdown, which is a worse look than
 * sharing a colour on purpose. It gets one fixed, reserved hue instead, never
 * assigned to anything else. "Unclassified" and "Other fund assets" stay a
 * deliberate, desaturated gray: the correct look for "no real answer", not a
 * category competing with the rest.
 *
 * Every row expands into the holdings behind it on a click — "35% Technology"
 * answers "how much" but not "which stocks", and for a fund that second
 * question has no other answer on this page. An earlier version gated the
 * industry name behind its own toggle, defaulting off; from a fresh page load
 * that toggle changed text inside a panel nobody had opened yet, which reads
 * as broken rather than as a mode. Simpler to always show it once a row is
 * open — there was no real second mode here, just an unnecessary extra click.
 */

const FUND_VIEW: readonly RangeOption<FundView>[] = [
	{ label: "Look-through", value: "look-through" },
	{ label: "By fund", value: "fund" },
];

/**
 * The eleven sector keys plus Crypto, Bonds and Cash, in the fixed order the
 * validator was run against — never reorder without re-running it. Fund
 * categories (open-ended labels) and the neutral fallback aren't here; see
 * `colorFor` below.
 */
const CATEGORY_COLORS: Record<string, string> = {
	technology: "bg-[#1577c8] dark:bg-[#006ebe]",
	communication_services: "bg-[#8491e2] dark:bg-[#7480d7]",
	bonds: "bg-[#845bbd] dark:bg-[#7c52b3]",
	consumer_cyclical: "bg-[#bf7dbf] dark:bg-[#b26bb2]",
	healthcare: "bg-[#b4487c] dark:bg-[#aa3f73]",
	energy: "bg-[#d8787b] dark:bg-[#cc6569]",
	crypto: "bg-[#b95019] dark:bg-[#af4709]",
	basic_materials: "bg-[#c78a3b] dark:bg-[#ba7917]",
	consumer_defensive: "bg-[#8f7200] dark:bg-[#866900]",
	industrials: "bg-[#8da349] dark:bg-[#7e942d]",
	financial_services: "bg-[#2b8a36] dark:bg-[#1f812d]",
	cash: "bg-[#00b38e] dark:bg-[#00a57f]",
	utilities: "bg-[#008f98] dark:bg-[#00868f]",
	realestate: "bg-[#29a7d1] dark:bg-[#0098c5]",
};

const NEUTRAL_COLOR = "bg-[#78716c] dark:bg-[#a8a29e]";

/** Reserved for "by fund" category rows — never a key in `CATEGORY_COLORS`,
 * so an open-ended fund label can never collide with a real sector's colour. */
const FUND_CATEGORY_COLOR = "bg-[#67260c] dark:bg-[#f2a26a]";

function colorFor(slice: SectorSlice): string {
	switch (slice.kind) {
		case "sector":
		case "crypto":
		case "bonds":
		case "cash":
			return CATEGORY_COLORS[slice.key] ?? NEUTRAL_COLOR;
		case "fundCategory":
			return FUND_CATEGORY_COLOR;
		case "fundRemainder":
		case "unclassified":
			return NEUTRAL_COLOR;
	}
}

interface SectorBreakdownProps {
	report: PositionsReport;
	profiles: ProfileStore | null;
	snapshot: PriceSnapshot | null;
	currency: string;
}

export function SectorBreakdown({
	currency,
	profiles,
	report,
	snapshot,
}: SectorBreakdownProps) {
	const [view, setView] = useState<FundView>("look-through");
	const [expandedKey, setExpandedKey] = useState<string | null>(null);

	const flatProfiles = useMemo(() => flattenProfileStore(profiles), [profiles]);
	const breakdown = useMemo(
		() => breakdownBySector(report, flatProfiles, snapshot, view),
		[report, flatProfiles, snapshot, view],
	);

	const hasProfiles = profiles !== null && Object.keys(profiles).length > 0;

	// Driven by `breakdown.basis`, not by whether a snapshot merely exists — a
	// global snapshot can price other accounts' holdings and none of this
	// report's, which is routine on the account-scoped pages, and the header
	// would otherwise claim "market value" over a card that's entirely book
	// cost underneath it.
	const priceAge = snapshot ? snapshotAgeDays(snapshot) : 0;
	const basis =
		breakdown.basis === "market" && snapshot
			? `At market value, priced by ${sourceLabel(snapshot)}${priceAge > 0 ? ` ${priceAge} ${priceAge === 1 ? "day" : "days"} ago` : " today"}.`
			: "At what you paid for each holding — fetch live prices from the sidebar to weight this by what they're worth now instead.";

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<CardTitle>What you're invested in</CardTitle>
						<CardDescription>{basis}</CardDescription>
					</div>
					{hasProfiles && (
						<Segmented
							aria-label="Fund attribution"
							inset
							onChange={setView}
							options={FUND_VIEW}
							value={view}
						/>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{!hasProfiles ? (
					<p className="text-muted-foreground text-sm">
						A Wealthsimple export carries no sector data of its own — fetch live
						prices from the sidebar, and Yahoo's classification for each holding
						comes back with it.
					</p>
				) : breakdown.slices.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						Nothing open to classify.
					</p>
				) : (
					<div className="flex flex-col gap-2">
						{breakdown.slices.map((slice) => (
							<SliceRow
								currency={currency}
								expanded={expandedKey === slice.key}
								key={slice.key}
								onToggle={() =>
									setExpandedKey((current) =>
										current === slice.key ? null : slice.key,
									)
								}
								slice={slice}
							/>
						))}
						{breakdown.unclassifiedSymbols.length > 0 && (
							<p className="mt-1 text-muted-foreground text-xs">
								Yahoo doesn't classify{" "}
								{breakdown.unclassifiedSymbols.join(", ")} — counted above as
								Unclassified rather than left out.
							</p>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

interface SliceRowProps {
	slice: SectorSlice;
	currency: string;
	expanded: boolean;
	onToggle: () => void;
}

function SliceRow({ currency, expanded, onToggle, slice }: SliceRowProps) {
	// Every non-empty slice can expand — "35% Technology" doesn't say which
	// stocks, and for a fund's look-through there's no other place on the page
	// that does.
	const canExpand = slice.holdings.length > 0;

	return (
		<div>
			<button
				className={cn(
					"flex w-full items-center gap-3 rounded-md py-1 text-left",
					canExpand && "cursor-pointer hover:bg-muted/50",
				)}
				disabled={!canExpand}
				onClick={canExpand ? onToggle : undefined}
				type="button"
			>
				<ChevronRight
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground transition-transform",
						expanded && "rotate-90",
						!canExpand && "opacity-0",
					)}
				/>
				<span className="w-36 shrink-0 truncate text-sm">{slice.label}</span>
				<span className="relative h-4 flex-1 overflow-hidden rounded-full bg-muted">
					<span
						className={cn(
							"absolute inset-y-0 left-0 rounded-full",
							colorFor(slice),
						)}
						style={{
							width: `${Math.max(slice.share * 100, slice.amount > 0 ? 1 : 0)}%`,
						}}
					/>
				</span>
				<span className="w-14 shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums">
					{(slice.share * 100).toFixed(1)}%
				</span>
				<span className="w-24 shrink-0 text-right font-medium font-mono text-sm tabular-nums">
					{formatCurrency(slice.amount, currency)}
				</span>
			</button>
			{expanded && canExpand && (
				<div className="mt-1 ml-6 flex flex-col gap-1 border-muted border-l pl-4">
					{slice.holdings.map((holding) => (
						<div
							className="flex items-center justify-between gap-3 text-sm"
							key={holding.symbol}
						>
							<span className="flex min-w-0 items-baseline gap-2">
								<span className="shrink-0 font-medium font-mono">
									{holding.symbol}
								</span>
								{holding.name && (
									<span className="truncate text-muted-foreground text-xs">
										{holding.name}
									</span>
								)}
								<span className="shrink-0 text-muted-foreground text-xs">
									{holding.industry
										? `· ${holding.industry}`
										: holding.viaFund
											? "· via look-through, no industry"
											: null}
								</span>
							</span>
							<span className="shrink-0 font-mono tabular-nums">
								{formatCurrency(holding.amount, currency)}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
