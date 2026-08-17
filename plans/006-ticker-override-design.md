# Plan 006 (deliverable): Per-symbol ticker override — design

> Written as the deliverable for `plans/006-ticker-override-spike.md`. **Nothing
> here shipped.** No production code was changed; no prototype branch was cut
> (every question was settled by reading). Investigated at commit `b1720b8`.

## 1. Recommendation

Build the Yahoo-path override first, as one map keyed by the export's symbol,
persisted under a third key in the existing `prices` IndexedDB store, reachable
through a fifth field on `usePriceStore`. Make `tickersFor` take an optional
second argument and change nothing else in `src/lib/`. Do **not** let a user
type a ticker and save it: make the affordance *resolve-then-confirm* — the app
quotes the candidate ticker, shows Yahoo's name and price for it, and stores the
name alongside the ticker as a pin. Every later fetch re-checks the name; a
mismatch suspends the override, and the holding falls back to book cost and is
named, which is the failure mode this app already has and already handles well.
Put the affordance on a list driven by the two *miss* lists rather than on the
holdings table, because since plan 010 a closed symbol can be mis-priced too and
the holdings table only shows open positions. Ship the Google-dialect half
second: teach `parsePriceCsv` to read the `Google ticker` column it already
declares, and adopt an edited ticker **only when that row also carried a price**
— an edited ticker that produced a number has verified itself.

## 2. What the drift check found

`git diff --stat 8f123b3..HEAD -- src/lib/yahoo-ticker.ts src/lib/price-snapshot.ts src/lib/google-sheet.ts src/stores/prices.ts`

- `src/lib/yahoo-ticker.ts` — unchanged. The spike's central excerpt is exact.
- `src/stores/prices.ts` — unchanged in this window.
- `src/lib/price-snapshot.ts` — changed by plan 012 (the `toNumber` separator
  rule). `COLUMNS` and `parsePriceCsv`'s body are untouched.
- `src/lib/google-sheet.ts` — changed by plan 016 (five unused locals removed in
  `buildSummarySheet`). The Holdings tab, `HOLDINGS_HEADERS` and
  `googleTickerGuess` are untouched.

**The premise stands.** `grep -n "COLUMNS\." src/lib/price-snapshot.ts` still
returns exactly three lines — `:76`, `:94`, `:98` — and `COLUMNS.ticker` is not
among them. The app writes an editable ticker column
(`src/lib/google-sheet.ts:283-292`, `:473`), tells the user to edit it
(`src/lib/google-sheet.ts:455-459`), and throws the edit away.

Discrepancies against the plan's prose are listed in §10.

## 3. Step 1 verification — the two one-sentence statements

**Yahoo.** A symbol becomes a Yahoo ticker in `yahooTickerGuess`
(`src/lib/yahoo-ticker.ts:24-39`): the export's bare symbol is trimmed and
upper-cased, dots become hyphens (`CTC.A` → `CTC-A`), and then the `listing`
that `detectListing` inferred from the presence of an `FX Rate:` marker
(`src/lib/positions.ts:253-258`) decides the suffix — `.TO` for `ca`, `-CAD` for
`crypto`, nothing at all for `us` or `unknown`.

**Google.** A symbol becomes a Google ticker in `googleTickerGuess`
(`src/lib/google-sheet.ts:218-231`): the same `listing` decides a *prefix* on
the untouched symbol — `TSE:` for `ca`, `CURRENCY:…CAD` for `crypto`, nothing
for `us` or `unknown` — and the dot in a class share is kept, because Google has
no exchange suffix competing for it.

## 4. Step 2 verification — every call site

`grep -rn "tickersFor\|yahooTickerGuess\|googleTickerGuess" src/`

| Site | What it is | Needs the map? |
|---|---|---|
| `src/components/investment/live-prices-button.tsx:76` | `tickersFor(report.open)` — the **quote** request | **Yes.** Already reads `usePriceStore` at `:72-73`, so the map is one more selector away. |
| `src/components/investment/live-prices-button.tsx:250` | `tickersFor(kept)` inside `historyTickersFor` — the **history** request | **Yes.** `historyTickersFor` (`:228-254`) is a module-local function, not a component, so the map arrives as a third parameter from the component body. |
| `src/lib/google-sheet.ts:473` | `googleTickerGuess(position)` writing the Holdings row | **Yes, but deferred** (slice 2). Needs the map threaded into `buildWorkbook` via `SheetOptions` (`:233-243`). |
| `src/lib/yahoo-ticker.ts:67` | `yahooTickerGuess` inside `tickersFor` | It *is* the seam. Stays as the fallback. |
| `src/lib/yahoo-ticker.test.ts:39,53,58` | tests of `tickersFor` | No — an optional parameter with a `{}` default leaves them compiling and passing. |
| `src/lib/google-sheet.test.ts:200-206` | tests of `googleTickerGuess` | No. |
| `src/lib/live-prices.ts:25,115,210` | doc comments only | No. |

