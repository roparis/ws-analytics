# Plan 006: Design a per-symbol ticker override (spike — investigate and specify, do not build the feature)

> **Executor instructions**: This is a **design spike**, not a build plan. Your
> deliverable is a written design document plus, optionally, a throwaway
> prototype on a scratch branch. Do **not** ship the feature. Follow the steps,
> answer every question in "Questions to answer", and write the document
> described in "Deliverable". If anything in "STOP conditions" occurs, stop and
> report.
>
> **Drift check (run first)**:
> `git diff --stat 8f123b3..HEAD -- src/lib/yahoo-ticker.ts src/lib/price-snapshot.ts src/lib/google-sheet.ts src/stores/prices.ts`
>
> **This is a spike, so drift is not a STOP condition here** — unlike in the
> build plans, where a stale excerpt means you are about to edit code you have
> not read. Nothing ships from this document, and your job is to describe the
> code *as it is now*. If an excerpt below disagrees with the live file, the
> live file wins: note the difference in your deliverable and carry on. Stop
> only if the disagreement invalidates the spike's premise, which is stated in
> the STOP conditions.

## Status

- **Priority**: P2
- **Effort**: M (spike: ~half a day of investigation and writing)
- **Risk**: LOW (nothing ships)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `d1d2640`, 2026-08-15
- **Reconciled at**: commit `8f123b3`, 2026-08-16 — `google-sheet.ts` and
  `yahoo-ticker.ts` are **unchanged**, so the spike's central finding stands
  exactly as written: the app writes an editable ticker column, tells the user
  to edit it, and never reads it back. `price-snapshot.ts` and `stores/prices.ts`
  have both changed (plans 009 and 012, and the live-pricing work), but only in
  ways that shift line numbers here — every excerpt below is re-verified. The
  drift check has been softened to suit a spike; see above.

## Why this matters

Wealthsimple's activity export gives a bare ticker symbol and **no exchange**.
Every ticker this app sends to a price source is therefore a guess. When the
guess is wrong, that holding is silently valued at book cost forever and the
user has no way to correct it.

The project's own proof-of-concept document already names this as the top
missing piece. `docs/yahoo-pricing-poc.md` §6 item 1:

> "**An editable ticker.** The sheet's best feature is that a wrong guess is a
> cell you can fix. Here a miss is a dead end. A per-symbol override, stored
> beside the snapshot, is the obvious next piece."

The asymmetry is sharper than that paragraph says, and this is the fact that
makes the spike worth doing. The Google Sheets export **writes an editable
ticker column and tells the user to edit it** — and the parser that reads the
sheet back **already knows that column's name and ignores it**. The app
instructs an edit and then throws it away.

## Current state

### The app asks the user to fix a ticker

Verified excerpt, `src/lib/google-sheet.ts:455-460` — text written into the
Holdings tab:

```ts
	sheet.push([
		text(
			"If one price is blank, fix that row's Google ticker. If every price is blank, set File ▸ Settings ▸ Locale to Canada.",
		),
	]);
```

The Holdings tab carries that column. Verified excerpt,
`src/lib/google-sheet.ts:283-292`:

```ts
const HOLDINGS_HEADERS = [
	"Account",
	"Account type",
	"Symbol",
	"Name",
	"Listing",
	"Google ticker",
	"Shares",
	...
```

### And then discards the edit

Verified excerpt, `src/lib/price-snapshot.ts` — the column is **declared**:

```ts
const COLUMNS = {
	symbol: "Symbol",
	ticker: "Google ticker",
	priceCad: "Price (CAD)",
	account: "Account",
} as const;
```

But `grep -n "COLUMNS\." src/lib/price-snapshot.ts` returns exactly three lines,
and `COLUMNS.ticker` is not among them:

```
76:		(line) => line.includes(COLUMNS.symbol) && line.includes(COLUMNS.priceCad),
94:		const symbol = (row[COLUMNS.symbol] ?? "").trim();
98:		const price = toNumber(row[COLUMNS.priceCad]);
```

Re-run that `grep` yourself rather than trusting the line numbers — they have
moved once already and the count is the part that matters.

`COLUMNS.ticker` and `COLUMNS.account` are declared and never read. The seam is
literally already named in the code.

### The Yahoo path has no override at all

Verified excerpt, `src/lib/yahoo-ticker.ts:59-73`:

```ts
export function tickersFor(
	positions: Pick<Position, "symbol" | "listing">[],
): { symbol: string; ticker: string }[] {
	const bySymbol = new Map<string, string>();

	for (const position of positions) {
		if (!position.symbol) continue;
		if (bySymbol.has(position.symbol)) continue;
		bySymbol.set(position.symbol, yahooTickerGuess(position));
	}

	return [...bySymbol]
		.map(([symbol, ticker]) => ({ symbol, ticker }))
		.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
```

`yahooTickerGuess` is called unconditionally. There is no parameter, no lookup,
no seam. Its doc comment states the design intent plainly:

