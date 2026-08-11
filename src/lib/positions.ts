import type { SourceSummary } from "@/lib/merge";
import { isMarginAccount } from "@/lib/metrics";
import type { Activity } from "@/lib/wealthsimple";

/**
 * Holdings reconstructed from the activity history.
 *
 * The export contains no prices and no position snapshot
 * (`docs/wealthsimple-csv-format.md` §8), so share counts and book cost are
 * derivable but *market value is not*. Nothing in this module estimates a
 * price; the Google Sheet export is where live prices enter, sourced from
 * GOOGLEFINANCE and labelled as coming from Google rather than from the file.
 *
 * Four rules from the data dictionary govern every calculation below:
 *
 * 1. `netCashAmount` on a Trade already includes commission (I1), so book cost
 *    adds `|netCashAmount|` and never touches `unitPrice` or `commission`.
 * 2. `unitPrice` is already CAD even on FX rows (§4). The FX rate is used only
 *    to infer where a security trades — never as a multiplier.
 * 3. `symbol` is set iff the type is Trade, Dividend or LegacyCorporateAction
 *    (I8), so withholding tax cannot be attributed per holding.
 * 4. `accountType` is a display label, not a key (§5) — three TFSAs share one.
 *    Cost pools key on `(accountId, symbol)`; type figures are roll-ups.
 */

/**
 * A $25 recurring BTC buy is 0.00019052 units, so any residual smaller than
 * this is float dust from summing rather than a holding. I4 says a fully-exited
 * position lands on exactly 0.000000 in the file — snapping at this threshold
 * is what keeps that true after ~1,500 additions.
 */
export const SHARE_EPSILON = 1e-6;

/** Half a cent — the resolution `net_cash_amount` is reported at. */
export const MONEY_EPSILON = 0.005;

/**
 * Where a security trades, which is the only currency-exposure signal the file
 * carries. `unknown` means the symbol produced no evidence either way.
 */
export type Listing = "us" | "ca" | "crypto" | "unknown";

export type PositionFlag =
	/** The pool opens with a sale — the cost of those shares was never in the file. */
	| "first-trade-is-sell"
	/** A sale for more shares than the pool holds. I3 says that can't happen in a
	 * complete export, so buys are missing. */
	| "sold-more-than-held"
	/** Shares were sold that carried no book cost at all. */
	| "basis-exhausted"
	/** Distributions on a symbol never bought in this account. */
	| "income-without-trades"
	/** A share-count correction with no counterpart row — a split, or half of a
	 * rename whose other leg is outside the export. */
	| "corporate-action-unpaired"
	/** The pool was carried across a ticker change. */
	| "renamed";

export interface PositionIssue {
	flag: PositionFlag;
	/** Human-readable, in `validateDataset`'s voice. */
	message: string;
}

/** One cost pool: everything held of one symbol inside one account. */
export interface Position {
	accountId: string;
	accountType: string;
	symbol: string;
	/** Every ticker this pool has traded under, oldest first. */
	aliases: string[];
	/** Display only. `name` carries NBSP and trailing-space dirt, and TWOU/TWOUQ
	 * collide on it — never group by this. */
	name: string | null;
	/** Exactly 0 when closed, never negative. */
	shares: number;
	/** Book cost of the shares still held, commission included. 0 when closed. */
	bookCost: number;
	/** `bookCost / shares`. Null when closed. */
	averageCost: number | null;
	realizedPnl: number;
	/** Σ `netCashAmount` over sells — cash received, already net of commission. */
	proceeds: number;
	/**
	 * Σ `|netCashAmount|` over buys — cash paid, already including commission.
	 *
	 * Every buy the pool ever made, never reduced by a sell, so this is what
	 * `realizedPnl` is a return *on*. `bookCost` is the other half of the pair:
	 * only the shares still held, and 0 once the position is closed.
	 */
	costBasis: number;
	dividends: number;
	/** Informational. Already inside `costBasis` and `proceeds` — never add it again. */
	commission: number;
	listing: Listing;
	/** The last FX rate Wealthsimple quoted. Informational only (§4). */
	lastFxRate: number | null;
	firstTradeDate: string | null;
	lastTradeDate: string | null;
	tradeCount: number;
	issues: PositionIssue[];
}

export type HistoryConfidence = "complete" | "suspect";

