# Plan 002: Cover `merge.ts` with characterization tests before anyone refactors it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d1d2640..HEAD -- src/lib/merge.ts`
> If `src/lib/merge.ts` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (but 001 should land first so these tests are enforced)
- **Category**: tests
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

`src/lib/merge.ts` is 299 lines and has **zero tests**. It is the module that
decides which activity rows survive when a user loads more than one Wealthsimple
export, and its failure mode is the worst kind: it silently drops real
transactions and produces a dashboard that looks entirely plausible and is short
a month of someone's money.

The project's own data dictionary, `docs/wealthsimple-csv-format.md` §6.1, says:

> "This makes the file self-validating: if the app's parse produces a
> per-account total that is large, negative, or wildly off, rows have been
> dropped, duplicated, or sign-flipped. **This is the single best regression
> test for the parser and the merge logic.**"

That regression test does not currently exist for the merge logic. This plan
writes it. These are *characterization* tests — they pin down what the code does
today so that a future change to it is safe. Do not change `merge.ts` itself.

## Current state

- `src/lib/merge.ts` — the module under test. No test file exists.
- `src/lib/wealthsimple.test.ts` — **use this as your structural pattern.**
- `src/lib/metrics.test.ts` — a second example; its "reconciliation" test at
  line 177 shows the house style of asserting a *property* rather than a
  literal.

### The domain rules these tests must encode

Inlined from `docs/wealthsimple-csv-format.md` — the executor has not read it,
and getting these backwards will produce tests that assert the wrong thing:

From §7, and echoed in `merge.ts:1-12`:

> "**The export has no per-row unique identifier**, and dozens of distinct row
> signatures appear more than once in the reference export... These are genuine
> separate transactions, not export artifacts... **Never de-duplicate by row
> content.**"

So: two byte-identical rows inside one file are two real transactions and both
must survive. This is the single most important thing these tests protect.

From §2.1:

> "Every row's effect on the account's cash is `net_cash_amount`, signed from
> the account's point of view: **positive = cash in, negative = cash out**."

From §5:

> "`account_type` is a **label, not a key**. Three distinct TFSAs in the
> reference export share the type `TFSA`... Any per-account grouping must key on
> `account_id`."

### How the merge actually works

Read this before writing a single assertion. Verified excerpt,
`src/lib/merge.ts:1-12`:

```ts
/**
 * Exports carry no per-row identifier, and genuinely identical rows do occur
 * (e.g. two separate $25 transfers into the same account on the same day), so
 * de-duplicating by row content would silently delete real activity.
 *
 * Instead we merge by coverage: each file covers a date window per account, and
 * a file only contributes rows for the parts of that window no earlier file has
 * already claimed. Overlaps never double-count, and duplicates inside a single
 * file are preserved.
 */
```

The mechanism, in order:

1. Sources are processed **in the order supplied — earlier files win overlaps.**
2. Per source, rows are grouped by `accountId` (`merge.ts:135-141`).
3. For each row, if its `transactionDate` falls inside an interval already
   claimed for that account, the row is **skipped**; otherwise it is kept.
   `covers` is **inclusive on both ends** (`merge.ts:64-69`):

```ts
function covers(intervals: Interval[], date: string): boolean {
	for (const interval of intervals) {
		if (date >= interval.start && date <= interval.end) return true;
	}
	return false;
}
```

4. After a source's rows for an account are processed, that account's claimed
   intervals absorb the **full span of the source's rows** — not just the rows
   it contributed (`merge.ts:212-213`):

```ts
const window = windowOf(rows);
if (window) claimedByAccount.set(accountId, claim(claimed, window));
```

5. `claim` coalesces intervals that **touch or overlap** (`merge.ts:71-89`).
   Note the condition is `interval.end < current.start || interval.start > current.end`,
   so adjacent-but-not-overlapping intervals are also merged into one.

6. Confidence is assigned per source (`merge.ts:218-228`):

