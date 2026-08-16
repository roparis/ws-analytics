# Design 007: Caching the price-history route

> Spike deliverable for plan `007-history-caching-spike.md`. No production code
> was changed to produce this document — see `git status --short` at the end of
> the executor's report. All findings below are grounded in code read on this
> branch, `origin/main` at `0d09156`.

## 1. Recommendation

**Client-side first, narrowing the request against the already-persisted
`PriceHistory`; server-side is not recommended at all under the current
deployment.** The route sets `cache-control: no-store` unconditionally
(`src/app/api/prices/history/route.ts:141`) and nothing today consults the
stored history before asking Yahoo for the full range again
(`src/components/investment/live-prices-button.tsx:112-116`) — yet the stored
shape is already keyed exactly the way a cache needs
(`src/lib/price-history.ts:33-41`, `src/lib/storage.ts:301-308`). That is
close to free: it needs no new infrastructure, and the app is explicit that
"nothing is uploaded" and "the server can see that someone asked what VFV is
worth; it cannot see that they own any of it" (`src/lib/live-prices.ts:7-17`).
A server-side cache breaks that promise a second time over: this app is
deployed at `https://ws-analytics.vercel.app`, so a shared cache would mean
the deployment now *retains* which symbols were looked up — not just sees them
in transit, which is the cost `docs/yahoo-pricing-poc.md` §1 already names
("whoever runs the deployment can see which symbols were looked up," lines
36-37). Client-side narrowing has no such retention: the cache lives in the
requester's own IndexedDB, exactly where `PriceHistory` already lives
(`src/lib/storage.ts:21-25`).