export interface AccountRollup {
	accountId: string;
	accountType: string;
	positions: Position[];
	openCount: number;
	closedCount: number;
	bookCost: number;
	realizedPnl: number;
	dividends: number;
	/** `Tax`/`NRT` rows carry no symbol (I8), so this can only be an account
	 * total. Positive magnitude. */
	withholdingTax: number;
	/** Fees and margin interest, net of administrative refunds. Positive magnitude. */
	fees: number;
	interest: number;
	/** Σ `netCashAmount` — the account's uninvested cash (I5, §6.1). */
	cashBalance: number;
	firstActivityDate: string;
	lastActivityDate: string;
	historyConfidence: HistoryConfidence;
	historyReasons: string[];
}

export interface AccountTypeRollup {
	/** A roll-up label, not a key (§5). */
	accountType: string;
	accountIds: string[];
	bookCost: number;
	realizedPnl: number;
	dividends: number;
	withholdingTax: number;
	fees: number;
	cashBalance: number;
	openCount: number;
	closedCount: number;
	/** Book cost split by where the security trades — the file's only
	 * currency-exposure signal. */
	bookCostByListing: Record<Listing, number>;
	historyConfidence: HistoryConfidence;
}

/** One symbol across every account that holds it. */
export interface SymbolRollup {
	symbol: string;
	name: string | null;
	listing: Listing;
	shares: number;
	bookCost: number;
	costBasis: number;
	proceeds: number;
	realizedPnl: number;
	dividends: number;
	commission: number;
	accountIds: string[];
	firstTradeDate: string | null;
	lastTradeDate: string | null;
}

export interface PositionsTotals {
	/** Book cost of open holdings only — closed positions carry none. */
	bookCost: number;
	realizedPnl: number;
	dividends: number;
	withholdingTax: number;
	fees: number;
	cashBalance: number;
	openCount: number;
	closedCount: number;
}

/**
 * One sale's realised gain, with the date it happened on.
 *
 * `Position.realizedPnl` is a lifetime total, which is the right figure for a
 * holdings table and useless for a per-year one. Rather than have a second
 * module re-walk the trades to date the same gains — the surest way to end up
 * with two numbers that disagree — the walk emits its realisations as it makes
 * them. Summing `amount` over a pool's events equals that pool's `realizedPnl`
 * exactly, and `positions.test.ts` holds them to it.
 */
export interface RealizationEvent {
	/** `transactionDate` of the sale, or of the last trade for a closing exit. */
	date: string;
	accountId: string;
	accountType: string;
	symbol: string;
	amount: number;
}

export interface PositionsReport {
	positions: Position[];
	/** Still held, book cost descending. */
	open: Position[];
	/** Exited to exactly zero. */
	closed: Position[];
	/** Distributions but no trades — the buy history is outside the export. */
	incomeOnly: Position[];
	bySymbol: SymbolRollup[];
	byAccount: AccountRollup[];
	byAccountType: AccountTypeRollup[];
	/** Every realised gain, dated. Oldest first. */
	realizations: RealizationEvent[];
	totals: PositionsTotals;
	/** Dataset-level problems, same shape as `validateDataset`'s return. */
	issues: string[];
}

/**
 * `, FX Rate: 1.3601` appears on exactly the US-listed tickers and never on the
 * TSX-listed ones (§4), which makes it the only listing signal in the file —
 * the `currency` column describes the account and is a constant CAD (§4.1).
 *
 * The rate itself is informational. Multiplying anything by it inflates every
 * US-listed figure by ~38%, because `unit_price` is already converted.
 */
const FX_RATE = /,\s*FX Rate:\s*([\d.]+)/i;

export function extractFxRate(description: string): number | null {
	const match = FX_RATE.exec(description);
	if (!match) return null;
	const rate = Number(match[1]);
	return Number.isFinite(rate) ? rate : null;
}

/**
 * Wealthsimple books spot crypto in its own account type. TSX-listed crypto
 * ETFs (`BTCC.B`, `ETHH.B`) live in ordinary registered accounts and are
 * ordinary TSX tickers, so this deliberately matches the account, not the name.
 */
export function isCryptoAccountType(accountType: string): boolean {
	return accountType.toLowerCase().includes("crypto");
}

/**
 * Collapses the whitespace dirt in `name` — Wealthsimple emits non-breaking
 * spaces and trailing spaces. Display and comparison only; `symbol` stays the key.
 */
export function normalizeName(name: string | null): string | null {
	if (!name) return null;
	const cleaned = name.replace(/ /g, " ").replace(/\s+/g, " ").trim();
	return cleaned === "" ? null : cleaned;
}