Two call sites, not one. The plan's Step 1 calls
`live-prices-button.tsx` "the single call site"; plan 010 added the second. The
two requests deliberately ask about **different symbol sets** — the quote asks
about `report.open`, the history asks about `report.bySymbol` (every symbol ever
held) ranked and truncated to `MAX_HISTORY_SYMBOLS`
(`live-prices-button.tsx:228-254`). This is load-bearing for the design: see Q8
and Q11.

## 5. Answers

### Storage and lifetime

**Q1 — Where does the override map live?**

A third key in the `PRICES` object store, mirrored on `usePriceStore`. **Not** a
field on `PriceSnapshot`.

Justification, in order of weight:

1. **A field on `PriceSnapshot` would be destroyed on every fetch.**
   `setSnapshot` replaces the whole object (`src/stores/prices.ts:78-88`), and
   both producers build a snapshot from nothing —
   `snapshotFromLivePrices` (`src/lib/live-prices.ts:136-155`) and
   `parsePriceCsv` (`src/lib/price-snapshot.ts:67-125`). Carrying an override
   through would mean two pure `src/lib/` functions had to learn about
   persisted user state they have no business knowing.
2. **The lifetimes genuinely differ.** A snapshot goes stale in days and is
   replaced wholesale; an override is a durable correction the user made once
   and must survive every refetch. That is the same argument
   `src/stores/prices.ts:14-26` already makes for keeping `history` beside
   `snapshot` rather than inside it, and the same one
   `src/lib/storage.ts:22-26` encodes with `HISTORY_KEY`.
3. **The wipe lifetime is right.** `clearStorage` clears the whole `PRICES`
   store (`src/lib/storage.ts:354-367`) with the comment "Prices describe the
   holdings in those files". An override describes a holding in those files too,
   so it should die with them.
4. **No schema migration** — the STOP condition is not triggered. The schema is
   derived from the `STORES` list, not from a version constant
   (`src/lib/storage.ts:40-44`, `:71-99`), and `PRICES` already exists with
   `keyPath: "key"`. A third key is a record, written with an ordinary `put`.

```ts
// src/lib/storage.ts, beside SNAPSHOT_KEY and HISTORY_KEY
/** Shares the `prices` store with the snapshot — same lifetime, same wipe. */
const OVERRIDES_KEY = "overrides";
```

**Q2 — Clear data / a new CSV / a `PARSER_VERSION` bump.**

- **Clear data → wiped, correctly.** `clearStorage` (`src/lib/storage.ts:362`)
  clears the store; `dataset.clear` (`src/stores/dataset.ts:164-169`) then calls
  `usePriceStore.getState().reset()` to drop the in-memory copy. **Implementer
  trap:** `reset()` and `clear()` (`src/stores/prices.ts:98-110`) each set three
  fields explicitly. Adding a fourth field without adding it there leaves the
  override map alive in memory after a wipe, and the next `setSnapshot` re-writes
  it to a database that was just emptied. Both functions must be extended.
- **A new CSV missing that symbol → nothing happens, by design.** `addSources`
  (`src/stores/dataset.ts:121-138`) never touches the price store. Recommend:
  **keep** the entry but never *apply* an override whose symbol is absent from
  `report.bySymbol`. Auto-pruning is wrong — a user who loads a single-year
  export would silently lose corrections for every symbol outside that year.
  Orphans get listed in the manage surface with a one-click delete (slice 2).
- **A `PARSER_VERSION` bump → no effect, correctly.** The version gate is on
  `SOURCES` entries only (`src/lib/storage.ts:184`); `PRICES` is untouched. An
  override describes an instrument, not a parse.

**Q3 — What stops a stale override mis-pricing a holding for years?**

In its own section: §6. Summary: overrides are never stored unverified, are
pinned to the security name Yahoo returned when they were confirmed, are
re-checked against that name on every quote fetch, and are **suspended** on
mismatch — which drops the holding back to the app's existing loud failure mode
rather than leaving it quietly wrong.