```ts
let confidence: Confidence = "high";
let confidenceReason = "No overlap with other files — nothing was dropped.";
if (disagreements.length > 0) {
	confidence = "low";
	confidenceReason = `The shared period doesn't match. ${disagreements.join("; ")}.`;
} else if (skipped > 0) {
	confidence = "medium";
	confidenceReason = `${skipped.toLocaleString()} overlapping rows were dropped, and they match the winning file exactly — redundant re-export, totals unaffected.`;
}
```

A disagreement is recorded when the dropped rows differ from what the winning
file holds over the same span, by **count or by net cash beyond half a cent**
(`merge.ts:186-190`):

```ts
if (
	mine.count !== theirs.count ||
	Math.abs(mine.net - theirs.net) > 0.005
) {
```

7. The merged `activities` array is sorted by `transactionDate` at the end
   (`merge.ts:246`).

### The two exported entry points

```ts
export function analyzeMerge(sources: SourceFile[]): MergeAnalysis
export function mergeSources(sources: SourceFile[]): MergedDataset | null
```

`mergeSources` returns `null` for an empty array (`merge.ts:262`).
`analyzeMerge` additionally retains the dropped rows in `skippedBySource`.

### The exemplar test file's shape

Verified excerpt, `src/lib/wealthsimple.test.ts:1-40` — match this style
(a `makeActivity` factory with `Partial<Activity>` overrides, then narrow
helpers built on it):

```ts
import { describe, expect, it } from "vitest";
import { type Activity, validateDataset } from "@/lib/wealthsimple";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
	return {
		transactionDate: "2026-01-15",
		effectiveAt: null,
		settlementDate: null,
		accountId: "TEST0001CAD",
		accountType: "TFSA",
		activityType: "MoneyMovement",
		activitySubType: "EFT",
		description: "Deposit",
		symbol: null,
		name: null,
		currency: "CAD",
		quantity: 100,
		unitPrice: null,
		commission: null,
		netCashAmount: 100,
		...overrides,
	};
}

const buy = (overrides: Partial<Activity> = {}) =>
	makeActivity({
		activityType: "Trade",
		activitySubType: "BUY",
		/* ... */
		...overrides,
	});

describe("validateDataset", () => {
	it("passes a well-formed dataset", () => {
		// Deposit funds the buy; the account is left with $50 idle cash.
		expect(
			validateDataset([
				makeActivity({ quantity: 250, netCashAmount: 250 }),
				buy(),
			]),
		).toEqual([]);
	});
});
```

House conventions visible there and required here:

- Tabs for indentation.
- `import { describe, expect, it } from "vitest";` — no globals.
- `@/` path alias for imports (mapped in `vitest.config.mts`).
- Comments explain *why* a fixture is shaped the way it is, in prose.
- **No mocks anywhere.** `grep "vi.mock\|vi.fn\|vi.spyOn"` across all 13 test
  files returns zero hits. Do not introduce one.
- All fixture numbers are small, round, and invented. Never use figures that
  look like real financial data.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Run just this file | `pnpm test merge` | all pass |
| Full suite | `pnpm test` | exit 0, 227 existing + your new tests |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings are fine) |

## Scope

**In scope** (the only file you should create or modify):
- `src/lib/merge.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `src/lib/merge.ts` — **this is the point of the plan.** These tests
  characterize existing behaviour. If a test reveals what looks like a bug, that
  is a finding to report, not a thing to fix here. Writing the test and the fix
  together destroys the test's value as a safety net.
- `src/lib/wealthsimple.ts`, `src/stores/dataset.ts`, `src/app/merge/page.tsx` —
  consumers, not subjects.
- `vitest.config.mts` — the existing `include: ["src/**/*.test.ts"]` already
  picks up your new file. No config change is needed.
- Any other test file.

## Git workflow

- Branch: `advisor/002-merge-tests`
- Commit message, matching repo style (imperative, sentence-case, no
  conventional-commit prefix):
  `Pin down what merging overlapping exports actually does`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Create the file with the fixture factory