/** Presence of an FX marker on *any* row for a symbol means it trades in the US. */
export function detectListing(rows: Activity[]): Listing {
	if (rows.length === 0) return "unknown";
	if (rows.some((row) => isCryptoAccountType(row.accountType))) return "crypto";
	if (rows.some((row) => extractFxRate(row.description) !== null)) return "us";
	return "ca";
}

/** Activity types that carry a `symbol`, per I8. */
const SYMBOL_TYPES = new Set(["Trade", "Dividend", "LegacyCorporateAction"]);

interface Pool {
	accountId: string;
	accountType: string;
	symbol: string;
	aliases: string[];
	name: string | null;
	shares: number;
	bookCost: number;
	realizedPnl: number;
	proceeds: number;
	costBasis: number;
	dividends: number;
	commission: number;
	lastFxRate: number | null;
	firstTradeDate: string | null;
	lastTradeDate: string | null;
	tradeCount: number;
	rows: Activity[];
	issues: Map<PositionFlag, PositionIssue>;
	/** Realisations as they happen, so `realizedPnl` can be split by date. */
	realizations: RealizationEvent[];
}

/**
 * Records a realisation against the pool. Exact zeros are dropped — a sale that
 * broke even is not a per-year figure anyone needs, and keeping them would bulk
 * the log out with rows that sum to nothing.
 */
function realize(pool: Pool, date: string, amount: number): void {
	if (amount === 0) return;
	pool.realizations.push({
		date,
		accountId: pool.accountId,
		accountType: pool.accountType,
		symbol: pool.symbol,
		amount,
	});
}

function flag(pool: Pool, flagName: PositionFlag, message: string): void {
	// One issue per flag per pool: a truncated history trips the same rule on
	// every subsequent sale, and twelve copies of one sentence is noise.
	if (!pool.issues.has(flagName)) {
		pool.issues.set(flagName, { flag: flagName, message });
	}
}

/** Identifies a single corporate-action row well enough to recognise it again. */
function legKey(activity: Activity): string {
	return `${activity.accountId}|${activity.transactionDate}|${activity.symbol}|${activity.quantity}`;
}

interface RenameAnalysis {
	/** `accountId -> (oldSymbol -> newSymbol)`. */
	bySymbol: Map<string, Map<string, string>>;
	/** Every row that is one leg of a recognised rename. */
	legs: Set<string>;
}

/**
 * Detects a ticker rename among the zero-cash `LegacyCorporateAction` rows.
 *
 * Wealthsimple books a rename as two share-count corrections on the same day in
 * the same account: the old ticker's holding removed, the same number of shares
 * added under the new one. Treating them as two independent events would hand
 * the new ticker its shares at zero cost and book a fabricated gain when they
 * are eventually sold — so the pair has to be recognised and the cost pool
 * carried across.
 *
 * The test is deliberately narrow, because getting this wrong invents money:
 * exactly two corrections, same account and date, one removing shares and one
 * adding them, under different tickers.
 *
 * The quantities are **not** required to cancel. A rename often carries a share
 * ratio — in the reference export 20 TWOU became 0.6667 TWOUQ, a 1-for-30
 * reverse split done at the same time as the ticker change — so demanding a 1:1
 * swap misses the real case and splits one holding into a fabricated loss on
 * the old ticker and a fabricated gain on the new one. Either the quantities
 * cancel or the security keeps its name (both legs read "2U Inc."), which is
 * what tells these two rows apart from two unrelated corrections that happen to
 * land on the same day.
 */
function analyzeRenames(activities: Activity[]): RenameAnalysis {
	const byAccountDate = new Map<string, Activity[]>();

	for (const activity of activities) {
		if (activity.activityType !== "LegacyCorporateAction") continue;
		if (!activity.symbol || activity.quantity === null) continue;
		const key = `${activity.accountId} ${activity.transactionDate}`;
		const bucket = byAccountDate.get(key);
		if (bucket) bucket.push(activity);
		else byAccountDate.set(key, [activity]);
	}

	const bySymbol = new Map<string, Map<string, string>>();
	const legs = new Set<string>();

	for (const rows of byAccountDate.values()) {
		if (rows.length !== 2) continue;

		const [first, second] = rows;
		const outgoing = (first.quantity ?? 0) < 0 ? first : second;
		const incoming = outgoing === first ? second : first;
		const outQuantity = outgoing.quantity ?? 0;
		const inQuantity = incoming.quantity ?? 0;

		if (outQuantity >= 0 || inQuantity <= 0) continue;
		if (!outgoing.symbol || !incoming.symbol) continue;
		if (outgoing.symbol === incoming.symbol) continue;

		const cancels = Math.abs(outQuantity + inQuantity) <= SHARE_EPSILON;
		const sameName =
			normalizeName(outgoing.name) !== null &&
			normalizeName(outgoing.name) === normalizeName(incoming.name);
		if (!cancels && !sameName) continue;

		let forAccount = bySymbol.get(outgoing.accountId);
		if (!forAccount) {
			forAccount = new Map();
			bySymbol.set(outgoing.accountId, forAccount);
		}
		forAccount.set(outgoing.symbol, incoming.symbol);
		legs.add(legKey(outgoing));
		legs.add(legKey(incoming));
	}

	return { bySymbol, legs };
}