### The two price paths

**Q4 — One map or two?**

**One map, keyed by symbol, with a slot per dialect.** Not two independent maps,
and not Yahoo-only.

- Yahoo-only is tempting (it is the only path with no fix today) but it forfeits
  Q5, and Q5 is the cheapest thing in this whole feature. It would also leave the
  spike's own headline finding — the app instructs an edit and discards it —
  unaddressed.
- Two independent maps and one map with two slots hold identical data. Prefer
  one: one store field, one storage key, one lifetime, one place to get the wipe
  wrong. And the manage-overrides row a user reads is "what does `BTCC.B`
  resolve to?", which wants both dialects on one line.

The dialects cannot share a string —
`TSE:VFV` vs `VFV.TO`, `CURRENCY:BTCCAD` vs `BTC-CAD`
(`src/lib/yahoo-ticker.ts:1-23`, `docs/yahoo-pricing-poc.md` §3) — so the slots
are genuinely separate values, never derived from each other.

One asymmetry to accept deliberately: **the verification mechanism in §6 exists
only on the Yahoo path.** The quote route returns a security name
(`src/app/api/prices/route.ts:121`); Google Sheets returns a bare number. So a
Google-slot override is never used to compute a price the app displays — it is
only written into the exported workbook as the pre-filled `Google ticker` cell.
The price still arrives as a number the user watched resolve in Sheets. The
user's own eyes are the verification on that path, which is exactly what makes
the Sheets path worth keeping.

**Q5 — Should `parsePriceCsv` adopt the edited cell?**

Yes, in slice 2, with one constraint that turns it from a liability into the
best-verified input in the feature:

> **Adopt an edited ticker only from a row that also carried a price.**

An edited ticker that produced a number has demonstrably resolved in Google
Finance. An edited ticker on a blank-price row is a guess the user made that
*did not work*, and adopting it would persist a known-bad value.

Shape: keep `src/lib/` pure. `parsePriceCsv` gains one field on its return —
`googleTickers: Record<string, string>`, populated only for priced rows where
the cell differs from `googleTickerGuess` — and the caller
(`src/components/investment/import-prices-dialog.tsx:73`) decides what to do
with it. That keeps `parsePriceCsv` a function from text to data, and keeps the
decision to persist user state in a component, where it belongs.

Reconciled with Q4: this writes the **Google slot** only. It never touches the
Yahoo slot, because a Google-dialect string is not a Yahoo ticker and
translating between them would be a third guess.

### The seam

**Q6 — The minimal signature change.**

```ts
// src/lib/yahoo-ticker.ts
export function tickersFor(
	positions: Pick<Position, "symbol" | "listing">[],
	overrides: TickerOverrides = {},
): { symbol: string; ticker: string }[] {
	const bySymbol = new Map<string, string>();

	for (const position of positions) {
		if (!position.symbol) continue;
		if (bySymbol.has(position.symbol)) continue;
		bySymbol.set(
			position.symbol,
			activeYahooTicker(overrides[position.symbol]) ??
				yahooTickerGuess(position),
		);
	}
	// …unchanged
}
```

Properties that make this the minimal change:

- **Optional with a `{}` default**, so `src/lib/yahoo-ticker.test.ts:39,53,58`
  and any future caller compile untouched.
- **`yahooTickerGuess` is untouched and still the fallback**, so the second STOP
  condition ("the override should replace rather than supplement the guess") is
  not triggered. The doc comment at `src/lib/yahoo-ticker.ts:21-22` stays true:
  a symbol with no override, or with a suspended one, still comes back unpriced
  rather than wrong.
- **`src/lib/` purity holds.** `tickersFor` gains a plain-data parameter; it
  imports no store, no React, no storage.
- **`activeYahooTicker` returns `undefined` for a suspended entry**, so
  suspension is expressed as "fall back to the guess" rather than as a second
  code path.

Call sites that must change: **two**, both in
`src/components/investment/live-prices-button.tsx`.

```ts
const overrides = usePriceStore((state) => state.overrides);   // new selector
const symbols = tickersFor(report.open, overrides);            // :76
const historyRequest = historyTickersFor(report, symbols, overrides); // :77
// …and inside historyTickersFor (:250)
symbols: tickersFor(kept, overrides),
```