The one thing a server-side cache buys that client-side cannot is
cross-*user* deduplication on a shared deployment (two users both holding
`VFV.TO` currently cost two Yahoo requests, forever). That is real, but it is
not needed to fix the problem this spike exists for — the ten-second wait is
a **single-request-count** problem, and client-side narrowing removes those
requests for the single user who is waiting on them. Recommended order:
**ship client-side narrowing now; revisit server-side only if the maintainer
explicitly decides the cross-user dedup is worth the retention cost**, which
is their call, not an inference from "hosting is undecided" (it isn't).

## 2. Measured baseline

Every number below is labelled with its provenance. No live measurement was
taken — no browser, no real Wealthsimple export were available in this
environment, as the plan anticipated.

| Number | Value | Provenance |
|---|---|---|
| Upstream requests per inbound request | `distinctTickers + (needsFx ? 1 : 0)` | **derived from code** — the dedup Set and `Promise.all` fan-out (`src/app/api/prices/history/route.ts:65-74`), plus the conditional FX fetch (`:78-90`) |
| Worst case, at the route's own cap | `60 + 1 = 61` | **derived from code** — `MAX_HISTORY_SYMBOLS = 60` (`src/lib/live-prices.ts:119`) is enforced at `src/app/api/prices/history/route.ts:215-219` |
| Reference scenario (44 holdings) | 45 requests, ~10s at concurrency 4 | **quoted** — `docs/yahoo-pricing-poc.md` §6 item 2, lines 214-216 |
| Requests that repeat closed-month data on every click, today | 100% — every one of the (up to 61) requests re-fetches the whole range, every click, since there is no narrowing at all | **derived from code** — `range.start` is always the dataset's full start (`live-prices-button.tsx:49`, `:114`), and `no-store` means nothing downstream can short-circuit it either (`route.ts:141`) |
| Requests Yahoo needs, as a function of *date-range width* | **1 per symbol, regardless of range width** — narrower ≠ fewer | **derived from code** — `yahooFinance.chart(ticker, { interval: "1mo", period1: from, period2: to })` is one HTTP call whatever `from`/`to` are (`route.ts:172-176`). This is the single most important fact for what caching can and cannot buy — see §8. |
| Reference dataset size | "2,947 rows over five years" | **quoted** — `docs/yahoo-pricing-poc.md` §5, line 155 |
| Stored `PriceHistory` shape/size, 44 symbols × ~5 years | `monthlyCad: Record<symbol, Record<month, number>>` → ~44 × 60 ≈ 2,640 `"YYYY-MM": number` entries, each ~14-18 bytes serialized → **on the order of tens of KB** | **derived from the type** (`src/lib/price-history.ts:33-41`) applied to the reference dataset above. `storage.ts:264-273`'s own comment estimates "several hundred kilobytes" for the snapshot-vs-history rewrite cost — same order of magnitude, more conservative than this lower-bound derivation |

## 3. Answers to the twelve questions

**Q1 — where does the cache live?** Client-side first. See §1 for the full
argument; the deciding facts are `route.ts:141` (unconditional `no-store`) and
`docs/yahoo-pricing-poc.md` §1 (the retention cost of a shared server cache).

**Q2 — which module?** A new `src/lib/price-history-cache.ts`, not
`price-history.ts` (that module is valuation math — `valueYears`,
`valueOverTime` — a different concern) and not `live-prices.ts` (the wire
contract). `vitest.config.mts:6` documents the convention directly: "every
module under test is pure functions over plain objects — no DOM." The
narrowing, freshness, and merge functions below are all pure
(`stored, fetched → next`), so they belong beside `price-history.test.ts` and
`live-prices.test.ts` as their own testable module.
`live-prices-button.tsx` becomes the orchestrator that calls into it — it
already plays that role for `historyFromResponse` and `snapshotFromLivePrices`
(`live-prices-button.tsx:20,113,79`), so this is the existing pattern, not a
new one.

**Q3 — computing the narrowed `from`.** See §4 for the full pseudocode. In
short: for a symbol already in the stored history, the narrowed `from` is the
first day of the month *after* the latest month that is provably closed (see
Q4 for "provably"); for a symbol never seen, or one whose ticker changed
(Q5), or whose coverage window widened backward past what's stored (Q6), the
answer is "don't narrow — fetch the full requested range," which is always
safe because a full fetch can never be wrong, only less optimal.
The first-bar-after-range-open edge case
(`docs/yahoo-pricing-poc.md` §5.1, lines 198-201) does **not** need special
handling in the narrowing logic itself: `PriceHistory.unpriced` is a
**symbol-level** flag, not a per-month one (`route.ts:92-94`,
`price-history.ts:56`) — Yahoo simply omits a month it has no bar for, and
the stored `monthlyCad[symbol]` just doesn't have that key. Trying to
distinguish "genuinely never fetched" from "fetched, Yahoo had nothing for
this one month" from month-key absence alone is not reliable, so the
algorithm doesn't try: it only ever narrows *forward* from the latest
confirmed-closed month it does have, never tries to backfill a leading gap by
inference.

**Q4 — determining "current month."** This has to be split into two
unrelated things, and the plan's framing risks conflating them:

- **Bar-keying** (which `YYYY-MM` a specific Yahoo bar belongs to) is a
  server-side concern, solved by `market-month.ts`, and stays exactly as it
  is. The client never sees a raw bar timestamp — `PriceHistoryResponse`
  carries only the already-keyed `monthlyCad` map (`live-prices.ts:87-89`).
  There is nothing for the client-side cache to get wrong here because it
  never touches a timestamp.
- **Freshness gating** (is a stored month safe to skip re-fetching) is the
  actually-new client-side decision, and it does **not** need
  `market-month.ts`'s exchange-timezone logic. Use `fetchedAt`
  (`price-history.ts:35`) and compare its UTC calendar month against the
  month being checked:

  ```
  monthIsFinal(m, fetchedAtMonthUTC) = fetchedAtMonthUTC > m   // string compare, "YYYY-MM"
  ```

  This is provably safe regardless of the exchange: `market-month.ts`'s own
  comment (`market-month.ts:4-23`) bounds the worst-case exchange/UTC skew at
  "at most fourteen hours" (`market-month.ts:82-88`). A skew that small can
  never span a full UTC month (minimum 28 days), so `fetchedAtMonthUTC > m`
  strictly implies the exchange's own month `m` has also closed, in every
  timezone Yahoo could report. The check can only ever be **too
  conservative** near a boundary (one extra harmless refetch), never too
  permissive (never marks a still-open month final). No new timezone logic,
  no new dependency on `market-month.ts`'s formatter cache — the two
  concerns stay cleanly separated.

**Q5 — symbol set changes.** A new holding (never in `monthlyCad` or
`unpriced`) gets a full, unnarrowed fetch — same as today, just for one
symbol instead of the whole set. A ticker override is the sharper case: the
cache is keyed by Wealthsimple's `symbol` (`price-history.ts:37`), not by
Yahoo's `ticker`, and there is currently no override feature
(`docs/yahoo-pricing-poc.md` §6 item 1: "editable ticker... is the obvious
next piece" — not yet built). When it is, reusing a symbol's cached prices
after its ticker changes would silently price a *different instrument* under
the old symbol's name — worse than stale, actively wrong. The design must
therefore record which ticker each symbol's cached months were fetched
against (a small additive field — see §7) and treat any mismatch exactly like
"never seen": full refetch, old data for that symbol discarded rather than
reused.

**Q6 — coverage window widens (new, older CSV loaded).** `range.start` comes
from `dataset.dateRange`, itself `windowOf(source.activities)` merged across
loaded files (`src/lib/merge.ts:236,257,293`), so it can legitimately move
earlier. When a symbol's new `range.start` predates its earliest stored
month, the recommendation is: **fall back to a full, unnarrowed fetch for
that symbol only** (same treatment as "never seen"). This is deliberately the
simple answer over "fetch only the newly-opened segment and stitch two
ranges together" — the latter needs two upstream requests per affected
symbol instead of one, for an event that only happens when someone loads an
additional older export, which is rare. A full refetch is idempotent (the
previously-cached months come back unchanged, just re-verified) and cannot
be wrong, only slightly wasteful for a rare event.

**Q7 — merging fetched months into stored ones.** Full rules in §5.
Headline rule: fetched data always **overwrites** the same month key in
storage (never "first write wins") — this is what correctly handles a
current month advancing toward its close, and it's also the only honest
answer to Q9 (a legitimately revised close overwrites too, the same way).
Symbols not included in a narrowed fetch are **left untouched**, not wiped —
this is the single highest-risk implementation mistake (see §6, failure mode
#4): today's `historyFromResponse` (`price-history.ts:44-58`) replaces
`monthlyCad` wholesale from the response alone, and wiring a narrowed fetch
through that function unmodified would silently delete every un-refetched
symbol's history.

**Q8 — merging `unpriced`.** `unpriced` turns out to be lower-stakes than
it first appears: it feeds only the toast copy in
`live-prices-button.tsx:127-128` — `valueYears` and `valueOverTime` never
read it; they derive "missing this month" independently, from the absence of
a `monthlyCad[symbol][month]` key (`price-history.ts:130,253`). So getting
this wrong degrades a message, not a number. Still, precise rules: a symbol
leaves `unpriced` the moment any fetch returns usable months for it; a symbol
only *joins* `unpriced` when it was queried this round, came back a miss, and
still has zero `monthlyCad` entries after the merge (a miss for a symbol that
already has priced history keeps that history and is **not** marked
unpriced — it just didn't get fresher data this round). An unpriced symbol
is retried in **full** every time it's queried — never narrowed — since a
"no data" response carries no month-level information to narrow against; see
§5 rule 3.

**Q9 — can a closed month legitimately change?** Yes — corporate actions,
restatements, and ticker reuse after a delisting are all real, and the whole
design's premise ("last December's close is settled forever," quoted in
"Why this matters") is a simplification the design has to admit rather than
paper over. There is no algorithmic signal available to detect this — Yahoo
doesn't tell the caller "this close changed since you last asked." The
required escape hatch is a **manual, visible "refetch everything" action**
that bypasses narrowing entirely and does exactly what the route does today:
full range, every symbol, wholesale replace. It should be discoverable in
the UI (a secondary action near the main button), not hidden in devtools,
because the trigger for using it — "this number looks wrong" — comes from a
person looking at the page, not from any signal the app has.

**Q10 — cache version.** Yes, recommended: a `CACHE_VERSION` constant beside
`PriceHistory`, following the exact precedent `PARSER_VERSION` already sets
(`src/lib/wealthsimple.ts:58`, enforced at `src/lib/storage.ts:176`). Nothing
currently version-checks `PriceHistory` on load (`storage.ts:309-320` reads
it back with no validation at all), so a future bug in the narrowing/merge
logic — exactly the class of bug the maintenance notes warn about
("`src/lib/market-month.ts` exists because that already happened once") —
would have no remediation path short of asking every user to clear
IndexedDB. A version check on load (mismatch ⇒ treat as `stored = null`,
full refetch) is cheap insurance to add now, before it's needed.

**Q11 — smallest shippable version, and its measurable improvement.** See §7
(First slice) and §8 (Expected improvement) — the honest numbers are more
nuanced than "narrower range ⇒ fewer requests," because Yahoo's chart
endpoint is one request per symbol *regardless of range width* (§2). The
real win is request **elision** (skipping a symbol's request entirely), which
only fires when nothing has changed since the last check this calendar
month.

**Q12 — what tests, and where?** A new `src/lib/price-history-cache.test.ts`,
sibling to the new module, following `price-history.test.ts`'s existing
conventions (plain-object fixtures, `describe`/`it`, no mocking). Table of
what needs coverage is in §7 (First slice) and §9 (Deferred). Existing
`price-history.test.ts` needs no changes — `valueYears`/`valueOverTime`'s
consumed shape (`monthlyCad`, `unpriced`) is unchanged by this design; new
fields are additive and those functions don't read them.

## 4. The narrowing algorithm

Pseudocode, operating per symbol. `range` is `{start, end}` (`YYYY-MM-DD`,
`dataset.dateRange`). `stored` is the persisted `PriceHistory | null`, with
the two additive fields from §7 (`cacheVersion`, and a per-symbol
`ticker`/fetched-month record — call the combination `entryFor(symbol)`).

```
function narrowedRequest(stored, symbols, range, now):
  if stored == null or stored.cacheVersion != CACHE_VERSION:
    return { toFetch: symbols.map(s => ({...s, from: range.start})), sharedFrom: range.start }

  nowMonth = utcMonth(now)
  toFetch = []

  for (symbol, ticker) of symbols:
    entry = entryFor(stored, symbol)

    // Q5: never seen, or ticker changed since last fetch -> full range, no narrowing
    if entry == null or entry.ticker != ticker:
      toFetch.push({ symbol, ticker, from: range.start })
      continue

    // Q8: unpriced symbols are always retried in full, never narrowed
    if stored.unpriced.includes(symbol):
      toFetch.push({ symbol, ticker, from: range.start })
      continue

    // Q6: coverage window widened backward past what's stored -> full range
    storedMonths = Object.keys(stored.monthlyCad[symbol] ?? {})
    if storedMonths.length == 0 or range.start.slice(0,7) < min(storedMonths):
      toFetch.push({ symbol, ticker, from: range.start })
      continue

    // Q4: only months provably closed at fetch time count toward narrowing
    fetchedAtMonth = utcMonth(entry.fetchedAt)
    latestFinal = max(m for m in storedMonths if fetchedAtMonth > m)  // undefined if none

    if latestFinal == undefined:
      toFetch.push({ symbol, ticker, from: range.start })
      continue

    narrowedFrom = firstDayOfMonthAfter(latestFinal)

    if narrowedFrom > range.end:
      // everything closed is covered; only the current month might still be needed
      if fetchedAtMonth == nowMonth:
        continue  // elided entirely — nothing to fetch for this symbol this click
      toFetch.push({ symbol, ticker, from: firstDayOfMonth(nowMonth) })
      continue

    toFetch.push({ symbol, ticker, from: narrowedFrom })

  if toFetch.length == 0:
    return { toFetch: [], sharedFrom: null }  // skip the POST entirely

  // The route takes one from/to for the whole batch (PriceHistoryRequest,
  // live-prices.ts:76-82) — per-symbol `from` in the wire format is deferred
  // (§9), so use the minimum needed across the batch. Fetching a little more
  // than a symbol strictly needs is harmless: the merge (§5) overwrites by
  // month key regardless of how wide the returned range was.
  sharedFrom = min(entry.from for entry in toFetch)
  return { toFetch: toFetch.map(e => ({symbol: e.symbol, ticker: e.ticker})), sharedFrom }
```

The route's `to` is left as `range.end`, unnarrowed — narrowing only ever
needs to push `from` forward.

## 5. The merge rules

Given `stored: PriceHistory | null` and `fetched: PriceHistoryResponse`
(the result of the narrowed request above, which may cover only a subset of
symbols and a narrower range than the full dataset):

1. **`monthlyCad`**: for every `series` in `fetched.series`, for every
   `(month, price)` in `series.monthlyCad`, set
   `result.monthlyCad[series.symbol][month] = price` — **overwrite**, never
   "keep if present." This is what correctly handles the current month
   advancing toward its close and (Q9) a legitimate upstream revision, and
   it means the merge needs no special case for "this month was already
   cached" — fresher data always wins by construction.
2. **Untouched symbols**: any symbol in `stored.monthlyCad` that was *not*
   included in `fetched.series` or `fetched.misses` this round (i.e. elided
   by narrowing) is copied into `result` byte-for-byte. This is rule #1 by
   priority because getting it wrong is the design's worst failure mode
   (§6, #4).
3. **Misses on a symbol with prior data**: if `fetched.misses` includes a
   symbol that already has entries in `stored.monthlyCad`, keep those
   entries untouched and do **not** add the symbol to `unpriced` — a failed
   current-month refresh doesn't invalidate previously-closed months.
4. **Misses on a symbol with no prior data**: add to `result.unpriced`, same
   as today's `historyFromResponse` (`price-history.ts:56`).
5. **A previously-unpriced symbol that now has data**: remove it from
   `result.unpriced`; its `monthlyCad` entries are written per rule 1.
6. **`fetchedAt` (per-symbol)**: every symbol actually included in
   `fetched.series` or `fetched.misses` gets its tracked `fetchedAt` advanced
   to `fetched.fetchedAt`. Untouched (elided) symbols keep their previous
   `fetchedAt` — this is why `fetchedAt` needs to move from a single
   top-level field to per-symbol (§7): a single shared `fetchedAt` would
   make an elided symbol look freshly-verified when it wasn't, corrupting
   the Q4 freshness gate on the *next* narrowing pass.
7. **`cacheVersion`**: copied through unchanged (or stamped fresh, on a
   cold/invalidated cache).

## 6. Failure modes, ranked

Ranked by how silent and how consequential a mistake in each rule would be —
per the maintenance notes, a silently wrong valuation is worse than the
ten-second wait this feature removes.

1. **[Silent, most severe] Re-deriving a month key client-side instead of
   copying the server's.** If any client-side code computes `YYYY-MM` from a
   raw date instead of using the keys `monthlyCad` already carries, this
   reproduces the exact bug `market-month.ts` exists to prevent — a bar
   filed under the wrong month, overwriting the real one, invisible until
   someone checks a specific year's figure. Mitigation: the design above
   never re-derives a key; it only ever reads keys the server already
   produced.
2. **[Silent] Getting month finality wrong (Q4).** `>=` instead of `>` in
   `monthIsFinal`, or comparing local time instead of UTC without accounting
   for the skew bound, could mark a still-partial month "closed" — that
   value then never refreshes, and a past year's unrealised-change is
   silently wrong forever. §4 works through why `fetchedAtMonth > m` (UTC,
   strict) is safe against this given the ≤14h skew bound; any
   implementation that weakens that inequality needs the same proof redone.
3. **[Silent] Reusing cached prices after a ticker override (Q5).** Without
   tracking which ticker a symbol's cache was fetched against, a ticker edit
   could serve one instrument's history labeled as another's — wrong, not
   just stale.
4. **[Silent, most likely to actually happen] Wiring the narrowed fetch
   through today's wholesale-replacing `historyFromResponse` instead of the
   merge in §5.** This is the easiest mistake to make during implementation,
   because it's the path of least resistance — the existing function already
   exists and does *something* plausible-looking. The result: every symbol
   not included in a narrowed fetch silently loses its entire price history,
   with no error, just a quiet reversion to book cost.
5. **[Fail-safe, not silent] An unpriced symbol never retried, or retried
   every time forever.** Annoying (permanently book-cost, or one wasted
   request per click) but not wrong — book-cost fallback is always visibly
   labeled (`live-prices-button.tsx:128`, `price-history.ts:255-256`).
6. **[Fail-safe] Over-conservative freshness gate near a month boundary.**
   Costs one extra harmless request occasionally; never produces a wrong
   number, by the proof in §4.
7. **[Fail-safe] Coverage-window widening (Q6) falling back to a full
   refetch.** Slower than the theoretical optimum for a rare event; correct.

## 7. First slice

The honest picture in §8 argues for staging this in two slices rather than
building the full narrowing-plus-merge machinery (§4/§5) up front.

**Slice 1 — an all-or-nothing skip gate. No merge logic at all.**

1. Add two additive fields to `PriceHistory`: `cacheVersion: number` and
   `requestedFrom: string` (the `from` actually sent for the fetch that
   produced this object). Neither changes what `valueYears`/`valueOverTime`
   read (`monthlyCad`, `unpriced`) — out of scope per the plan, respected.
   **Verify**: `pnpm typecheck` passes with the new optional fields; existing
   `price-history.test.ts` fixtures still construct valid `PriceHistory`
   values (they omit new fields or supply defaults).
2. Write `canSkipEntirely(stored, symbols, range, now): boolean` in the new
   `src/lib/price-history-cache.ts`: true only when `stored` exists, its
   `cacheVersion` matches, its tracked symbol+ticker set exactly matches the
   requested one, `stored.requestedFrom <= range.start`, and
   `utcMonth(stored.fetchedAt) == utcMonth(now)`.
   **Verify**: unit tests for every branch (cold cache, version mismatch,
   symbol added, symbol's ticker changed, coverage widened, same month,
   different month) in `price-history-cache.test.ts`.
3. Wire it into `live-prices-button.tsx`'s history fetch (`:112-116`): if
   `canSkipEntirely` is true, skip the `fetchPriceHistory` call and reuse
   `usePriceStore.getState().history` as-is; otherwise do exactly what the
   code does today (full range, wholesale replace via `historyFromResponse`)
   — **no other code path changes**.
   **Verify**: existing behavior is bit-for-bit identical whenever the gate
   is false, which is every scenario except the specific one it targets —
   this bounds the blast radius of the change to a single new "skip" branch.
4. Stamp `cacheVersion` and `requestedFrom` wherever `historyFromResponse` is
   called.
   **Verify**: a manual/scripted round trip (construct a `PriceHistoryResponse`,
   call `historyFromResponse`, check the new fields are populated) added to
   `price-history.test.ts` or the new file.

**Slice 2 — per-symbol narrowing and merge (§4, §5), once Slice 1 ships and
its skip rate is observed.** Adds the per-symbol `fetchedAt`/`ticker`
tracking (§5 rule 6), the `narrowedRequest` function, and `mergeHistory`.
This is where the harder correctness burden lives (§6, failure modes 1-4),
and it's deferred behind Slice 1 specifically so the highest-value, lowest-risk
piece (full elision on a same-month repeat visit) ships without first
building the part most likely to introduce a silent bug.

## 8. Expected improvement

The naive expectation — "a narrower date range means fewer upstream
requests" — is **false** for this API, and that's worth stating plainly
before the numbers: Yahoo's chart endpoint is one HTTP call per symbol
*regardless of the requested range's width* (`route.ts:172-176`, cited in
§2). Narrowing `from` shrinks the response payload and parse cost, not the
request count, unless it lets a symbol be skipped **entirely**.

Reference scenario: 44 holdings, at least one US-listed (so `needsFx =
true`) — the maintainer's own worked example, `docs/yahoo-pricing-poc.md` §6
item 2.

| Scenario | Before (today, always) | After — Slice 1 | After — Slice 2 |
|---|---|---|---|
| First fetch ever (cold cache) | 45 requests | 45 requests (gate false — nothing to skip) | 45 requests (nothing narrowable yet) |
| Repeat click, same UTC calendar month, nothing changed | 45 requests | **0 requests** (gate true) | **0 requests** |
| First click after the month rolls over | 45 requests | 45 requests (gate false — different month) | **45 requests, unchanged count** — every symbol still needs its new current month checked, and that's 1 request per symbol regardless of range (see above) — but each request's range narrows to ~1 month instead of the full multi-year span, cutting payload/parse cost substantially |
| A few new holdings added (say 2 of 44), same month otherwise | 45 requests | 45 requests (gate false — symbol set changed) | **~3 requests** (2 new symbols + FX, if newly needed) — the actual request-count win this design can deliver |

The unqualified "removes most of the load" framing in the plan's "Why this
matters" is accurate for the specific case that dominates real usage — a
person opening the app and clicking the button more than once in a sitting,
or across a few days within the same month, which Slice 1 alone reduces from
45 requests every time to 0 after the first. It is not accurate for "click
once a month" usage, where Slice 2's per-symbol narrowing still leaves the
request count unchanged and only the payload shrinks. Both are worth
stating in the doc since the deliverable asked for honest, not optimistic,
numbers.

## 9. Deferred

- **Slice 2** itself (per-symbol narrowing + merge) — deferred behind
  observing Slice 1's actual skip rate; see §7.
- **Per-symbol `from` in the wire format** (`PriceHistoryRequest` currently
  takes one shared `from`/`to` for the whole batch, `live-prices.ts:76-82`).
  The narrowing algorithm (§4) works around this with a shared minimum
  `from`; a route/request-shape change to send per-symbol ranges would only
  reduce payload further, no request-count benefit, so it's not worth the
  wire-format churn now.
- **Intra-month freshness TTL** (e.g. refetch the current month if the last
  check was >24h ago, to catch a large intra-month move sooner than the
  next calendar month). The month-keyed cache naturally offers month-level
  freshness; anything finer is a product decision, not a correctness one —
  flagged as an open question below.
- **Server-side cache** — deferred pending an explicit maintainer decision
  to accept the retention cost (§1), not assumed.
- **Corporate-action / restatement detection** (Q9) — no algorithmic answer
  exists; covered only by the manual "refetch everything" escape hatch.

## 10. Open questions for the maintainer

1. **Accept the privacy cost of a server-side cache, later, for the
   shared-deployment case?** Recommendation: not now — ship client-side
   first; revisit only if real cross-user symbol overlap on the Vercel
   deployment turns out to be worth the retention.
2. **Is month-level freshness for the current month acceptable, or is a
   shorter TTL wanted** (e.g. daily)? Recommendation: month-level — it
   matches the cache's own key granularity, and the current year's figures
   are already visibly marked provisional in the UI ("valued at the last
   day your files cover," `docs/yahoo-pricing-poc.md` §5).
3. **Should the "refetch everything" escape hatch (Q9) be a visible,
   permanent UI affordance, or a lower-visibility one?** Recommendation:
   visible but secondary — a small link near the main fetch button — since
   the trigger for using it is a person noticing a number looks wrong, which
   requires it to be discoverable without devtools.
4. **Start `CACHE_VERSION` at 1 now, even though the format isn't changing
   yet?** Recommendation: yes — cheap insurance, and `PARSER_VERSION`
   already demonstrates the value of having the lever in place before a bug
   makes it necessary.