> "This is a guess and stays a guess. A ticker Yahoo doesn't recognise comes
> back unpriced rather than wrong, and the holding falls through to book cost."

That is a good failure mode. The gap is that there is no way to *stop* guessing.

### The POC doc's own comparison table

`docs/yahoo-pricing-poc.md` §2 scores the two paths, and this is the only row
where Sheets wins:

| | Sheets | Yahoo |
|---|---|---|
| Fix a bad ticker | Edit the cell | **Not yet** |

### Where an override could live

Verified: the price store already persists two keys into one IndexedDB object
store. `src/lib/storage.ts:22-26`:

```ts
const PRICES = "prices";
const ORDER_KEY = "order";
const SNAPSHOT_KEY = "snapshot";
/** Shares the `prices` store with the snapshot — same lifetime, same wipe. */
const HISTORY_KEY = "history";
```

And `clearStorage` (`src/lib/storage.ts:302-315`) clears the whole `PRICES`
store, with this comment:

> "Prices describe the holdings in those files; keeping them after a 'clear
> data' would leave the app valuing a portfolio it no longer has."

An override stored under a third key in that same store inherits the correct
lifetime for free — including being wiped by "Clear data". That is a strong
argument for where it belongs, and the spike should confirm or refute it.

### One useful fact for the UI question

The quote route already captures the security's **name** from Yahoo. Check
`src/app/api/prices/route.ts` around the quote-mapping block. If the name is
available on the response, showing it beside an override is what makes a wrong
ticker *visible* — "you asked for BRK-B and got Berkshire Hathaway" versus "you
asked for BRK-B and got something else entirely". Verify whether that field
survives into `LivePriceResponse` and into the snapshot; if it does not, note
what it would take.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0 |
| Dev server | `pnpm dev` | serves on :3000 |
| Trace usage | `grep -rn "tickersFor\|yahooTickerGuess\|googleTickerGuess" src/` | lists every call site |

## Scope

**In scope**:
- `plans/006-ticker-override-design.md` (create — your deliverable)
- Read-only investigation across `src/lib/`, `src/stores/`, `src/components/`
- **Optionally** a throwaway prototype on a scratch branch, never merged, to
  test a specific uncertainty. If you prototype, say so in the document and
  discard the branch.

**Out of scope** (do NOT do these):
- Shipping the feature. No production code changes on the working branch.
- Modifying `src/lib/yahoo-ticker.ts`, `src/lib/price-snapshot.ts`,
  `src/lib/google-sheet.ts`, `src/stores/prices.ts`, `src/lib/storage.ts`, or
  any component.
- Changing the IndexedDB schema.
- Removing or deprecating the Google Sheets path. `docs/yahoo-pricing-poc.md` §2
  keeps it deliberately: "it needs no server, it survives Yahoo changing its
  mind, and its ticker column is editable when a guess is wrong." Any design
  that assumes Sheets goes away is out of bounds.
- Redesigning `yahooTickerGuess`'s heuristics. The guess is fine; the missing
  piece is the override.

## Questions to answer

The document must answer each of these explicitly. Where the answer is "it
depends", say what it depends on and give a recommendation.

**Storage and lifetime**

1. Where does the override map live — a third key in the `PRICES` object store,
   a field on `PriceSnapshot`, or somewhere else? Justify against the lifetime
   argument above.
2. What happens to overrides on "Clear data"? On loading a *new* activity CSV
   that no longer contains that symbol? On a `PARSER_VERSION` bump?
3. An override is user-entered state the app cannot validate. What stops a stale
   override — set before a real ticker change — from silently mis-pricing a
   holding for years? This is the sharpest risk in the whole feature; do not
   hand-wave it.

**The two price paths**

4. Should one override map serve both paths, or does each need its own? Google
   and Yahoo use different dialects for the same holding (`TSE:VFV` vs
   `VFV.TO`, `CTC.A` vs `CTC-A.TO`, `CURRENCY:BTCCAD` vs `BTC-CAD` — see
   `src/lib/yahoo-ticker.ts:1-23`). A single map cannot hold both. Recommend one
   of: two maps, one map keyed by `(symbol, dialect)`, or override only Yahoo.
5. Should `parsePriceCsv` start reading `COLUMNS.ticker` and adopt the user's
   edited cell as an override? This is the cheapest possible entry point — the
   column exists, the constant exists, the user is already told to edit it — but
   it only ever produces Google-dialect tickers. Reconcile with Q4.

**The seam**

6. What is the minimal signature change to `tickersFor`? Sketch it. Note every
   call site (`grep -rn "tickersFor" src/`) and whether any of them lacks access
   to the override map.
7. `valueYears` and `valueOverTime` in `src/lib/price-history.ts` re-derive
   positions per period. Do they touch ticker resolution, or is the override
   purely a fetch-time concern? Confirm by reading, not by assuming.

**The UI**

8. Where does a user edit an override? Candidates:
   `src/components/investment/holdings-table.tsx` (inline, next to the unpriced
   holding) or `src/components/investment/import-prices-dialog.tsx`. Which one,
   and why?