Files touched by the seam itself: `yahoo-ticker.ts` and `live-prices-button.tsx`
— two. Adding persistence brings in `storage.ts` and `stores/prices.ts`, but
those are additive keys and fields, not threading. **The third STOP condition
(state threaded through more than three files) is not triggered**: the button is
already a `"use client"` consumer of `usePriceStore`
(`live-prices-button.tsx:72-73`), so nothing is prop-drilled at all.

One requirement the seam creates: `TICKER_SHAPE` is
`/^[A-Za-z0-9.=^-]{1,20}$/` (`src/lib/live-prices.ts:211`), and
`readRequestSymbols` throws on the first violation
(`:246-248`), which the route turns into a 400 for the **whole request**. A user
who pastes `TSE:VFV` into the Yahoo box would therefore kill pricing for every
symbol at once. So the override must be validated against the same pattern
*where it is entered*, and a stored entry that somehow fails it must be treated
as suspended. Export the pattern (or a `isTickerShaped` helper) from
`live-prices.ts` rather than duplicating it — `:213-224` says in as many words
that duplicating these checks is what drifts.

**Q7 — Do `valueYears` / `valueOverTime` touch ticker resolution?**

**No. Confirmed by reading, not assumed. The override is purely a fetch-time
concern.**

Both look prices up by the *Wealthsimple symbol*, never by a ticker:
`history.monthlyCad[position.symbol]?.[month]` at
`src/lib/price-history.ts:130` (`valueOverTime`) and `:253` (`valueYears`).
`monthlyCad` is keyed by `series.symbol` in `historyFromResponse`
(`src/lib/price-history.ts:44-58`), and the route echoes the request's `symbol`
straight back (`src/app/api/prices/history/route.ts:135`,
`series.push({ ...entry, … })`). The ticker is consumed inside the route and
never appears downstream. The same holds for the quote path:
`snapshotFromLivePrices` writes `pricesCad[quote.symbol]`
(`src/lib/live-prices.ts:142`), and `valueWith` reads
`snapshot.pricesCad[position.symbol]` (`src/lib/price-snapshot.ts:216`). The
existing test at `src/lib/yahoo-ticker.test.ts:51-55` asserts this separation
deliberately.

**This bounds the blast radius of the whole feature**: an override can only fetch
the wrong *price* for the right *holding*. It can never move a price onto a
different holding.

But it creates one obligation. A stored `PriceHistory` is keyed by symbol while
its *values* were fetched under the old ticker. Changing an override therefore
silently leaves another company's monthly closes sitting under the right symbol
— exactly the silent-wrong-number failure this design exists to prevent. So:

> **Setting or changing an override must drop that symbol's entry from
> `history.monthlyCad`** (and add it to `history.unpriced`), so the analytics
> page falls back to book cost and names it until the next fetch.

Correction #2 to the plan — that a closed holding can now be priced historically
— makes this mandatory rather than nice: for a symbol sold in 2023, the history
is the *only* thing an override affects, so an override that doesn't invalidate
the history does nothing at all until a full refetch.

### The UI

**Q8 — Where does a user edit an override?**

**Neither of the two candidates the plan offers, for the first slice.** Judgement
call; here is the reasoning and the recommendation.

- `import-prices-dialog.tsx` is the **Sheets** dialog. Its entire body is the
  export→Sheets→download→drop loop (`:99-123`), and its own miss copy already
  tells the user to "fix that row's Google ticker … in the sheet and re-download"
  (`:186-194`). Putting the *Yahoo* override there attaches the fix to the one
  path that already has a fix.
- `holdings-table.tsx` is the right *eventual* home but wrong now, for two
  reasons found by reading it. It renders `report.open` only
  (`investment-overview.tsx:93`), so **it cannot reach a closed symbol at all** —
  and since plan 010 a closed symbol is exactly what the history request prices.
  And it has no price or market-value column today (`:49-163`), so "unpriced" is
  not currently a visible state on that surface; adding the affordance means
  first inventing the state it hangs off.

**Recommendation: a small "Tickers" panel, reached from the live-prices card
(`src/components/live-prices-card.tsx:55`) and from the failure toasts, whose
rows are the union of the two miss lists** — `response.misses` from the quote
(`live-prices-button.tsx:311`) and `history.unpriced` from the history
(`:129`, `:279-283`). That set is precisely "symbols an override would help",
open and closed alike, and the app already computes both halves. One new
surface, no new derived state, and it covers the case the holdings table
structurally cannot.