/**
 * Follows a rename chain to the ticker a pool ends up under, so a symbol
 * renamed twice still lands in one pool. Guarded against a cycle, which the
 * pairing rules shouldn't produce but which would otherwise hang.
 */
function resolveSymbol(
	renames: Map<string, string> | undefined,
	symbol: string,
): string {
	if (!renames) return symbol;
	let current = symbol;
	const seen = new Set<string>([current]);
	while (true) {
		const next = renames.get(current);
		if (!next || seen.has(next)) return current;
		seen.add(next);
		current = next;
	}
}

interface WalkRow {
	activity: Activity;
	index: number;
}

/**
 * Orders one pool's rows for the cost walk.
 *
 * Newer exports carry `effective_at` — a full timestamp — so same-day activity
 * can be walked in the order it actually happened, which is what average cost
 * is supposed to follow.
 *
 * Older exports state only a date, and rows inside one are *not* in execution
 * order (§1.2 — the 2025-10-06 Group RRSP rebalance lists five buys before the
 * sells that funded them). There the file simply cannot say how a same-day
 * round trip sequenced, so share-increasing rows go first: the conventional
 * same-day average-cost treatment, and the only ordering that can't manufacture
 * a false "sold more than held". That is a convention, not a fact — on a
 * same-day buy *and* sell of one symbol the resulting cost depends on it.
 *
 * Mixed sources sort together correctly because a timestamp begins with the
 * same `YYYY-MM-DD` it would otherwise carry, so the comparison stays
 * chronological either way and only ever falls back within a single day.
 */
function orderForWalk(rows: WalkRow[]): WalkRow[] {
	return [...rows].sort((a, b) => {
		const byDate = a.activity.transactionDate.localeCompare(
			b.activity.transactionDate,
		);
		if (byDate !== 0) return byDate;

		const aTime = a.activity.effectiveAt;
		const bTime = b.activity.effectiveAt;
		if (aTime && bTime) {
			const byTime = aTime.localeCompare(bTime);
			if (byTime !== 0) return byTime;
		} else {
			const aIncreasing = (a.activity.quantity ?? 0) > 0 ? 0 : 1;
			const bIncreasing = (b.activity.quantity ?? 0) > 0 ? 0 : 1;
			if (aIncreasing !== bIncreasing) return aIncreasing - bIncreasing;
		}

		return a.index - b.index;
	});
}

function emptyByListing(): Record<Listing, number> {
	return { us: 0, ca: 0, crypto: 0, unknown: 0 };
}

/**
 * Account-level figures. `metrics.ts` computes costs net of refunds by summing
 * signed amounts over its `COST_TYPES` set; the same trick applies here, so a
 * `MANAGEMENT_FEE_REFUND` reduces reported fees rather than being dropped.
 */
interface AccountTally {
	accountId: string;
	accountType: string;
	/** Signed, as in the data. Negated on the way into the roll-up. */
	taxSigned: number;
	feesSigned: number;
	interest: number;
	cashBalance: number;
	firstActivityDate: string;
	lastActivityDate: string;
}

export interface BuildPositionsOptions {
	/** `MergedDataset.sources`. Optional so tests can stay fixture-only. */
	sources?: SourceSummary[];
}

