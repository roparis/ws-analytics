# Plan 010: Stop discarding good price history on a partial failure

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 99fa8b4..HEAD -- src/app/api/prices/history/route.ts src/components/investment/live-prices-button.tsx src/lib/live-prices.ts`
> If any in-scope file changed since this plan was reconciled, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (the second fix increases upstream request volume — see Step 3)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d1d2640`, 2026-08-15
- **Reconciled at**: commit `99fa8b4`, 2026-08-16 — `plans/015` has since landed
  and rewrote `src/app/api/prices/history/route.ts` (+37/−42). **Step 2 is
  unaffected**: the FX block it targets survived verbatim and only moved down the
  file. **Step 3 is materially affected** and now carries a decision the original
  plan did not face — see "What 015 changed under this plan" below. Read that
  section before starting.

## Why this matters

Two independent defects make the year-by-year valuation worse than the data
supports.

**One transient failure throws away everything.** The history route issues one
upstream request per symbol — for a 44-holding portfolio that is 45 requests
taking about ten seconds. If the single auxiliary `USDCAD=X` lookup misses, the
route returns 502 and **discards every successfully-charted series**, including
for a portfolio that is 95% Canadian-listed and needed no conversion at all. The
sibling quote route handles the same condition gracefully, per-symbol. The two
routes disagree about partial-failure policy, and the expensive one has the
worse policy.

**Sold holdings are invisible to history.** The history request is built from
`report.open` — currently-held positions. Any holding fully exited before today
is therefore unpriceable in *every* past year and falls back to book cost for
the years it was actually held. For anyone who rebalances or trims, that
understates past portfolio value and total return by the whole unrealised gain
those holdings carried. `docs/yahoo-pricing-poc.md` §5 documents the
"unpriced holding held at book cost" fallback, but nowhere records *excluding
closed positions* as a decision — this looks like an oversight, not a choice.

## What 015 changed under this plan

`plans/015-route-input-validation` landed after this plan was written and
rewrote much of the history route. Three consequences, in order of how much they
matter:

**1. There is now a second, lower cap — and Step 3 breaks its justification.**

015 added `MAX_HISTORY_SYMBOLS = 60` (`src/lib/live-prices.ts:120`), separate
from `MAX_SYMBOLS = 100`, and the history route validates against it. Read its
docblock, because the reasoning is what matters here:

```ts
/**
 * The history route's own, lower ceiling.
 *
 * Unlike the quote route, history costs one upstream Yahoo request *per
 * symbol* plus one for FX — at `MAX_SYMBOLS` that's up to 101 upstream
 * requests for a single inbound one. `tickersFor` emits one entry per
 * distinct held symbol, and the worked example in
 * `docs/yahoo-pricing-poc.md` is a 44-holding portfolio, so 60 leaves real
 * portfolios untouched while roughly halving the worst-case amplification.
 */
export const MAX_HISTORY_SYMBOLS = 60;
```

The sizing argument — "60 leaves real portfolios untouched" — rests on
`tickersFor` emitting **one entry per distinct *held* symbol**. Step 3 of this
plan deliberately widens that set to every symbol **ever held**. For the 44-open
portfolio in the doc, a few years of rebalancing plausibly pushes the union past
60. So the cap that was chosen as non-binding may now bind, on exactly the
portfolios this fix is for.

**Resolution, decided rather than left open**: keep `MAX_HISTORY_SYMBOLS` at 60
and implement the deterministic drop policy Step 3 already requires. Do **not**
raise it — 015 lowered it on purpose, and this plan does not get to quietly undo
another plan's security decision to make its own step easier. The tension is
real and is recorded in Maintenance notes rather than resolved by fiat.

**2. `MAX_SYMBOLS` is the wrong constant for this route now.** Everywhere this
plan says `MAX_SYMBOLS` in connection with the *history* request — the Step 3
constraint, the STOP condition, the out-of-scope list — read
`MAX_HISTORY_SYMBOLS`. `MAX_SYMBOLS` still governs the quote route, which this
plan does not touch.