Slice 2 adds the inline affordance in `holdings-table.tsx`. Note when it does:
the table is one row per (account, symbol) (`rowKey` at `:182`) while an override
is per symbol, so setting it on one row must visibly change every row for that
symbol.

**Q9 — How does the user know an override is needed?**

Better than the plan's framing suggests, and still not good enough.

An unpriced holding is named in **five** persistent places, not only a toast:
`holdings-summary.tsx:105-106`, `import-prices-dialog.tsx:186-194`,
`analytics-overview.tsx:209-210`, `year-account-detail.tsx:171-172` and
`capital-chart.tsx:137,165` — plus the toasts at
`live-prices-button.tsx:281,311`. So discoverability of the *fact* is fine.

What is missing is that none of those is **actionable** and none says *why*. The
sentence "No price for BTCC.B, so it is left out of both figures" does not tell
the reader that the cause is a guessed ticker or that they can fix it. So:

**Recommendation** — no new persistent affordance in the first slice. Instead,
make the existing miss copy actionable: the same sentence gains a link into the
Tickers panel from Q8. That is a one-line change per site against a new column
in a table, and it converts five existing surfaces at once. A persistent per-row
marker in the holdings table follows in slice 2, once that table has a price
column to attach it to.

**Q10 — How does a user tell a correct override from a wrong one?**

**Yahoo's security name does reach the client, and is then thrown away.**

- The field exists on the wire type: `name: string | null`, documented as "Yahoo's
  name for the instrument, to check the ticker guess landed"
  (`src/lib/live-prices.ts:40`).
- The route populates it from `quote.shortName ?? quote.longName`
  (`src/app/api/prices/route.ts:121`).
- It arrives in the browser inside `LivePriceResponse`, which
  `live-prices-button.tsx:82-83` holds in `response`.
- And then: `grep -rn "quote.name" src/` returns **nothing**.
  `snapshotFromLivePrices` (`src/lib/live-prices.ts:136-155`) copies only
  `priceCad` into `pricesCad`, so the name dies at the moment the response
  becomes a snapshot. It is never displayed and never persisted.

So showing it costs **no route change and no wire change** — only carrying one
field out of a response the client already has. It solves the question
completely: "you asked for `BRK-B` and Yahoo says that is Berkshire Hathaway"
is a check a human can make in one glance, and it is the pin the staleness
mechanism in §6 re-checks.

Two limits, stated plainly:

- `LivePriceMiss` (`src/lib/live-prices.ts:49-52`) has no name, correctly —
  there is nothing to name.
- `PriceHistorySeries` (`:85-90`) has **no name field at all**, and the history
  route never reads one (`src/app/api/prices/history/route.ts:60-140`). So the
  history path cannot verify. This is why the confirm step in §6 always routes
  through the *quote* endpoint, even for a symbol the user no longer holds —
  Yahoo will quote a ticker regardless of whether you own it. Whether Yahoo's
  chart response carries a usable `longName` in its `meta` block is **not
  determinable from this codebase**; the route does not read it and I did not
  call the API. If it does, adding it later would let history misses self-verify
  too.

### Scope control

**Q11 — The smallest version worth shipping.** See §8 (first slice) and §9
(deferred).

**Q12 — What tests, in which files.**

Modelled on the existing colocated suites; `environment: "node"`, no mocks, no
fake timers, injectable `now`/`asOf` (`AGENTS.md`, `vitest.config.mts`).

| File | What it must cover |
|---|---|
| `src/lib/yahoo-ticker.test.ts` (extend) | An active override wins over the guess. No override falls through to the guess unchanged (the existing cases must not move). A suspended override falls back to the guess. An override is keyed by the *export* symbol, not by the guessed ticker — extend the existing `:51-55` case. An override for a symbol not in the input list is ignored. An empty or whitespace override is ignored. |
| `src/lib/ticker-overrides.test.ts` (new) | The verification predicate: pinned name matches returned name → active; differs → suspended; no pinned name → unverified and therefore not applied. Name normalisation (case, collapsed whitespace, the non-breaking spaces `normalizeName` already handles at `positions.ts:246-250`). A ticker failing `TICKER_SHAPE` is rejected at entry. Pure functions, so this is where the money-critical logic gets its coverage. |
| `src/lib/price-snapshot.test.ts` (extend, slice 2) | `parsePriceCsv` reports an edited `Google ticker` on a **priced** row, and does **not** report one on a blank-price row. The file already imports `buildWorkbook` (`:1-12`), so the full write-a-sheet-then-parse-it-back round trip is testable in one test without a fixture. |
| `src/lib/live-prices.test.ts` (extend) | `:204` already asserts every ticker shape `tickersFor` can produce is accepted by `readRequestSymbols`. An override widens the alphabet that reaches the route, so extend it with override-shaped tickers (`XYZ.V`, `XYZ.NE`, `BRK-B`) and add the negative case that a colon-bearing Google ticker is rejected — the bug in Q6 where one bad override 400s the whole batch. |
| Components | **None.** `AGENTS.md` is explicit that JSX is deliberately untested. |

