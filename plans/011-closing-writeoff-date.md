# Plan 011: Date a pool's closing write-off to the event that closed it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat d1d2640..HEAD -- src/lib/positions.ts src/lib/analytics.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

When a holding is fully exited, any book cost still attached to it is written
off as a realised gain or loss. That write-off is dated to the pool's **last
trade** — which is correct when a *sale* closed the position, and wrong when a
share-removing corporate action closed it.

`buildPositions` explicitly handles the corporate-action case (it has a named
flag, `corporate-action-unpaired`), and in that path `lastTradeDate` can be
months or years earlier than the event that actually zeroed the shares. The
entire remaining book cost is then booked into the wrong tax year — and the
analytics page buckets realisations by exactly that date, so two years' "Earned"
and "Total return" figures move in opposite directions.

There is a worse degenerate case: if the pool never had a trade at all,
`lastTradeDate` is `null` and the event is emitted with `date: ""`. It is then
dropped from every year's row while still counting in the lifetime
`realizedPnl`, so the per-year rows silently stop reconciling with the total.

## Current state

### Where the write-off is dated

Verified excerpt, `src/lib/positions.ts:687-705`:

```ts
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
```

Note the comment's own assumption: *"this residual belongs to the sale that
closed the position"*. That is true for a sale and false for a corporate action.

### Why `lastTradeDate` is not always the closing event

Verified excerpt, `src/lib/positions.ts:620-626`:

```ts
			if (activity.activityType !== "Trade") continue;

			const quantity = activity.quantity ?? 0;
			pool.tradeCount += 1;
			pool.commission += activity.commission ?? 0;
			if (!pool.firstTradeDate) pool.firstTradeDate = activity.transactionDate;
			pool.lastTradeDate = activity.transactionDate;
```

`lastTradeDate` is assigned **only** inside the `activityType === "Trade"`
branch. Everything else `continue`s before reaching it.

And the corporate-action path that can zero a pool's shares returns earlier —
verified excerpt, `src/lib/positions.ts:610-617`:

```ts
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
```

### What consumes the date

Verified excerpt, `src/lib/positions.ts:288-297`:

```ts
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
```

Verified excerpt, `src/lib/analytics.ts:152-159` — realisations are bucketed into
a year by string-slicing that date:

```ts
	const realized = realizations
		.filter(
			(event) =>
				event.date.slice(0, 4) === year &&
				(accountType === ALL_ACCOUNT_TYPES ||
					event.accountType === accountType),
		)
		.reduce((total, event) => total + event.amount, 0);
```

`"".slice(0, 4)` is `""`, which matches no year — hence the silent drop.

### `lastTradeDate` must NOT be repurposed

This is the trap in this plan. `lastTradeDate` is a **public field on
`Position`** and carries its literal meaning elsewhere. Verified from
`grep -n "lastTradeDate" src/lib/positions.ts`:

```
99:	lastTradeDate: string | null;     ← Position (public)
161:	lastTradeDate: string | null;
275:	lastTradeDate: string | null;     ← Pool (private)
565:			lastTradeDate: null,
626:			pool.lastTradeDate = activity.transactionDate;
694:			realize(pool, pool.lastTradeDate ?? "", -pool.bookCost);
701:			realize(pool, pool.lastTradeDate ?? "", -pool.bookCost);
726:		lastTradeDate: pool.lastTradeDate,   ← copied onto the Position
740:				(b.lastTradeDate ?? "").localeCompare(a.lastTradeDate ?? "") ||
839:			position.lastTradeDate &&
840:			(!row.lastTradeDate || position.lastTradeDate > row.lastTradeDate)
842:			row.lastTradeDate = position.lastTradeDate;
```

Lines 740, 839-842 sort positions and build roll-ups from it. Widening it to
mean "last event of any kind" would silently change that ordering and those
roll-ups. **Add a separate private field on `Pool` instead.**

### The invariant that protects this change

Verified excerpt, `src/lib/positions.test.ts:622-626`:

```ts
		const logged = report.realizations.reduce(
			(total, event) => total + event.amount,
			0,
		);
		expect(logged).toBeCloseTo(report.totals.realizedPnl, 6);
```