**3. Line numbers moved and one done criterion is now false.** The excerpts
below are re-verified against `99fa8b4`. The old done criterion asserting no
change to `src/lib/live-prices.ts` since `d1d2640` cannot hold — 015 changed that
file — and has been rebased to `99fa8b4`.

## Current state

### Defect 1 — the all-or-nothing FX guard

Verified excerpt, `src/app/api/prices/history/route.ts:76-90` (survived 015
unchanged; only its line numbers moved):

```ts
		// The FX series is only worth a request if something is actually quoted in
		// US dollars, and that isn't knowable until the charts come back.
		const needsFx = fetched.some(
			(one) => one.result.kind === "ok" && one.result.currency === "USD",
		);
		const usdCadByMonth = needsFx
			? await monthlyCloses(USD_CAD_TICKER, input.from, input.to)
			: null;

		if (needsFx && usdCadByMonth?.kind !== "ok") {
			return fail(
				"Yahoo returned no USD→CAD history, so US-listed holdings can't be valued in CAD.",
				502,
			);
		}
```

At the point of that `return fail(...)`, `fetched` already holds every
successfully-charted series. All of it is thrown away.

Note what the code **already does correctly** just below, which is the pattern to
extend — verified excerpt, `src/app/api/prices/history/route.ts:92-105`:

```ts
		for (const { entry, result } of fetched) {
			if (result.kind === "miss") {
				misses.push({ ...entry, reason: result.reason });
				continue;
			}

			if (result.currency !== "CAD" && result.currency !== "USD") {
				misses.push({
					...entry,
					reason: `${entry.ticker} is quoted in ${result.currency || "an unknown currency"}, which this route can't convert to CAD.`,
				});
				continue;
			}
```

A symbol quoted in an unconvertible currency is already handled as a **miss**,
not a fatal error. A USD symbol with no FX rate is exactly the same situation.

For contrast, the quote route does the same thing for the same case — verified
excerpt, `src/app/api/prices/route.ts:105-115`:

```ts
			const currency = String(quote.currency ?? "").toUpperCase();
			const rate = conversionTo(currency, usdCad);
			if (rate === null) {
				misses.push({
					...entry,
					reason: currency
						? `${entry.ticker} is quoted in ${currency}, which this route can't convert to CAD.`
						: `Yahoo didn't say what currency ${entry.ticker} is quoted in.`,
				});
				continue;
			}
```

### Defect 2 — history asked only about open positions

Verified excerpt, `src/components/investment/live-prices-button.tsx:73`:

```ts
	const symbols = tickersFor(report.open);
```

That same `symbols` array is reused for the history request — verified excerpt,
`src/components/investment/live-prices-button.tsx:111-116`:

```ts
		setPending("history");
		try {
			const history = historyFromResponse(
				await fetchPriceHistory(symbols, range.start, range.end),
			);
```

`report.open` is correct for the **quote** (you can only own what you hold now),
and wrong for the **history** (a year-end valuation needs whatever was held at
that year end).

### Why the wrong symbol set produces a wrong number

`valueYears` and `valueOverTime` in `src/lib/price-history.ts` re-walk the
activity history with `buildPositions(upTo)` for each period end, so a position
that was open at that past date reappears in the report. With no entry in
`monthlyCad`, it falls through to book cost.

### The client's handling of a failed history

Verified excerpt, `src/components/investment/live-prices-button.tsx:108-110`
and `:133-139`:

```ts
		// A failed history leaves the snapshot standing: the investment page is
		// already correct, and the analytics page falls back to book cost the way
		// it did before any of this existed.
```

```ts
		} catch (error) {
			toast.error(
				error instanceof Error
					? `Today's prices are in, but the history isn't: ${error.message}`
					: "Couldn't fetch the price history.",
			);
		}