## 6. Staleness strategy (Q3, in full)

This is the risk that makes or breaks the feature, and it is worth being precise
about why. Today's failure mode is *good*: a bad guess produces a miss, the
holding is carried at book cost (`price-snapshot.ts:228-232`,
`price-history.ts:255-259`), and five surfaces name the symbol. The number on
screen is conservative and the app says which one is missing. An override
replaces that with a number that **looks correct**. A wrong override is strictly
worse than no override.

The design is therefore built so that **a wrong override degrades into today's
failure mode**, automatically, without the user noticing anything is wrong first.

**1. An override is never stored from a text field.** The affordance is
resolve-then-confirm. The user types a candidate; the app POSTs that single
ticker to `/api/prices` (one symbol, well inside `MAX_SYMBOLS`); the dialog shows
what came back — the security **name** (`route.ts:121`), the native price, the
currency, and the market state — and the user confirms *that*, not the string.
A candidate that misses cannot be saved at all. This alone eliminates the
typo-shaped failure, which is the most common one.

**2. The name is pinned.** The confirmed entry stores the name Yahoo returned and
the date it was confirmed:

```ts
{ ticker: "CTC-A.TO", name: "Canadian Tire Corporation, Limited", confirmedAt: "2026-08-17" }
```

**3. Every quote fetch re-verifies.** The quote response already carries a name
per ticker, for every symbol, on every fetch — the app just discards it today
(Q10). So the check is free: after each fetch, for every symbol with an
override, compare the returned name to the pinned one, normalised for case,
collapsed whitespace and the non-breaking spaces the export is full of.

**4. A mismatch suspends the override.** Not "flags", not "warns while still
using it" — suspends. `activeYahooTicker` returns `undefined`, `tickersFor`
falls back to `yahooTickerGuess`, and on the *next* fetch the holding almost
certainly misses and lands at book cost, named in all five existing surfaces,
with a message that says what happened: *"`CTC-A.TO` now resolves to
'Something Else Inc', not 'Canadian Tire Corporation, Limited'. This override is
paused; confirm it or change it."*

The trade is deliberate and asymmetric. A **false positive** — Yahoo cosmetically
renames a security — costs the user one page load at book cost and one click to
re-confirm. A **false negative** — a recycled or reassigned ticker — costs years
of a wrong portfolio value on real money. Suspend.

**5. The blast radius is already bounded by the code.** Per Q7, the snapshot and
history are keyed by the export's symbol throughout, so an override can only
fetch a wrong price for the right holding. It can never silently reattribute a
price to a different holding, and it can never affect a symbol other than its
own key.

**6. Changing an override invalidates that symbol's stored history** (Q7). Without
this, the mechanism above catches the *quote* and leaves years of the wrong
company's monthly closes in place.

**7. An override is never invisible.** Wherever a price is attributed —
`holdings-summary.tsx:99-107` today — an overridden symbol is marked, with its
ticker and pinned name available. State the user can't see is state the user
can't audit. And the manage surface (Q8) lists every override with its
`confirmedAt` date, so "I set this three years ago" is a visible fact rather than
an archaeological one.

**8. Rejected: price-plausibility bands.** Comparing the returned price against
the position's average cost sounds appealing and is not worth shipping. It
false-positives on any holding that genuinely multiplied (which is the holding
the user most wants valued) and false-negatives on the dangerous case — a wrong
ticker in the same sector at a similar price. Recommendation: do not build it.
The name check is the one that actually discriminates.