Create `src/lib/merge.test.ts`. Start with the imports and a `makeActivity`
factory copied in shape from `src/lib/wealthsimple.test.ts` (excerpt above),
plus a `makeSource` helper:

```ts
import { describe, expect, it } from "vitest";
import { analyzeMerge, mergeSources, type SourceFile } from "@/lib/merge";
import type { Activity } from "@/lib/wealthsimple";
```

Add a helper that builds a `SourceFile` from a name and rows. `rawText` is
required by the type but is never read by the merge, so a placeholder string is
correct and honest — add a one-line comment saying so.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Write the "no overlap" baseline tests

Two sources covering disjoint date windows for the same account.

Assert:
- Every row from both sources appears in `mergeSources(...)!.activities`.
- The count equals the sum of both inputs.
- Both summaries report `confidence: "high"` and `rowsSkipped: 0`.
- `dateRange.start` / `.end` span both files.
- The output is sorted ascending by `transactionDate`.

Then a single-source case: `mergeSources([one])` returns `fileName` equal to
that source's own name, and `mergeSources([a, b])` returns `"2 files merged"`
(`merge.ts:265-268`).

And the empty case: `mergeSources([])` returns `null`.

**Verify**: `pnpm test merge` → all pass.

### Step 3: Write the duplicate-preservation test — the most important one

This is the test that protects §7 of the data dictionary.

Build **one** source containing two byte-identical rows (same date, same
account, same amount, same description) plus one other row.

Assert:
- `mergeSources([source])!.activities` has length 3, not 2.
- The sum of `netCashAmount` across the output equals the sum across the input.

Add a comment naming the rule and where it comes from, e.g.
`// docs/wealthsimple-csv-format.md §7: identical rows are separate real
// transactions. De-duplicating by content would delete money.`

**Verify**: `pnpm test merge` → all pass.

### Step 4: Write the overlap tests

**4a — redundant re-export.** Source A covers Jan 1–Mar 31. Source B covers
Feb 1–Apr 30 and repeats A's February and March rows *exactly*, plus adds April
rows.

Assert:
- No row is double-counted: the total row count equals the true union.
- B's summary has `rowsSkipped` > 0 and `confidence: "medium"`.
- The net cash total equals the union's true total.

**4b — disagreeing overlap.** Same setup, but source B's overlapping window is
missing one row that A has (or carries a different amount).

Assert:
- B's summary has `confidence: "low"`.
- `confidenceReason` contains the account id and mentions both row counts.

**4c — inclusive boundary.** Source A's window ends exactly on a date where
source B also has a row. Because `covers` is inclusive on both ends, B's row on
that exact date is skipped.

Assert the current behaviour explicitly and comment that the boundary is
inclusive by design, citing `merge.ts:64-69`.

**Verify**: `pnpm test merge` → all pass.

### Step 5: Write the per-account isolation test

Two accounts with the **same `accountType`** but different `accountId` (the
data dictionary §5 case: three TFSAs sharing one label).

Source A covers only account 1. Source B covers the same date window but only
account 2.

Assert:
- Nothing is skipped — claiming a window for account 1 must not suppress
  account 2's rows over the same dates.
- Both summaries report `confidence: "high"`.

**Verify**: `pnpm test merge` → all pass.

### Step 6: Write the cash-balance property test

This is the §6.1 invariant, applied to the merge — the highest-value assertion
in the file.

Build two overlapping sources where you know, by construction, the true per-
account sum of `netCashAmount` for the union of their rows. Merge them.

Assert: for each `accountId`, the sum of `netCashAmount` over the merged
activities equals the true union total, to within half a cent.

Write it as a loop over a `Map<accountId, expectedTotal>` so adding a case later
is cheap. This is the test that would catch a dropped or double-counted row
regardless of which code path caused it.

**Verify**: `pnpm test merge` → all pass.

### Step 7: Write the `analyzeMerge` test

