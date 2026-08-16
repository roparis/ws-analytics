# Plan 007: Design caching for the price-history route (spike — investigate and specify, do not build the feature)

> **Executor instructions**: This is a **design spike**, not a build plan. Your
> deliverable is a written design document plus, optionally, a throwaway
> prototype on a scratch branch. Do **not** ship the feature. Follow the steps,
> answer every question in "Questions to answer", and write the document
> described in "Deliverable". If anything in "STOP conditions" occurs, stop and
> report.
>
> **Drift check (run first)**:
> `git diff --stat d1d2640..HEAD -- src/app/api/prices/history/route.ts src/lib/price-history.ts src/stores/prices.ts src/lib/storage.ts`
> If any file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (spike: ~half a day of investigation and writing)
- **Risk**: LOW (nothing ships)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

Opening the analytics page and fetching prices costs roughly ten seconds of
waiting, every single time, for data that mostly cannot change. Yahoo's chart
endpoint takes one symbol per request, so a 44-holding portfolio is 45 requests
run four at a time — and last December's monthly close was settled the moment
December ended.

`docs/yahoo-pricing-poc.md` §6 item 6 states it exactly:

> "**Caching.** Every click is a fresh call. Quotes go stale in minutes, but a
> closed month never changes — last December's close is settled forever. The
> history route is the one that should be cached, and isn't."

This is the cheapest large win available in the project. It also removes most of
the load behind the open-proxy concern in §6 item 2 — reducing the number of
upstream requests is a better answer than policing them.

The spike exists because the *where* is a real decision with privacy
consequences, not an implementation detail. See Q1.

## Current state