**9. Explicitly not solved.** Nothing here catches a ticker that is wrong *and*
resolves to a name similar enough to pass normalisation — a dual-listed share
class, say, `XYZ.TO` versus `XYZ.NE`, where both are the same issuer at
genuinely different prices. The confirm step's display of the price and market
state is the only defence, and it is a human one. This residual is worth naming
in the maintainer's copy rather than pretending away.

## 7. Data shape

```ts
// src/lib/ticker-overrides.ts — new, pure, no imports outside src/lib/

/** A ticker the user supplied and confirmed against what came back. */
export interface TickerOverride {
	/** The ticker, in the dialect of the path that uses it. */
	ticker: string;
	/**
	 * The security name the source returned when this was confirmed. The pin
	 * that makes a later mismatch detectable. Null on the Google slot, which
	 * has no name to return — see §5 Q4.
	 */
	name: string | null;
	/** `YYYY-MM-DD`, local, via `todayLocalIso` — never `new Date()` (§1.3). */
	confirmedAt: string;
	/**
	 * Set when a later fetch returned a different name. The override stops
	 * applying and the guess resumes, so the holding falls back to book cost
	 * and is named, rather than being priced as something it is not.
	 */
	suspended?: { name: string | null; at: string };
}

/** Keyed by the *export's* symbol — never by a ticker, never by `name` (§2.5). */
export type TickerOverrides = Record<
	string,
	{ yahoo?: TickerOverride; google?: TickerOverride }
>;
```

Persisted under `OVERRIDES_KEY = "overrides"` in the existing `PRICES` object
store (`src/lib/storage.ts:22-26`, `:40-44`), via
`loadTickerOverrides` / `saveTickerOverrides` modelled byte-for-byte on
`loadPriceHistory` / `savePriceHistory` (`:324-352`). Exposed as
`overrides: TickerOverrides` on `usePriceStore`, hydrated in the same
`Promise.all` at `src/stores/prices.ts:55-58`, and — **critically** — cleared in
both `clear()` and `reset()` (`:98-110`).

Nothing here crosses the wire except `ticker`, which is what
`readRequestSymbols` already accepts. `name` and `confirmedAt` are local-only.
The `AGENTS.md` constraint — only ticker symbols leave the device — is unchanged.

## 8. First slice

Each step is small enough to be a step in a build plan, and carries its own
verification.

1. **Add `src/lib/ticker-overrides.ts`** with the types above plus
   `activeYahooTicker(entry)`, `nameMatches(a, b)` and `isTickerShaped(s)` (the
   last re-exported from `live-prices.ts`, not duplicated).
   *Verify*: `src/lib/ticker-overrides.test.ts` covers the Q12 row; `pnpm test`
   exits 0.
2. **Add the optional second parameter to `tickersFor`**
   (`src/lib/yahoo-ticker.ts:59-73`). `yahooTickerGuess` untouched.
   *Verify*: existing `yahoo-ticker.test.ts` passes unmodified; new cases for
   override-wins and suspended-falls-back pass; `pnpm typecheck` exits 0.
3. **Persist**: `OVERRIDES_KEY` + load/save in `src/lib/storage.ts`; `overrides`
   field, hydration, setter, and the additions to `clear()`/`reset()` in
   `src/stores/prices.ts`.
   *Verify*: set an override, reload the page, it is still there; run "Clear
   data", reload, it is gone. (Manual — IndexedDB is not in the node suite.)
4. **Thread both call sites** in
   `src/components/investment/live-prices-button.tsx` — `:76` and the new third
   parameter to `historyTickersFor` at `:77`/`:250`.
   *Verify*: with an override set for a symbol, the network tab shows the
   overridden ticker in **both** POST bodies, not just the quote.
5. **Carry the name out of the quote response.** Return the per-symbol names
   from the fetch alongside the snapshot so the confirm dialog and the
   re-verification step can read them. Do not add them to `PriceSnapshot` —
   `parsePriceCsv` cannot produce them and the two producers must not diverge.
   *Verify*: `response.quotes[n].name` is observably non-null for a known ticker.
6. **Build the Tickers panel** (Q8): rows from the union of `response.misses` and
   `history.unpriced`, plus every existing override. Each row: enter a candidate
   → resolve via `/api/prices` → show name, native price, currency, market state
   → confirm. Reject a candidate failing `isTickerShaped` before it is sent.
   *Verify*: a deliberately wrong candidate cannot be saved; a right one is
   saved with its name pinned.