Assert that `analyzeMerge` returns the same `totalRows` as
`mergeSources(...)!.activities.length` for the same input, and that
`skippedBySource[fileName]` contains exactly the rows that `mergeSources`
dropped — i.e. `analyzeMerge` and `mergeSources` never disagree about what was
kept.

**Verify**: `pnpm test merge` → all pass.

### Step 8: Run the full suite and lint

**Verify**: `pnpm test` → exit 0, 227 pre-existing tests still pass plus your new
ones. **If any pre-existing test now fails, STOP** — you have modified something
outside scope.

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `pnpm check` → exit 0 (the 5 pre-existing `google-sheet.ts` warnings
are expected; your new file must add none).

## Test plan

All of the above is the test plan. Summary of required cases in
`src/lib/merge.test.ts`:

| # | Case | Protects |
|---|---|---|
| 1 | Disjoint windows merge completely | baseline |
| 2 | Single source / empty array / `fileName` labelling | API surface |
| 3 | Identical rows within one file both survive | §7, the money-deleting bug |
| 4a | Redundant overlap → `medium`, no double-count | overlap policy |
| 4b | Disagreeing overlap → `low`, reason names the account | data-loss signal |
| 4c | Inclusive window boundary | off-by-one-day |
| 5 | Same `accountType`, different `accountId` stay independent | §5 |
| 6 | Per-account net cash equals the true union total | §6.1 invariant |
| 7 | `analyzeMerge` agrees with `mergeSources` | API consistency |

Model the file structurally after `src/lib/wealthsimple.test.ts`. No mocks, no
fake timers, no snapshots.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `src/lib/merge.test.ts` exists
- [ ] `pnpm test merge` exits 0 with at least 9 tests passing
- [ ] `pnpm test` exits 0; total test count is 227 + (your new tests)
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm check` exits 0 with no new warnings (still exactly 5, all in
      `src/lib/google-sheet.ts`)
- [ ] `git status --short` shows exactly one changed file: `src/lib/merge.test.ts`
- [ ] `git diff --stat d1d2640..HEAD -- src/lib/merge.ts` shows **no changes**
      to `merge.ts`
- [ ] `grep -c "vi\.mock\|vi\.fn\|vi\.spyOn" src/lib/merge.test.ts` returns 0
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A test you write to characterize current behaviour **fails**, and the
  behaviour it reveals looks wrong (rows lost, double-counted, or a confidence
  level that misrepresents what happened). Report the failing case and what you
  observed. **Do not fix `merge.ts`.** A real bug found here is a valuable
  finding and belongs in its own change with its own review.
- `src/lib/merge.ts` does not match the excerpts in "Current state".
- Any pre-existing test starts failing.
- You conclude a test needs a mock, a fake timer, or a snapshot to write. None
  of those are used anywhere in this suite; needing one means the test is aimed
  at the wrong seam.
- You find yourself wanting to export something new from `merge.ts` to make it
  testable. The two exported functions are enough for every case above.

## Maintenance notes

For whoever owns this next:

- **These tests are a safety net, not a specification.** They record what the
  code does at commit `d1d2640`. If a future change *intends* to alter merge
  behaviour, the right move is to change the test deliberately and say why in
  the commit message — not to treat a red test as a mistake.
- **The boundary case in 4c is the fragile one.** `covers` is inclusive on both
  ends and `claim` coalesces adjacent intervals. Anyone touching either function
  should expect that test to be the first to move.
- **Case 6 is the one worth keeping green above all others.** It is the merge
  half of the invariant `docs/wealthsimple-csv-format.md` §6.1 calls "the single
  best regression test for the parser and the merge logic."
- **Deferred deliberately**: tests for `parseActivities` in
  `src/lib/wealthsimple.ts`, which is also untested and also dangerous. It needs
  a different approach (the parse is promise-based with `worker: true`), so it
  is not bundled here.
- **What a reviewer should scrutinise**: that `merge.ts` is untouched, that the
  fixture amounts are obviously synthetic, and that case 3 genuinely asserts
  length 3 rather than deduplicating.