export function buildPositions(
	activities: Activity[],
	options: BuildPositionsOptions = {},
): PositionsReport {
	const renames = analyzeRenames(activities);
	const accounts = new Map<string, AccountTally>();
	const poolRows = new Map<string, WalkRow[]>();

	// Pass 1 — account-level figures, and bucket the symbol-bearing rows into
	// cost pools. Renames are resolved here so both legs land in one pool.
	activities.forEach((activity, index) => {
		let tally = accounts.get(activity.accountId);
		if (!tally) {
			tally = {
				accountId: activity.accountId,
				accountType: activity.accountType,
				taxSigned: 0,
				feesSigned: 0,
				interest: 0,
				cashBalance: 0,
				firstActivityDate: activity.transactionDate,
				lastActivityDate: activity.transactionDate,
			};
			accounts.set(activity.accountId, tally);
		}

		tally.cashBalance += activity.netCashAmount;
		if (activity.transactionDate < tally.firstActivityDate) {
			tally.firstActivityDate = activity.transactionDate;
		}
		if (activity.transactionDate > tally.lastActivityDate) {
			tally.lastActivityDate = activity.transactionDate;
		}

		if (activity.activityType === "Tax") {
			tally.taxSigned += activity.netCashAmount;
		} else if (
			activity.activityType === "Fee" ||
			activity.activityType === "InterestCharged" ||
			// Positive, and deliberately in the same bucket: a management-fee
			// refund reduces what fees actually cost (§3.1).
			activity.activityType === "AdministrativePayment"
		) {
			tally.feesSigned += activity.netCashAmount;
		} else if (activity.activityType === "Interest") {
			tally.interest += activity.netCashAmount;
		}

		if (!activity.symbol) return;
		if (!SYMBOL_TYPES.has(activity.activityType)) return;

		const symbol = resolveSymbol(
			renames.bySymbol.get(activity.accountId),
			activity.symbol,
		);
		const key = `${activity.accountId} ${symbol}`;
		const bucket = poolRows.get(key);
		if (bucket) bucket.push({ activity, index });
		else poolRows.set(key, [{ activity, index }]);
	});

	// Pass 2 — walk each cost pool.
	const pools: Pool[] = [];

	for (const rows of poolRows.values()) {
		const first = rows[0].activity;
		const pool: Pool = {
			accountId: first.accountId,
			accountType: first.accountType,
			symbol: resolveSymbol(
				renames.bySymbol.get(first.accountId),
				first.symbol ?? "",
			),
			aliases: [],
			name: null,
			shares: 0,
			bookCost: 0,
			realizedPnl: 0,
			proceeds: 0,
			costBasis: 0,
			dividends: 0,
			commission: 0,
			lastFxRate: null,
			firstTradeDate: null,
			lastTradeDate: null,
			tradeCount: 0,
			rows: rows.map((row) => row.activity),
			issues: new Map(),
			realizations: [],
		};
		pools.push(pool);

		for (const { activity } of orderForWalk(rows)) {
			if (!pool.name) pool.name = normalizeName(activity.name);
			if (activity.symbol && !pool.aliases.includes(activity.symbol)) {
				pool.aliases.push(activity.symbol);
			}

			const fxRate = extractFxRate(activity.description);
			if (fxRate !== null) pool.lastFxRate = fxRate;

			if (activity.activityType === "Dividend") {
				pool.dividends += activity.netCashAmount;
				continue;
			}

			if (activity.activityType === "LegacyCorporateAction") {
				const delta = activity.quantity ?? 0;

				// Both legs of a recognised rename sit in this pool, so applying each
				// delta in turn removes the old ticker's shares and adds the new
				// ticker's — leaving whatever ratio the rename carried — while book
				// cost is never touched. That is the whole point: the holding simply
				// continues under the new ticker, and no gain or loss is booked for an
				// event where no money changed hands.
				if (renames.legs.has(legKey(activity))) {
					pool.shares += delta;
					flag(
						pool,
						"renamed",
						`This holding changed ticker (${pool.aliases.join(" → ")}). Its book cost carried over with the shares, so no gain or loss was booked for the change itself.`,
					);
					continue;
				}

				// An unpaired correction changes the share count with no cash. Total
				// book cost is unchanged and average cost is re-derived, which is the
				// arithmetically right answer for a share-count-only event: a 2:1
				// split doubles the shares and halves the cost per share. Scaling
				// basis with the delta would inflate it.
				pool.shares += delta;
				flag(
					pool,
					"corporate-action-unpaired",
					`A share-count correction of ${delta} had no matching row, so the shares changed but the book cost was left as it was. Worth checking if this was a split or a ticker change.`,
				);
				continue;
			}

			if (activity.activityType !== "Trade") continue;

			const quantity = activity.quantity ?? 0;
			pool.tradeCount += 1;
			pool.commission += activity.commission ?? 0;
			if (!pool.firstTradeDate) pool.firstTradeDate = activity.transactionDate;
			pool.lastTradeDate = activity.transactionDate;

			if (quantity > 0) {
				// I1: `netCashAmount` is -(quantity x unitPrice) - commission, so its
				// magnitude is already the entire cost. Reading `unitPrice` here would
				// drop the commission; multiplying by the FX rate would inflate every
				// US-listed cost by ~38%.
				const cost = Math.abs(activity.netCashAmount);
				pool.shares += quantity;
				pool.bookCost += cost;
				pool.costBasis += cost;
				continue;
			}

			if (quantity >= 0) continue;

			if (pool.shares <= SHARE_EPSILON) {
				flag(
					pool,
					"first-trade-is-sell",
					"This holding opens with a sale, so what the shares originally cost isn't in the loaded files. Its book cost and gain can't be trusted.",
				);
			} else if (-quantity > pool.shares + SHARE_EPSILON) {
				flag(
					pool,
					"sold-more-than-held",
					"A sale here covers more shares than the loaded files account for, so some buys are missing. Its book cost and gain can't be trusted.",
				);
			} else if (pool.bookCost < MONEY_EPSILON) {
				flag(
					pool,
					"basis-exhausted",
					"These shares carry no book cost in the loaded files, so the gain shown against them is overstated.",
				);
			}

			// Release basis as a fraction of the pool rather than
			// `averageCost x sharesSold`: it is float-stable, and a full exit
			// releases exactly `bookCost` instead of leaving a rounding residual.
			const soldShares = Math.min(-quantity, Math.max(pool.shares, 0));
			const basisReleased =
				pool.shares > 0 ? pool.bookCost * (soldShares / pool.shares) : 0;

			const realized = activity.netCashAmount - basisReleased;
			pool.realizedPnl += realized;
			realize(pool, activity.transactionDate, realized);
			pool.proceeds += activity.netCashAmount;
			pool.bookCost = Math.max(0, pool.bookCost - basisReleased);
			pool.shares += quantity;
		}

		// Distributions on a symbol with no trades at all mean the buys predate
		// the export — a real signal that the history is short, not a data error.
		if (pool.tradeCount === 0 && pool.dividends !== 0) {
			flag(
				pool,
				"income-without-trades",
				"Distributions arrived for a holding that was never bought in the loaded files, so its shares and book cost are missing.",
			);
		}

		// I4: a fully-exited position lands on exactly 0.000000 in the file, so it
		// has to land on exactly 0 here too. Any basis still attached at that point
		// belongs to the final disposition — a full exit realizes all remaining cost.
		if (Math.abs(pool.shares) < SHARE_EPSILON) {
			pool.realizedPnl -= pool.bookCost;
			// Dated to the last trade: this residual belongs to the sale that
			// closed the position, which is the row that produced it.
			realize(pool, pool.lastTradeDate ?? "", -pool.bookCost);
			pool.shares = 0;
			pool.bookCost = 0;
		} else if (pool.shares < 0) {
			// Already flagged as `sold-more-than-held`. Clamp so nothing downstream
			// renders a negative holding, but keep the issue attached.
			pool.realizedPnl -= pool.bookCost;
			realize(pool, pool.lastTradeDate ?? "", -pool.bookCost);
			pool.shares = 0;
			pool.bookCost = 0;
		}

		if (pool.bookCost < MONEY_EPSILON) pool.bookCost = 0;
	}

	const positions: Position[] = pools.map((pool) => ({
		accountId: pool.accountId,
		accountType: pool.accountType,
		symbol: pool.symbol,
		aliases: pool.aliases,
		name: pool.name,
		shares: pool.shares,
		bookCost: pool.bookCost,
		averageCost: pool.shares > 0 ? pool.bookCost / pool.shares : null,
		realizedPnl: pool.realizedPnl,
		proceeds: pool.proceeds,
		costBasis: pool.costBasis,
		dividends: pool.dividends,
		commission: pool.commission,
		listing: detectListing(pool.rows),
		lastFxRate: pool.lastFxRate,
		firstTradeDate: pool.firstTradeDate,
		lastTradeDate: pool.lastTradeDate,
		tradeCount: pool.tradeCount,
		issues: [...pool.issues.values()],
	}));

	const open = positions
		.filter((position) => position.shares > SHARE_EPSILON)
		.sort(
			(a, b) => b.bookCost - a.bookCost || a.symbol.localeCompare(b.symbol),
		);
	const closed = positions
		.filter((position) => position.shares === 0 && position.tradeCount > 0)
		.sort(
			(a, b) =>
				(b.lastTradeDate ?? "").localeCompare(a.lastTradeDate ?? "") ||
				a.symbol.localeCompare(b.symbol),
		);
	const incomeOnly = positions
		.filter((position) => position.tradeCount === 0)
		.sort((a, b) => b.dividends - a.dividends);

	const bySymbol = rollUpSymbols(positions);
	const byAccount = rollUpAccounts(positions, accounts, options.sources);
	const byAccountType = rollUpAccountTypes(byAccount, positions);

	const issues = byAccount
		.filter((account) => account.historyConfidence === "suspect")
		.map(
			(account) =>
				`${account.accountId} (${account.accountType}): ${account.historyReasons.join(" ")}`,
		);

	const realizations = pools
		.flatMap((pool) => pool.realizations)
		.sort(
			(a, b) =>
				a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol),
		);

	return {
		positions,
		open,
		closed,
		incomeOnly,
		bySymbol,
		byAccount,
		byAccountType,
		realizations,
		totals: {
			bookCost: sum(open, (position) => position.bookCost),
			realizedPnl: sum(positions, (position) => position.realizedPnl),
			dividends: sum(positions, (position) => position.dividends),
			withholdingTax: sum(byAccount, (account) => account.withholdingTax),
			fees: sum(byAccount, (account) => account.fees),
			cashBalance: sum(byAccount, (account) => account.cashBalance),
			openCount: open.length,
			closedCount: closed.length,
		},
		issues,
	};
}