7. **Wire the re-verification** (§6 steps 3–4) into the fetch path, and drop the
   symbol's `monthlyCad` entry whenever its override is set, changed, or
   suspended (§5 Q7).
   *Verify*: change an override; the analytics page shows that symbol at book
   cost until the next history fetch, and says so.
8. **Make the miss copy actionable** (Q9): the five existing sentences gain a
   link into the panel. Mark overridden symbols in `holdings-summary.tsx`.
   *Verify*: `pnpm check`, `pnpm typecheck`, `pnpm test` all exit 0.

## 9. Deferred

- **The Google slot and `parsePriceCsv` adoption (Q5).** Slice 2. Cheap, but it
  is a second dialect, a second call site (`google-sheet.ts:473`), a change to
  `SheetOptions`, and a `parsePriceCsv` return-shape change — all of which are
  easier to review once the Yahoo half's storage and lifetime are settled.
- **A manage-all-overrides surface with orphan pruning (Q2).** The first slice's
  panel lists overrides it knows about; a full list with delete and the
  "symbol no longer held" state is slice 2.
- **The inline affordance in `holdings-table.tsx` (Q8).** Waits on that table
  having a price column at all.
- **Overriding `listing` instead of `ticker`.** Rejected, not deferred. It would
  fix both dialects with one edit, but it puts the user inside
  `detectListing`'s inference (`positions.ts:253-258`) rather than at the
  answer, and it cannot express the cases an override is actually for —
  `.V`, `.NE`, a ticker change, a dual listing.
- **Price-plausibility bands.** Rejected; see §6 step 8.
- **Caching / rate limiting.** Out of scope here; that is
  `docs/yahoo-pricing-poc.md` §6 items 2 and 6, and plan 007.

## 10. Where the plan disagrees with the code

None of these invalidate the spike; recording them per the plan's drift note.

1. **`tickersFor` has two call sites, not one.** The plan's Step 1 calls
   `live-prices-button.tsx` "the single call site". Plan 010 added
   `tickersFor(kept)` inside `historyTickersFor`
   (`live-prices-button.tsx:250`), over a deliberately different symbol set.
   This changes the seam (Q6) and the first slice.
2. **Both of the plan's Q8 candidates are the wrong home for the first slice**,
   and the reason is the same plan-010 change: a closed symbol is now priced
   historically, and `holdings-table.tsx` renders `report.open` only. See Q8.
3. **Q9's premise is understated.** The plan says an unpriced holding "is named
   in a toast". It is named in five persistent surfaces as well
   (`holdings-summary.tsx:105`, `import-prices-dialog.tsx:188`,
   `analytics-overview.tsx:209`, `year-account-detail.tsx:171`,
   `capital-chart.tsx:137`). The gap is actionability, not visibility.
4. **Line numbers.** `google-sheet.ts` — the caveat text is at `:455-459` and
   `HOLDINGS_HEADERS` at `:283`, both as quoted; `price-snapshot.ts`'s `COLUMNS`
   is at `:26-31`. The `grep -n "COLUMNS\."` count — three, none of them
   `.ticker` — holds exactly, which the plan correctly says is the part that
   matters.
5. **A stale cross-reference in `docs/yahoo-pricing-poc.md`, not in the plan.**
   The §2 comparison table reads `| Fix a bad ticker | Edit the cell | Not yet —
   see §5 |`, but §5 is "The analytics page, year by year". The intended target
   is §6 item 1. The plan's abbreviated quote of that row drops the broken
   pointer, so the plan is *more* correct than the doc it cites. Worth a
   one-character fix in the doc when this feature lands.

## 11. Open questions for the maintainer

Two, both with a recommendation attached.

1. **Should a suspended override auto-resume if a later fetch returns the pinned
   name again?** (Yahoo does occasionally return a truncated or alternate name
   transiently.) *Recommendation: yes, auto-resume silently.* The pin matching
   again is exactly the evidence that justified the override in the first place,
   and requiring a manual re-confirm for a transient blip trains the user to
   click through the confirm dialog without reading it — which destroys the one
   defence in §6 that depends on a human.
2. **Should "Clear data" really take the overrides?** §5 Q1 argues yes on
   lifetime grounds, and I recommend yes. But an override is expensive knowledge
   the user researched once, and losing it to a button labelled "clear data" will
   sting. *Recommendation: keep the wipe, and mitigate it* — once slice 2 lands,
   the exported workbook carries the Google-dialect tickers and re-importing that
   sheet restores them, which gives the Sheets path a second job worth having.