Amounts do not change in this plan — only dates — so this must keep passing
untouched. It is your safety net.

### Repo conventions

- **Tabs** for indentation.
- Comments are prose explaining *why*; match the voice of the excerpts above.
- Tests colocated as `src/lib/*.test.ts`, no mocks anywhere in the suite. See
  `src/lib/positions.test.ts` for the fixture-factory style (`trade({...})`).
- Fixture numbers are small, round and invented — never plausible real data.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, 228 baseline + new |
| One file | `pnpm test positions` | all pass |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings) |

## Scope

**In scope**:
- `src/lib/positions.ts`
- `src/lib/positions.test.ts`

**Out of scope** (do NOT touch):
- The public `Position.lastTradeDate` field and every consumer of it
  (`positions.ts:99,726,740,839-842`). Its meaning is correct and load-bearing.
- `src/lib/analytics.ts`. Its year bucketing is right; it is being handed a bad
  date. Fixing the date at the source is the fix.
- The **amounts** realised. This plan changes only *when* a realisation is
  attributed, never *how much*.
- `SHARE_EPSILON` and the I4 zero-landing logic.
- The `corporate-action-unpaired` flag text and the decision not to scale basis
  with the delta — both deliberate and documented in the excerpt above.
- `analyzeRenames` and the paired-rename path (`positions.ts:596-605`), where
  book cost deliberately carries over and nothing is realised.

## Git workflow

- Branch: `advisor/011-closing-writeoff-date`
- Commit message in repo style (imperative, sentence-case, no
  conventional-commit prefix):
  `Book a closing write-off on the day the position actually closed`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Record the baseline

**Verify**: `pnpm typecheck && pnpm test && pnpm check` → exit 0, with
`Tests 228 passed (228)`. If the count differs, the tree has drifted — STOP.

### Step 2: Track the last event date of any kind

Add a new field to the **private** `Pool` interface (near
`src/lib/positions.ts:275`, alongside `lastTradeDate`):

```ts
	/**
	 * The last row of any kind this pool saw — trade, dividend or corporate
	 * action. `lastTradeDate` is deliberately narrower and stays that way: it is
	 * public on `Position` and drives the closed-position sort. This one exists
	 * because a pool can be closed by a share-count correction rather than a
	 * sale, and the residual write-off belongs to whatever actually closed it.
	 */
	lastEventDate: string | null;
```

Initialise it to `null` where the pool is constructed (`positions.ts:565`,
beside `lastTradeDate: null`).

Assign it on **every** row the walk visits, before any branch that `continue`s.
Find the top of the per-row loop in the pass-2 walk and set it there, so a
corporate action, a dividend and a trade all update it.

**Do not** add it to the public `Position` interface. Nothing outside the walk
needs it, and adding it widens the API for no consumer.

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `grep -n "lastEventDate" src/lib/positions.ts` → the interface
field, the initialiser, one assignment in the walk, and (after Step 3) two uses.

### Step 3: Date the write-off from the closing event

Change both `realize` calls at `src/lib/positions.ts:694` and `:701` to prefer
the new field:

```ts
			realize(pool, pool.lastEventDate ?? pool.lastTradeDate ?? "", -pool.bookCost);
```

Update the comment above line 692 — it currently asserts the residual "belongs
to the sale that closed the position", which is the assumption being corrected.
Say instead that it belongs to whatever row closed the position, which is
usually a sale and is sometimes a share-count correction.

**Verify**: `pnpm test positions` → the existing suite still passes, including
the realisation-sum invariant at `positions.test.ts:622`.

### Step 4: Never emit a realisation with an empty date

Even with Step 3, a pool with no rows at all would still fall through to `""`.
That case should be impossible — a pool exists because rows created it — but the
`?? ""` makes it silently representable, and a realisation with an empty date is
counted in `totals.realizedPnl` while being invisible in every year's row.

In `realize` (`src/lib/positions.ts:288`), guard against it: if `date` is empty,
do not push the event. Add a brief comment explaining that an undated
realisation would make the per-year rows stop reconciling with the lifetime
total, so it is better to have neither than to have one.