function sum<T>(rows: T[], value: (row: T) => number): number {
	let total = 0;
	for (const row of rows) total += value(row);
	return total;
}

function rollUpSymbols(positions: Position[]): SymbolRollup[] {
	const bySymbol = new Map<string, SymbolRollup>();

	for (const position of positions) {
		let row = bySymbol.get(position.symbol);
		if (!row) {
			row = {
				symbol: position.symbol,
				name: position.name,
				listing: position.listing,
				shares: 0,
				bookCost: 0,
				costBasis: 0,
				proceeds: 0,
				realizedPnl: 0,
				dividends: 0,
				commission: 0,
				accountIds: [],
				firstTradeDate: null,
				lastTradeDate: null,
			};
			bySymbol.set(position.symbol, row);
		}

		row.shares += position.shares;
		row.bookCost += position.bookCost;
		row.costBasis += position.costBasis;
		row.proceeds += position.proceeds;
		row.realizedPnl += position.realizedPnl;
		row.dividends += position.dividends;
		row.commission += position.commission;
		if (!row.name) row.name = position.name;
		// A symbol traded in two accounts takes whichever pool was seen first, so
		// make sure a pool that produced no evidence never overwrites one that did.
		if (row.listing === "unknown") row.listing = position.listing;
		if (!row.accountIds.includes(position.accountId)) {
			row.accountIds.push(position.accountId);
		}
		if (
			position.firstTradeDate &&
			(!row.firstTradeDate || position.firstTradeDate < row.firstTradeDate)
		) {
			row.firstTradeDate = position.firstTradeDate;
		}
		if (
			position.lastTradeDate &&
			(!row.lastTradeDate || position.lastTradeDate > row.lastTradeDate)
		) {
			row.lastTradeDate = position.lastTradeDate;
		}
	}

	return [...bySymbol.values()].sort(
		(a, b) => b.bookCost - a.bookCost || a.symbol.localeCompare(b.symbol),
	);
}