9. How does the user *know* an override is needed? Today an unpriced holding
   falls back to book cost and is named in a toast. Is that discoverable enough,
   or does the holdings table need a persistent affordance?
10. How does the user tell a *correct* override from a wrong one? Investigate
    whether the security name from Yahoo reaches the client (see "Current
    state") and whether showing it solves this.

**Scope control**

11. What is the smallest version worth shipping? Name explicitly what is in the
    first slice and what is deferred.
12. What tests would the real implementation need, and in which files? Note that
    `src/lib/yahoo-ticker.ts` already has `yahoo-ticker.test.ts` and
    `src/lib/price-snapshot.ts` has `price-snapshot.test.ts` — model against
    those.

## Steps

### Step 1: Trace the ticker path end to end

Read, in this order, and take notes:

- `src/lib/yahoo-ticker.ts` (whole file — it is short)
- `src/lib/positions.ts` — find `detectListing` and the `listing` field, which
  is what `yahooTickerGuess` switches on
- `src/lib/live-prices.ts` — how `tickersFor` output becomes a request
- `src/components/investment/live-prices-button.tsx` — the single call site
- `src/lib/price-snapshot.ts` — `parsePriceCsv` and the unused `COLUMNS.ticker`
- `src/lib/google-sheet.ts` — `googleTickerGuess` and the Holdings tab builder
- `src/stores/prices.ts` and `src/lib/storage.ts` — where a map could live

**Verify**: you can state, in one sentence each, how a symbol becomes a Yahoo
ticker and how it becomes a Google ticker.

### Step 2: Enumerate every call site

**Verify**: `grep -rn "tickersFor\|yahooTickerGuess\|googleTickerGuess" src/`
→ record the complete list in your document, each with one line on whether it
would need the override map.

### Step 3: Answer the questions

Work through "Questions to answer" in order. Where a question can be settled by
reading code, settle it by reading code and cite `file:line`. Where it is a
judgement call, state the options and recommend one.

### Step 4: Prototype only what you cannot answer by reading

If — and only if — a specific question resists investigation, build the smallest
possible throwaway on a scratch branch to answer it. Discard the branch. Record
what you learned and that you discarded it.

**Verify**: `git status --short` on the working branch shows only
`plans/006-ticker-override-design.md`.

### Step 5: Write the deliverable

See below.

## Deliverable

Create `plans/006-ticker-override-design.md` containing:

1. **Recommendation** — one paragraph. What to build, in what order.
2. **Answers** to all twelve questions, each citing `file:line` where the answer
   came from code.
3. **The seam** — the concrete signature change to `tickersFor`, plus every call
   site that must change, with paths.
4. **Data shape** — the exact TypeScript type of the override map and where it
   is persisted.
5. **Staleness strategy** — your answer to Q3, in its own section. This is the
   risk that makes or breaks the feature.
6. **First slice** — a numbered, ordered list of steps small enough that each
   could become a step in a build plan, with a verification for each.
7. **Deferred** — what is explicitly not in the first slice, and why.
8. **Open questions for the maintainer** — anything genuinely their call, with
   your recommendation attached. Keep this short; a spike that returns a
   question list rather than a recommendation has not done its job.

## Done criteria

- [ ] `plans/006-ticker-override-design.md` exists
- [ ] All twelve questions answered, each with a `file:line` citation or an
      explicit "this is a judgement call" plus a recommendation
- [ ] The document names a concrete first slice with ordered, verifiable steps
- [ ] `git status --short` shows **only** `plans/006-ticker-override-design.md`
      — no production code modified
- [ ] `pnpm typecheck` exits 0 and `pnpm test` exits 0 (unchanged from baseline)
- [ ] `plans/README.md` status row for 006 updated

## STOP conditions

Stop and report back (do not improvise) if:

- You conclude the feature needs a schema migration of the IndexedDB `PRICES`
  store. That is a bigger decision than this spike's remit.
- You conclude the override should replace rather than supplement
  `yahooTickerGuess`. The guess is deliberate and documented; removing it is a
  maintainer's call.
- Reading the code shows an override map cannot reach `tickersFor` without
  threading state through more than three files. Report the chain — that changes
  the effort estimate materially.
- You find that the Google Sheets ticker column is already read somewhere and
  this plan's premise is wrong. Report immediately with the `file:line`.
- You find yourself writing production code on the working branch.

## Maintenance notes

- **This spike exists because the cheap version and the right version differ.**
  Reading `COLUMNS.ticker` in `parsePriceCsv` is a two-line change that closes
  the Sheets round trip. Making the Yahoo path overridable is the larger and
  more valuable piece. The spike's job is to decide whether they are one feature
  or two.
- **The Sheets path is not going away.** Any recommendation that assumes it will
  should be rejected; `docs/yahoo-pricing-poc.md` §2 gives three independent
  reasons to keep it.
- **Q3 (staleness) is the one to review hardest.** Everything else is
  plumbing.