**Consider carefully and state your choice in your report**: dropping the event
while leaving `pool.realizedPnl` already decremented means the sum invariant at
`positions.test.ts:622` would break for that pool. If you find this is reachable,
STOP and report rather than choosing for yourself — the alternative (keep the
event, attribute it to `firstTradeDate`) has different tradeoffs and is the
maintainer's call.

**Verify**: `pnpm test` → exit 0, all 228 pre-existing tests pass.

### Step 5: Full verification

**Verify**: `pnpm typecheck && pnpm test && pnpm check` → exit 0.

**Verify**: `pnpm check` prints exactly 5 warnings, all in
`src/lib/google-sheet.ts`.

**Verify**: `git status --short` lists only the two in-scope files.

## Test plan

New tests in `src/lib/positions.test.ts`, modelled on the existing fixture
factories in that file:

| # | Case | Assert |
|---|---|---|
| 1 | Buy, then a later **sell** that closes the position | The closing realisation's `date` equals the sell's date. Characterization — must pass before *and* after. |
| 2 | Buy in year A, then an unpaired share-removing **corporate action** in year B that zeroes the shares | The closing realisation's `date` is in **year B**. Fails before the fix. |
| 3 | The same fixture, through `yearAccountStats` | The realised amount lands in year B's row, not year A's. |
| 4 | A pool that also received a **dividend** after its last trade, then closed by a corporate action | The date is the corporate action's, not the dividend's — proves the field tracks the closing event, not merely "any later row". |
| 5 | Existing invariant, re-asserted on the new fixtures | `Σ realizations.amount ≈ totals.realizedPnl`, and per-symbol sums ≈ `position.realizedPnl` (the pattern already at `positions.test.ts:622-632`) |

Case 2 is the flagship — **run it before applying Step 3 and confirm it fails.**
If it passes against the unfixed code, the fixture does not reproduce the bug and
the test is worthless; rework it until it goes red.

Keep every fixture amount small, round and obviously invented.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; all 228 pre-existing tests pass, plus at least 4 new
      cases
- [ ] `pnpm check` exits 0 with exactly 5 warnings, all in
      `src/lib/google-sheet.ts`
- [ ] `grep -n "lastEventDate" src/lib/positions.ts` shows the private field and
      its uses
- [ ] `grep -n "lastEventDate" src/lib/positions.ts | grep -c "export interface Position"`
      returns 0 — the field is **not** on the public `Position`
- [ ] `git diff d1d2640..HEAD -- src/lib/analytics.ts` shows **no changes**
- [ ] The existing realisation-sum assertions at `positions.test.ts:622-632` are
      unmodified
- [ ] `git status --short` lists only `src/lib/positions.ts` and
      `src/lib/positions.test.ts`
- [ ] `plans/README.md` status row for 011 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Case 2's test **passes** against the unfixed code. The fixture does not
  reproduce the bug; do not proceed on a test that could never have failed.
- Step 4's empty-date case turns out to be reachable in a way that breaks the
  realisation-sum invariant. Report the reproduction; the choice between
  dropping the event and re-attributing it is the maintainer's.
- Any of the 228 pre-existing tests fails.
- You find yourself widening `Position.lastTradeDate`'s meaning, or touching the
  sort at `positions.ts:740` or the roll-up at `:839-842`.
- You conclude the fix belongs in `src/lib/analytics.ts`. It does not — the date
  is wrong at the source.

## Maintenance notes

For whoever owns this next:

- **The distinction to preserve**: `lastTradeDate` means the last *trade* and is
  public; `lastEventDate` means the last row of any kind and is private to the
  walk. Collapsing them would silently change the closed-position sort and the
  account roll-ups.
- **Amounts are untouched by this change.** If a review shows a dollar figure
  moving in a *total*, something is wrong — only per-year attribution should
  shift.
- **This is rare in practice.** It needs a corporate action that closes a
  position without a paired rename. The reference export may contain none, which
  is why the tests carry the weight rather than a manual check.
- **What a reviewer should scrutinise**: that `Position` gained no field; that
  the comment at `positions.ts:692` no longer claims the residual belongs to a
  sale; that the realisation-sum invariant is untouched and still green; and
  that the executor reports having *seen case 2 fail* first.