/**
 * The position flags that mean "shares or cost are missing from the file". A
 * rename or an unpaired corporate action is worth showing on the position but
 * doesn't imply the account's history is truncated.
 */
const HISTORY_FLAGS = new Set<PositionFlag>([
	"first-trade-is-sell",
	"sold-more-than-held",
	"basis-exhausted",
	"income-without-trades",
]);

/**
 * The residual bounds `validateDataset` uses for I5. A negative balance is
 * arithmetically impossible in a complete export, and an implausibly large one
 * means rows were dropped or duplicated — either way, basis is unreliable.
 */
const CASH_RESIDUAL_LIMIT = 10_000;

function rollUpAccounts(
	positions: Position[],
	tallies: Map<string, AccountTally>,
	sources?: SourceSummary[],
): AccountRollup[] {
	// Which accounts sit inside a source the merge couldn't reconcile.
	const conflicted = new Set<string>();
	for (const source of sources ?? []) {
		if (source.confidence !== "low") continue;
		for (const segment of source.segments) conflicted.add(segment.accountId);
	}

	const rollups: AccountRollup[] = [];

	for (const tally of tallies.values()) {
		const owned = positions.filter(
			(position) => position.accountId === tally.accountId,
		);
		const reasons: string[] = [];

		const flagged = owned.filter((position) =>
			position.issues.some((issue) => HISTORY_FLAGS.has(issue.flag)),
		);
		if (flagged.length > 0) {
			reasons.push(
				`${flagged.length} ${flagged.length === 1 ? "holding is" : "holdings are"} missing buys (${flagged.map((position) => position.symbol).join(", ")}).`,
			);
		}

		// I5 (§6.1) — the strongest signal available. Σ net cash over an account
		// is its uninvested balance, so a negative residual can only mean rows are
		// missing, and an implausibly large one means they were duplicated.
		if (
			tally.cashBalance < -MONEY_EPSILON &&
			// A margin account is meant to go negative — that is the loan, not a
			// gap in the history.
			!isMarginAccount(tally.accountType)
		) {
			reasons.push(
				`Its cash works out to ${tally.cashBalance.toFixed(2)}, which is impossible — activity is missing.`,
			);
		} else if (tally.cashBalance > CASH_RESIDUAL_LIMIT) {
			reasons.push(
				`Its cash works out to ${tally.cashBalance.toFixed(2)}, which is too large to be an idle balance — rows may be duplicated.`,
			);
		}

		if (conflicted.has(tally.accountId)) {
			reasons.push(
				"Two loaded files disagree about this account's overlapping period.",
			);
		}

		rollups.push({
			accountId: tally.accountId,
			accountType: tally.accountType,
			positions: owned,
			openCount: owned.filter((position) => position.shares > SHARE_EPSILON)
				.length,
			closedCount: owned.filter(
				(position) => position.shares === 0 && position.tradeCount > 0,
			).length,
			bookCost: sum(owned, (position) => position.bookCost),
			realizedPnl: sum(owned, (position) => position.realizedPnl),
			dividends: sum(owned, (position) => position.dividends),
			withholdingTax: -tally.taxSigned,
			fees: -tally.feesSigned,
			interest: tally.interest,
			cashBalance: tally.cashBalance,
			firstActivityDate: tally.firstActivityDate,
			lastActivityDate: tally.lastActivityDate,
			historyConfidence: reasons.length > 0 ? "suspect" : "complete",
			historyReasons: reasons,
		});
	}

	return rollups.sort(
		(a, b) => b.bookCost - a.bookCost || a.accountId.localeCompare(b.accountId),
	);
}