> **Since this plan was written** (`d1d2640`), two changes landed that it must be
> read against. Line numbers in the excerpts below have shifted; the quoted
> content is all still present and was re-verified on `main` at `0d09156`.
>
> 1. **Plan 015 capped this route** (PR #20). `MAX_HISTORY_SYMBOLS = 60` now
>    applies to the history route only, so the worst case is **61** upstream
>    requests per inbound request, not 101. Use 61 in any before/after
>    arithmetic. `MAX_SYMBOLS` is still 100 for the quote route.
> 2. **Plan 004 changed `src/lib/storage.ts`** (PR #18), adding `updateSources`.
>    It does not touch the price-history keys, but it moved the line numbers.
>
> Neither changes this spike's premise: the route still sets
> `cache-control: no-store` unconditionally, and nothing narrows the requested
> range using what is already stored.


### The route explicitly refuses to cache

Verified excerpt, `src/app/api/prices/history/route.ts:121-124`:

```ts
		return Response.json(body, { headers: { "cache-control": "no-store" } });
```

`no-store` is set unconditionally, on every response.

### The cost, in the maintainer's own numbers

`docs/yahoo-pricing-poc.md` §6 item 2:

> "the history route is the expensive one, since Yahoo's chart endpoint takes a
> single symbol per request. A 44-holding portfolio is 45 requests, which the
> client queue runs four at a time in about ten seconds."

And the concurrency limit is deliberate. Verified excerpt,
`src/app/api/prices/history/route.ts:25-32`:

```ts
const yahooFinance = new YahooFinance({
	suppressNotices: ["yahooSurvey"],
	validation: { logErrors: false },
	// Yahoo's chart endpoint takes one symbol per request, so a 40-holding
	// portfolio is 40 requests. The library's default concurrency of 4 is a
	// reasonable neighbour; raising it is how an unofficial API starts refusing.
	queue: { concurrency: 4 },
});
```

**Raising concurrency is not the fix and is out of scope.** The comment explains
why, and the spike must respect it.

### The history is already persisted client-side

Verified excerpt, `src/lib/price-history.ts:33-41` — the stored shape:

```ts
export interface PriceHistory {
	/** ISO instant the history was fetched. */
	fetchedAt: string;
	source: "yahoo";
	/** Symbol -> (`YYYY-MM` -> that month's close, per share, in CAD). */
	monthlyCad: Record<string, Record<string, number>>;
	/** Symbols asked for that Yahoo had no usable history for. */
	unpriced: string[];
}
```

That shape is **already keyed by symbol and month** — which is exactly the cache
key a month-level cache needs. This is the single most important fact for the
spike.

Verified excerpt, `src/lib/storage.ts:264-273`:

```ts
/**
 * The stored monthly price history, or null if none has been fetched.
 *
 * Kept beside the snapshot rather than inside it: a snapshot is replaced every
 * time someone refreshes a quote, while the history behind it barely moves —
 * last year's December close is settled. Rewriting several hundred kilobytes of
 * closes on every quote refresh would be pure waste.
 */
export async function loadPriceHistory(): Promise<PriceHistory | null> {
```

The comment already contains the caching argument. The persistence exists; what
is missing is *using* it to narrow the next request.

### The client throws the stored history away on every fetch

Verified excerpt, `src/components/investment/live-prices-button.tsx` — the
history fetch:

```ts
			const history = historyFromResponse(
				await fetchPriceHistory(symbols, range.start, range.end),
			);
			setHistory(history);
```

`range.start` is always the full coverage start. Nothing consults the stored
history to ask for less, and `setHistory` replaces wholesale rather than merging.

### The edge case that will bite any narrowing

`docs/yahoo-pricing-poc.md` §5.1 — read this before designing anything:

> "Yahoo's first monthly bar starts *after* the requested range opens, so the
> earliest month of any history has no close and that month falls back to book
> cost."

So a narrowed `from` does not simply return "the months you asked for". Any
design that shifts `from` forward must account for the first-bar behaviour or it
will quietly lose a month.

### The timezone trap, for context

`docs/yahoo-pricing-poc.md` §5 records a real bug that cost real time:

> "Yahoo stamps a monthly bar at **midnight on the first, in the exchange's own
> timezone**... `USDCAD=X` trades on `Europe/London`, so during British Summer
> Time its bars arrive as `2022-09-30T23:00:00Z` — October, an hour before UTC
> agrees."

`src/lib/market-month.ts` solves this. Any cache keyed on month must key on the
month `market-month.ts` reports, never on one derived from `toISOString()`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0 |
| Dev server | `pnpm dev` | serves on :3000 |
| Exercise the route | see `docs/yahoo-pricing-poc.md` §7 for a working `curl` invocation | JSON response |

## Scope

**In scope**:
- `plans/007-history-caching-design.md` (create — your deliverable)
- Read-only investigation across `src/app/api/`, `src/lib/`, `src/stores/`,
  `src/components/investment/`
- **Optionally** a throwaway prototype on a scratch branch, never merged.

**Out of scope** (do NOT do these):
- Shipping the feature. No production code changes on the working branch.
- Raising `queue: { concurrency: 4 }`. The comment at
  `src/app/api/prices/history/route.ts:28-31` explains why, and it is right.
- Caching the **quote** route (`src/app/api/prices/route.ts`). Quotes go stale in
  minutes; the POC doc singles out history as the one worth caching. If you
  believe quotes deserve a short TTL, note it as a separate idea and move on.
- Rate limiting, auth, or origin checks. Related, separately tracked, not this.
- Any change to `PriceHistory`'s meaning as consumed by
  `valueYears` / `valueOverTime`.
- Introducing a server-side database, Redis, or any new infrastructure
  dependency. If your design needs one, that is a STOP condition — this is a
  local-first app whose deployment story is an open question.

## Questions to answer

The document must answer each of these explicitly.

**Where the cache lives — the decision that matters most**

1. Client-side (narrow the request using the already-persisted `PriceHistory`)
   or server-side (cache in the route), or both? Weigh:
   - Client-side is nearly free, needs no infrastructure, and works for the
     self-hosted single user — but does nothing for a shared deployment.
   - Server-side helps every user of a deployment — but a shared server
     retaining which symbols were looked up is precisely the privacy question
     `docs/yahoo-pricing-poc.md` §1 leaves open ("whoever runs the deployment can
     see which symbols were looked up").
   - **The hosting decision is resolved in practice**: this app has been
     serving production at `https://ws-analytics.vercel.app` since 2026-08-11
     (12 production deployments). An earlier revision of this plan called it
     unresolved and told you to prefer client-side on that basis. That reason is
     gone. Client-side may still win on privacy grounds — a shared server-side
     cache means the deployment retains which symbols were looked up, which
     `docs/yahoo-pricing-poc.md` §1 names as the cost of the server path — but
     argue it from privacy and effort, not from "hosting is undecided".

   State a recommendation with an order (e.g. "client-side first, server-side
   only if hosting is decided").

2. If client-side: does the narrowing live in
   `src/components/investment/live-prices-button.tsx`, in
   `src/lib/live-prices.ts`, or in a new module? Which keeps
   `src/lib/` pure-functions-over-plain-objects, as `vitest.config.mts:6`
   documents the convention?

**Correctness of a narrowed request**

3. Given a stored `PriceHistory`, how do you compute the narrowed `from`? Be
   precise about the first-bar behaviour quoted above.
4. **The current month must never be served from cache** — it is still moving.
   How is "current month" determined, given the `market-month.ts` timezone trap?
5. What happens when the symbol set changes between fetches — a new holding
   bought, or an override changing a ticker? A per-symbol cache must not serve a
   narrowed range for a symbol it has never seen.
6. What happens when the *coverage window* changes because a new activity CSV
   was loaded, extending `range.start` earlier than anything cached?
7. `setHistory` currently replaces wholesale. A narrowed fetch requires
   **merging** new months into stored ones. Where does that merge belong, and
   what are its rules when stored and fetched disagree about the same month?
8. How does `unpriced` merge? A symbol Yahoo could not chart last time might
   chart today, and vice versa. Getting this wrong makes a holding permanently
   unpriced or permanently retried.

**Invalidation and staleness**

9. Is there any case where a *closed* month's close legitimately changes?
   Consider corporate actions, restatements, and ticker changes. If yes, what is
   the escape hatch — and is a "refetch everything" affordance needed?
10. Should the cache have a version, so a bug in the month-keying logic can be
    invalidated wholesale on upgrade? Note `PARSER_VERSION` in
    `src/lib/wealthsimple.ts` as the existing precedent for this pattern.

**Scope and verification**

11. What is the smallest version worth shipping, and what does it measurably
    improve? Give the expected before/after in requests, not just in seconds.
12. What tests would the real implementation need, and where? `src/lib/` modules
    have sibling `*.test.ts` files — `price-history.test.ts` already exists.
    Which of the merge/narrowing rules above are pure functions that could be
    tested there?

## Steps

### Step 1: Trace the history path end to end

Read, in this order:

- `src/components/investment/live-prices-button.tsx` — the only caller
- `src/lib/live-prices.ts` — `fetchPriceHistory` and the request/response types
- `src/app/api/prices/history/route.ts` (whole file, 256 lines)
- `src/lib/price-history.ts` — `historyFromResponse`, `valueYears`,
  `valueOverTime`
- `src/lib/market-month.ts` — the month-keying helper (read this carefully)
- `src/stores/prices.ts` and `src/lib/storage.ts` — persistence

**Verify**: you can state in one sentence how a month's close travels from Yahoo
to a cell on the analytics page.

### Step 2: Establish the baseline — analytically if you cannot measure it

You most likely have **no browser and no real Wealthsimple export**, so a live
measurement may be out of reach. That is expected. Do not invent numbers, and do
not skip the step — derive what you can from the code and say which is which.

**Derivable from the code, and required:**

- Upstream requests per inbound request, as a function of distinct held symbols.
  Read the fan-out in `src/app/api/prices/history/route.ts` and the FX condition.
  State the formula and the worst case at `MAX_HISTORY_SYMBOLS`.
- How many of those requests are for **closed** months — the ones a cache would
  never need to repeat — versus the current month, for a representative export
  length. This is the number that decides whether caching is worth building.
- The shape and approximate size of a stored `PriceHistory`, from its type and
  the month/symbol counts it would hold.

**Already measured, and quotable**: `docs/yahoo-pricing-poc.md` §6 item 2 records
"a 44-holding portfolio is 45 requests, which the client queue runs four at a
time in about ten seconds." Cite it as the maintainer's own figure rather than
re-deriving a wall-clock estimate.

**If you can run the app** — you would need to generate a synthetic CSV, and
plan 018 describes how — take the live numbers and mark them as measured.

**Verify**: your document states, for every number, whether it was *measured*,
*derived from code*, or *quoted from the POC doc*. A baseline whose provenance is
unclear is worse than none, because the design decision rests on it.

### Step 3: Answer the questions

Work through them in order. Settle by reading code where possible, citing
`file:line`. Where a question is a judgement call, state the options and
recommend one.

Pay disproportionate attention to Q3, Q4, and Q7 — the narrowing arithmetic, the
current-month exclusion, and the merge. Those are where a caching bug produces
silently wrong historical valuations, which is worse than the ten-second wait
this feature exists to remove.

### Step 4: Prototype only what you cannot answer by reading

If a specific question resists investigation, build the smallest throwaway on a
scratch branch. Discard it. Record what you learned.

**Verify**: `git status --short` on the working branch shows only
`plans/007-history-caching-design.md`.

### Step 5: Write the deliverable

See below.

## Deliverable

Create `plans/007-history-caching-design.md` containing:

1. **Recommendation** — one paragraph. Client or server, and why, in this app's
   actual deployment situation.
2. **Measured baseline** — the numbers from Step 2.
3. **Answers** to all twelve questions, each citing `file:line` where the answer
   came from code.
4. **The narrowing algorithm** — precise pseudocode for computing the narrowed
   `from` from a stored `PriceHistory`, handling the first-bar edge and the
   current month.
5. **The merge rules** — precise rules for merging fetched months into stored
   ones, including `unpriced`.
6. **Failure modes** — what goes wrong if each rule is implemented incorrectly,
   and which of them produce *silently wrong numbers* rather than visible
   errors. Rank them.
7. **First slice** — a numbered, ordered list of steps small enough to become a
   build plan, each with a verification.
8. **Expected improvement** — before/after in upstream requests for a
   representative portfolio.
9. **Deferred** — explicitly out of the first slice, and why.
10. **Open questions for the maintainer** — short, each with your recommendation
    attached.

## Done criteria

- [ ] `plans/007-history-caching-design.md` exists
- [ ] All twelve questions answered, each with a `file:line` citation or an
      explicit judgement-call recommendation
- [ ] The Step 2 baseline is present, and every number is labelled with its
      provenance (measured / derived / quoted)
- [ ] The narrowing algorithm and merge rules are written precisely enough to
      implement without further design work
- [ ] `git status --short` shows **only** `plans/007-history-caching-design.md`
      — no production code modified
- [ ] `pnpm typecheck` exits 0 and `pnpm test` exits 0 (unchanged from baseline)
- [ ] `plans/README.md` status row for 007 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Your design requires new infrastructure (Redis, a database, an external cache
  service). This app has no backend beyond two route handlers and its hosting
  story is undecided.
- Your design requires raising the upstream concurrency limit.
- You conclude the cache must be server-side to be worth doing at all. That
  collides with the unresolved hosting decision and is the maintainer's call —
  report the reasoning rather than assuming it.
- You find that narrowing the range changes what Yahoo returns for months
  already held, in a way that makes the merge unsafe. That is a material finding
  and may kill the client-side approach.
- You cannot produce even the *derived* half of the Step 2 baseline. A live
  measurement being unavailable is expected and is not a STOP; being unable to
  reason about the fan-out from the code is, because the design rests on it.
- You find yourself writing production code on the working branch.

## Maintenance notes

- **The privacy angle is why this is a spike and not a build plan.** A
  server-side cache on a shared deployment retains which symbols were looked up,
  and `docs/yahoo-pricing-poc.md` §1 flags exactly that as the cost of the
  server-side pricing path. The client-side design has no such cost, which is a
  strong reason to prefer it first.
- **Silent wrongness is the real risk.** The failure this feature can introduce
  is not a crash — it is a past year valued against a month that was cached
  under the wrong key. `src/lib/market-month.ts` exists because that already
  happened once. Rank Q3/Q4/Q7 accordingly.
- **This plan was written expecting to reduce the pressure on the open-proxy
  item** in `docs/yahoo-pricing-poc.md` §6 item 2 by removing load rather than
  policing it. **The spike found that claim needs qualifying.** Yahoo's chart
  endpoint is one HTTP call per symbol *regardless of the requested range's
  width*, so narrowing the range shrinks payloads, not request counts — only
  skipping a symbol entirely removes a request. Caching therefore removes load
  for someone clicking more than once inside a month (45 requests → 0), and
  removes almost none for someone who clicks once a month. It is not a
  substitute for the bounds plan 015 added.