```

So today a 502 becomes a toast and `setHistory` is never called — the analytics
page keeps whatever stale history it had, or none.

### Constraints you must respect

From `docs/yahoo-pricing-poc.md`, and from the code:

- **Concurrency stays at 4.** Verified excerpt,
  `src/app/api/prices/history/route.ts:29-32`:

  ```ts
	// Yahoo's chart endpoint takes one symbol per request, so a 40-holding
	// portfolio is 40 requests. The library's default concurrency of 4 is a
	// reasonable neighbour; raising it is how an unofficial API starts refusing.
  ```

  Do not raise it, and do not "compensate" for the extra symbols in Step 3 by
  raising it.
- **The history route's cap is `MAX_HISTORY_SYMBOLS = 60`**
  (`src/lib/live-prices.ts:120`), not `MAX_SYMBOLS = 100` (`:108`). Both are
  ceilings on what a public deployment can be asked to do on someone else's
  behalf, not batching optimisations, and the client guards against them before
  sending. This plan may not change either value.
- **An unknown ticker is a miss, not a zero.** Never substitute 0 for an
  unpriceable holding.

### Repo conventions

- **Tabs** for indentation; Biome auto-sorts imports.
- Comments are prose explaining *why*.
- Tests colocated as `src/lib/*.test.ts`, no mocks anywhere in the suite.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, your measured baseline |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings) |
| Build | `pnpm build` | exit 0 |
| Exercise the route | see `docs/yahoo-pricing-poc.md` §7 for a working `curl` | JSON response |

## Scope

**In scope**:
- `src/app/api/prices/history/route.ts`
- `src/components/investment/live-prices-button.tsx`
- `src/lib/positions.ts` — **read only**, to determine the right replacement for
  `report.open`. Do not modify it.

**Out of scope** (do NOT touch):
- `queue: { concurrency: 4 }` in `src/app/api/prices/history/route.ts:32`.
- `MAX_SYMBOLS` (`src/lib/live-prices.ts:108`) **and `MAX_HISTORY_SYMBOLS`
  (`:120`)**. Neither value may be changed by this plan; see "What 015 changed
  under this plan".
- `src/app/api/prices/route.ts` — the quote route already behaves correctly here
  and its symbol set (`report.open`) is right.
- Caching the history route. Real, known, and already covered by
  `plans/007-history-caching-spike.md`.
- Rate limiting, origin checks, or error-message hardening — `plans/015` owned
  those and **has landed**. The origin check, the fixed error vocabulary, and the
  extracted `readRequestSymbols` validator are all its work. Leave them alone.
- `src/lib/price-history.ts` — the valuation logic is correct; it is being fed
  the wrong symbol list.

## Git workflow

- Branch: `advisor/010-price-history-partial-failure`
- Two commits, one per defect. Messages in repo style (imperative,
  sentence-case, no conventional-commit prefix):
  - `Keep the charts that worked when the exchange rate doesn't`
  - `Price the years a holding was held, not just the ones it survived`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Record the baseline

Run `pnpm typecheck && pnpm test && pnpm check` and **write down the numbers you
actually observe** — the passing test count, the file count, and the warning
count. Do not take a count from this document: several plans have shipped since
it was written and the suite has grown. Your measured numbers are the baseline
every later step compares against.

**Verify**: all three exit 0. At the time of reconciliation this was
`Tests 293 passed (293)` across 17 files and 5 warnings, but treat that as
context, not as an assertion. Stop only if something **fails**.

### Step 2: Degrade the FX failure per-symbol instead of fatally

In `src/app/api/prices/history/route.ts`, delete the early `return fail(...)` at
`:86-90`.

Keep the `needsFx` computation and the conditional `monthlyCloses` call — they
are correct, and skipping the FX request when nothing is USD-quoted is
deliberate.

Then, in the loop that follows, when `result.currency === "USD"` and
`usdCadByMonth` is not `ok`, push the entry into `misses` with a clear reason
and `continue`, exactly as the unconvertible-currency branch at `:98-104` already
does. CAD-quoted series must be unaffected and must still be returned.

Note that the per-month `rate` lookup at `:113-120` already handles a *missing
month* by skipping it, and the `Object.keys(monthlyCad).length === 0` guard at
`:122-128` already turns a fully-unconvertible symbol into a miss. Your new
branch is the "FX series entirely absent" case that those two do not cover
cleanly.

Add a comment explaining the policy, in the house voice — something to the
effect that one auxiliary ticker failing should not discard forty successful
chart requests, and that a symbol which cannot be converted is a miss here for
the same reason it is a miss two branches up.

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `grep -n "Yahoo returned no USD→CAD history" src/app/api/prices/history/route.ts`
→ no matches.

**Verify**: `pnpm build` → exit 0.

### Step 3: Ask for history on every symbol ever held

In `src/components/investment/live-prices-button.tsx`, keep
`tickersFor(report.open)` for the **quote** request, and build a separate,
wider list for the **history** request.

First, read `src/lib/positions.ts` to determine the right source. The report
exposes several collections; you need "every symbol that was ever held",
which includes closed positions. Candidates to evaluate: `report.positions`,
`report.bySymbol`, and `report.closed` if present. **Pick the one that
genuinely covers closed positions and say in your report which you chose and
why.** `tickersFor` takes `Pick<Position, "symbol" | "listing">[]` and already
de-duplicates by symbol (`src/lib/yahoo-ticker.ts:59-73`), so passing a superset
is safe.

Two constraints on the wider list:

1. **It must stay within `MAX_HISTORY_SYMBOLS` (60).** This is the constraint
   the reconciliation note at the top is about: 60 was sized against *open*
   holdings, and you are widening the set, so unlike when this plan was written
   the cap can genuinely bind. **Do not raise it.**

   Implement a deterministic, reported truncation:

   - Keep every **open** position first. The market-value tile depends on them,
     and a portfolio with more than 60 open positions is already over the cap
     for reasons this plan did not create.
   - Fill the remaining budget with **closed** positions, most recently closed
     first. This is a real trade-off and you should understand it rather than
     just implement it: the dropped holdings are the oldest, which are exactly
     the ones the earliest years need. It is chosen because a recently-closed
     holding was held for more of the window the analytics page actually shows,
     so it prices more year-ends per slot. If you find a clearly better ordering
     while implementing, say so in your report — do not silently substitute one.
   - **Never silently truncate.** Name the dropped symbols in the existing
     toast, in the same voice as the current `unpriced` message.

2. **It costs upstream requests.** One more symbol is one more chart request at
   concurrency 4, plus one for FX. State the new worst case in your report and
   confirm it is bounded by `MAX_HISTORY_SYMBOLS + 1 = 61`.

Update the toast description so a user can tell that closed holdings were
included — the existing success toast already reports year coverage and unpriced
symbols, so extend it rather than adding a second toast.

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `grep -n "tickersFor" src/components/investment/live-prices-button.tsx`
→ two distinct call sites, or one call plus one derived list. The quote path must
still use `report.open`.

### Step 4: Full verification

**Verify**: `pnpm typecheck && pnpm test && pnpm check && pnpm build` → exit 0.

**Verify**: `pnpm check` prints exactly 5 warnings, all in
`src/lib/google-sheet.ts`.

**Verify**: `git status --short` lists only the two in-scope files.

## Test plan

Neither in-scope file is reachable by the current suite: `vitest.config.mts`
includes only `src/**/*.test.ts`, and these are a route handler and a `.tsx`
component. **Adding jsdom or an HTTP test harness is out of scope** — the
node-only environment is a deliberate documented choice, and `plans/015` is the
plan that opens a testable seam for route validation by extracting it into
`src/lib/`.

So verification here is structural, which is why the done criteria are written
for `grep` and `build`.

Manual verification, if the operator can run the app — report the outcome, do
not treat it as a gate:

1. `pnpm dev`, load an export that contains at least one fully-exited holding
   and at least one US-listed holding.
2. Click **Fetch live prices**. Confirm the analytics page's "Value at year end"
   for a year in which the exited holding was held is now priced rather than
   carried at book cost.
3. Confirm the year-coverage toast still appears and names any genuinely
   unpriceable symbols.

Simulating the FX failure from Step 2 requires making `USDCAD=X` fail, which
needs either network interference or a temporary local edit. If you make a
temporary edit to test it, **revert it before committing** and confirm with
`git diff`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; every test in your Step 1 baseline still passes
- [ ] `pnpm check` exits 0 with exactly 5 warnings, all in
      `src/lib/google-sheet.ts`
- [ ] `pnpm build` exits 0
- [ ] `grep -n "Yahoo returned no USD→CAD history" src/app/api/prices/history/route.ts`
      returns no matches
- [ ] `grep -n "concurrency" src/app/api/prices/history/route.ts` still shows `4`
- [ ] `git diff --stat 99fa8b4..HEAD -- src/lib/live-prices.ts src/lib/price-history.ts src/app/api/prices/route.ts`
      shows **no changes**
- [ ] `git status --short` lists only `src/app/api/prices/history/route.ts` and
      `src/components/investment/live-prices-button.tsx`
- [ ] `plans/README.md` status row for 010 updated

## STOP conditions

Stop and report back (do not improvise) if:

- You cannot find a collection on `PositionsReport` that covers closed
  positions. Report what the report actually exposes rather than inventing a
  derivation, and do **not** modify `src/lib/positions.ts` to add one.
- The widened symbol list exceeds `MAX_HISTORY_SYMBOLS` for the operator's own
  export by a **large** margin — say, more than about 90 symbols ever held
  against 60 open. Dropping a handful of the oldest closed positions is the
  designed behaviour and is not a STOP; discarding a third of the portfolio's
  history is a different change and needs a decision. Report the two counts.
- You conclude the fix requires raising the upstream concurrency. It does not,
  and raising it is explicitly forbidden.
- Any test that passed in your Step 1 baseline fails.
- `pnpm build` fails.
- You find that closed positions were excluded from history **deliberately**,
  with a comment or doc line saying so. Report the citation — this plan's premise
  would be wrong.

## Maintenance notes

For whoever owns this next:

- **The policy this establishes**: on the history route, a symbol that cannot be
  valued is a **miss**, never a fatal error. Only a failure that makes the whole
  response meaningless should 502. Anyone adding a new failure mode should ask
  which of the two it is.
- **The two routes now agree** about partial failure. They did not before; if
  they diverge again, that is the smell to look for.
- **The unresolved tension, stated plainly**: `MAX_HISTORY_SYMBOLS = 60` was
  sized against *open* holdings, and this plan makes the history request ask
  about every symbol *ever* held. Those two facts pull against each other, and
  this plan resolves it by truncating rather than by raising the cap — the
  conservative choice, because the cap exists to bound what a public deployment
  does to an unofficial upstream API. If real portfolios turn out to lose
  meaningful history to that truncation, the right fix is **not** simply to raise
  60: it is to make the history route cheap enough to afford more symbols, which
  is caching, which is `plans/007`. Whoever revisits this should treat a binding
  cap as evidence for doing 007, not as a reason to relax 015.
- **Step 3 makes every history fetch more expensive** — proportional to how much
  the portfolio has traded over its lifetime. That interacts directly with
  `plans/007-history-caching-spike.md`: caching becomes more valuable after this
  lands, not less, and the spike's baseline measurement should be retaken
  afterwards. Note that 007 has since been run, and found that `yahooFinance.chart()`
  is one HTTP call per symbol **regardless of range width** — so narrowing the
  requested range shrinks payloads, not request counts. The saving that matters
  after this plan is skipping symbols already cached, not asking for less.
- **What a reviewer should scrutinise**: that CAD-only portfolios are completely
  unaffected by Step 2; that the quote path still uses `report.open`; that the
  `MAX_HISTORY_SYMBOLS` overflow behaviour is deterministic and reported rather
  than silent; that neither cap constant was edited; and that concurrency is
  untouched.