function rollUpAccountTypes(
	accounts: AccountRollup[],
	positions: Position[],
): AccountTypeRollup[] {
	const byType = new Map<string, AccountTypeRollup>();

	for (const account of accounts) {
		let row = byType.get(account.accountType);
		if (!row) {
			row = {
				accountType: account.accountType,
				accountIds: [],
				bookCost: 0,
				realizedPnl: 0,
				dividends: 0,
				withholdingTax: 0,
				fees: 0,
				cashBalance: 0,
				openCount: 0,
				closedCount: 0,
				bookCostByListing: emptyByListing(),
				historyConfidence: "complete",
			};
			byType.set(account.accountType, row);
		}

		row.accountIds.push(account.accountId);
		row.bookCost += account.bookCost;
		row.realizedPnl += account.realizedPnl;
		row.dividends += account.dividends;
		row.withholdingTax += account.withholdingTax;
		row.fees += account.fees;
		row.cashBalance += account.cashBalance;
		row.openCount += account.openCount;
		row.closedCount += account.closedCount;
		if (account.historyConfidence === "suspect") {
			row.historyConfidence = "suspect";
		}
	}

	for (const position of positions) {
		const row = byType.get(position.accountType);
		if (row) row.bookCostByListing[position.listing] += position.bookCost;
	}

	return [...byType.values()].sort(
		(a, b) =>
			b.bookCost - a.bookCost || a.accountType.localeCompare(b.accountType),
	);
}

/** How a listing reads in the UI and in the exported sheet. */
export const LISTING_LABELS: Record<Listing, string> = {
	ca: "Canadian-listed",
	us: "US-listed",
	crypto: "Crypto",
	unknown: "Unknown",
};
