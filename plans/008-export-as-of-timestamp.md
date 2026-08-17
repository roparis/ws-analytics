# Plan 008: Capture the export's "As of" timestamp and show how fresh each file is

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 99fa8b4..HEAD -- src/lib/wealthsimple.ts src/lib/merge.ts src/lib/storage.ts src/components/data-source-card.tsx src/app/merge/page.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: **`plans/004-preserve-unparseable-sources.md` — land 004 first.**
  This plan bumps `PARSER_VERSION`, which forces every persisted source through
  `parseActivities` on the next load. Until 004 lands, any file that fails that
  re-parse is silently deleted from IndexedDB. Do not run this plan before 004.
- **Category**: direction
- **Planned at**: commit `d1d2640`, 2026-08-15
- **Reconciled at**: commit `99fa8b4`, 2026-08-16 — **every dependency named in
  this plan has now landed.** Plans 002, 003 and 004 are all on `main`, and
  together they changed all five in-scope files (+449/−15). Every conditional in
  the original text ("if 003 has landed", "if 004 landed", "if plan 002 landed")
  is therefore **resolved to the landed branch** below — you are not deciding
  which case you are in. Every excerpt is re-verified against `99fa8b4`, and the
  Step 3 typecheck prediction has been corrected: it was wrong about *which*
  files fail and *when*. See Step 3.

## Why this matters

Every Wealthsimple activities export ends with a line stating when it was
produced. The app currently reads that line only in order to throw it away.

This is open item 8 in the project's data dictionary,
`docs/wealthsimple-csv-format.md` §10:

> "**The export timestamp is discarded.** The footer's 'As of' time would let
> the UI show source freshness. (§1.1)"

And §1.1 elaborates:

> "The timestamp is genuinely useful metadata (it is the 'data is current as of'
> watermark) but is currently discarded. Capturing it would let the UI say how
> stale a source is."

The app has an honesty asymmetry today: it can tell you your *prices* are eight
days stale, but not that your *activity file* was exported in March. Every
figure on every page is bounded by that date. It is the one piece of provenance
the file volunteers, and it makes the merge review screen meaningfully better —
"this file was exported in August, that one in March" is exactly what explains a
coverage gap.

This plan changes no computed number. It only records and displays a fact the
file already states.

## Current state

Files and their roles:

- `src/lib/wealthsimple.ts` — the parser. Drops the footer; owns
  `PARSER_VERSION`.
- `src/lib/merge.ts` — owns `SourceFile` and `SourceSummary`.
- `src/lib/storage.ts` — persists sources; re-parses on version mismatch.
- `src/components/data-source-card.tsx` — the sidebar card.
- `src/app/merge/page.tsx` — the merge review screen, which already shows a
  per-source coverage window.

### What the footer looks like

From `docs/wealthsimple-csv-format.md` §1:

| Property | Value |
|---|---|
| Footer | A blank line, then a single-field row: `"As of <date> <time> GMT-04:00"` |

And §1.1:

> "The last two lines of the file are a blank line and an export-timestamp row.
> A naïve `header: true` CSV parse yields a bogus final record whose
> `transaction_date` is `As of <date> <time> GMT-04:00` and whose other 14
> fields are empty."

So after `Papa.parse(..., { header: true })`, the footer arrives as an ordinary
record whose **date column** holds the whole `As of …` string. The date column
is `effective_at` on modern exports and `transaction_date` on older ones.

§1.3 confirms the footer survives the column rename:

> "The footer row survives this change and is still dropped by the same leading-
> date test."

### Where it is dropped today

Verified excerpt, `src/lib/wealthsimple.ts:31-49`:

```ts
/**
 * Matches a bare date and the leading date of a timestamp alike. Deliberately
 * not anchored at the end: exports finish with a footer row such as
 * `"As of 2026-08-03 16:48 GMT-04:00"`, which still fails to match and is
 * dropped, but a legitimate `2026-08-06T15:31:21-04:00` must pass.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * The calendar date a row belongs to.
 *
 * Taken by slicing the first ten characters rather than by parsing to a `Date`.
 * The timestamp already states the date in the account's own timezone, so
 * converting to UTC would push every transaction after 20:00 local onto the
 * following day — silently moving trades between months and tax years.
 */
function toTransactionDate(value: string): string {
	return ISO_DATE.test(value) ? value.slice(0, 10) : "";
}
```

Verified excerpt, `src/lib/wealthsimple.ts:300-302` — the filter that removes it (unchanged since this plan was written):

```ts
				const activities = results.data
					.map((row) => toActivity(row, dateColumn))
					.filter((activity) => activity.transactionDate !== "");
```

**The filter must stay exactly as it is.** `docs/wealthsimple-csv-format.md` §1.1
is emphatic:

> "Keep that filter — it is the only thing standing between the footer and a
> `NaN` in every total."

You are adding a read of the raw rows *before* that filter, not changing it.

### The version constant to bump

Verified excerpt, `src/lib/wealthsimple.ts:51-58`:

```ts
/**
 * Bump whenever parsing changes semantics. Persisted sources carry the version
 * they were parsed with; a mismatch re-parses the stored raw text rather than
 * serving rows produced by known-stale logic.
 *
 * 2: accept `effective_at`, and keep the time of day it carries.
 */
export const PARSER_VERSION = 2;
```

### The type to extend

Verified excerpt, `src/lib/merge.ts:14-25` — this is the **post-003** shape, and
003 has landed:

```ts
export interface SourceFile {
	fileName: string;
	/** Kept so a later parser fix can re-derive instead of trusting cached rows. */
	rawText: string;
	activities: Activity[];
	/**
	 * Data-invariant violations found at parse time, one message each. Empty on
	 * a healthy export. See `validateDataset` and
	 * `docs/wealthsimple-csv-format.md` §6.
	 */
	problems: string[];
}
```

`problems` is 003's and is not yours to change. Add your field alongside it.

Verified excerpt, `src/lib/merge.ts:44-54` — `SourceSummary`, which is what both
UI surfaces read, also post-003:

```ts
export interface SourceSummary {
	fileName: string;
	rowsUsed: number;
	rowsSkipped: number;
	dateRange: { start: string; end: string };
	segments: CoverageSegment[];
	confidence: Confidence;
	confidenceReason: string;
	/** Carried through from the source file's `problems`, unchanged. */
	problems: string[];
}
```

It is built at `src/lib/merge.ts:240-249` (`summaries.push({ ... })`) — that is
where you copy your field through, beside `dateRange` at `:244`.

### The precedent for a staleness idiom

`src/lib/price-snapshot.ts` already implements exactly this pattern for prices —
find `snapshotAgeDays` and `STALE_AFTER_DAYS` in that file and **match its
shape and vocabulary**. Do not invent a second way of expressing "this is N days
old".

### Conventions

- **Tabs** for indentation.
- Comments are prose explaining *why*. Match the voice of the excerpts above.
- `@/` path alias for cross-module imports.
- Tailwind classes are auto-sorted by Biome — run `pnpm check` and accept its
  ordering.
- Test files sit beside their module as `*.test.ts` and use no mocks. See
  `src/lib/wealthsimple.test.ts` for the house style: a `makeActivity` factory
  with `Partial<Activity>` overrides, small invented numbers, and
  `import { describe, expect, it } from "vitest";`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, all pass |
| Run parser tests | `pnpm test wealthsimple` | all pass |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings) |
| Build | `pnpm build` | exit 0 |

**Before Step 1, record your own baseline.** Run `pnpm typecheck && pnpm test &&
pnpm check` and write down the passing test count, the file count, and the
warning count. Every later "all tests pass" in this plan means *your* numbers,
not any figure quoted in a plan document — several plans have shipped since this
one was written and the suite has grown. At the time of reconciliation it was
`Tests 293 passed (293)` across 17 files with 5 warnings, all in
`src/lib/google-sheet.ts`. Treat that as context, not as an assertion: stop only
if something **fails**.

## Scope

**In scope** (the only files you should modify or create):
- `src/lib/wealthsimple.ts`
- `src/lib/merge.ts`
- `src/lib/storage.ts`
- `src/components/data-source-card.tsx`
- `src/app/merge/page.tsx`
- `src/lib/wealthsimple.test.ts` — add tests for the new pure helper
- `src/lib/merge.test.ts` — **002 has landed**, so this file exists and builds
  `SourceFile` fixtures; expect to update them to keep it compiling
- `docs/wealthsimple-csv-format.md` — move open item 8 to the Fixed list
  (Step 7)

**Out of scope** (do NOT touch, even though they look related):
- The `.filter((activity) => activity.transactionDate !== "")` on
  `src/lib/wealthsimple.ts:302`, and `ISO_DATE`, and `toTransactionDate`. The
  footer must keep being excluded from activities. Read it separately; do not
  let it through.
- The `Activity` interface. The timestamp is a property of the **file**, not of
  a row.
- Any computed figure — KPIs, positions, projections, valuations. This plan adds
  provenance, nothing else. If a dollar figure moves, you have broken something.
- `validateDataset` and the invariant checks.
- Adding a *warning* about an old export. Show the date; do not editorialise.
  Warning invites people to re-export monthly for a tool that works fine on old
  data. (See Maintenance notes.)

## Git workflow

- Branch: `advisor/008-export-as-of-timestamp`
- Commit per step or per logical unit. Message style, matching `git log`
  (imperative, sentence-case, no conventional-commit prefix):
  `Read the export's own "as of" line instead of only discarding it`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Write the pure extraction helper

In `src/lib/wealthsimple.ts`, add an exported helper near `toTransactionDate`:

```ts
/**
 * The export's own "data is current as of" watermark.
 *
 * Wealthsimple closes every file with a blank line and a single-field row
 * reading `As of <date> <time> <offset>`. A `header: true` parse hands that row
 * back as an ordinary record whose date column holds the whole string, which is
 * why the activity filter drops it — see `toTransactionDate`. The date in it is
 * real information: every figure the app shows is bounded by it.
 *
 * Returns the calendar date as `YYYY-MM-DD`, or null when the file has no such
 * footer — hand-trimmed files and re-parses of stored text both occur.
 */
export function extractExportedOn(value: string | undefined): string | null {
```

Implementation notes:

- Match case-insensitively on a leading `As of`, then require an ISO date.
  A tolerant shape such as `/^\s*As of\s+(\d{4}-\d{2}-\d{2})/i` is right: it
  pins the two parts the doc guarantees and ignores the time and offset, which
  are not needed and whose formatting is less certain.
- Return only the `YYYY-MM-DD` capture. **Do not parse to a `Date`** — the same
  rule `toTransactionDate` documents applies here for the same reason.
- Return `null` for undefined, empty, or non-matching input. Never throw.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Test the helper

In `src/lib/wealthsimple.test.ts`, add a `describe("extractExportedOn")` block
covering:

- a well-formed footer string → the date
- a footer with a different UTC offset → the same date (the offset is ignored)
- `undefined` → `null`
- `""` → `null`
- an ordinary transaction date like `2026-01-15` → `null` (it is not a footer)
- a full ISO timestamp like `2026-08-06T15:31:21-04:00` → `null`

The last two matter most: the helper must never mistake a real row for a footer.

**Verify**: `pnpm test wealthsimple` → all pass, including your new cases.

### Step 3: Read the footer during the parse

In `src/lib/wealthsimple.ts`, inside the parse callback, read the footer from
`results.data` **before** the existing filter runs, and leave the filter
untouched:

```ts
				// The footer row is dropped from activities below, but it carries
				// the export's own timestamp — read it before it goes.
				const exportedOn =
					results.data.reduce<string | null>(
						(found, row) => found ?? extractExportedOn(row[dateColumn]),
						null,
					) ?? null;

				const activities = results.data
					.map((row) => toActivity(row, dateColumn))
					.filter((activity) => activity.transactionDate !== "");
```

Then include it in the resolved object:

```ts
				resolve({ fileName, rawText, activities, problems, exportedOn });
```

003 has landed, so that `resolve` already carries `problems` — verified at
`src/lib/wealthsimple.ts:332`. Keep it.

**Verify**: `pnpm typecheck` → **fails with exactly one error, in
`src/lib/wealthsimple.ts`**, at the `resolve(...)` call.

Read that carefully, because the original version of this plan predicted the
wrong thing here and you should not go looking for failures that will not
appear yet. `parseActivities` is declared `Promise<SourceFile>`
(`src/lib/wealthsimple.ts:270-273`), so `resolve` takes a `SourceFile`. Adding
`exportedOn` to a fresh object literal trips TypeScript's excess-property check
**at that literal** — something like "Object literal may only specify known
properties, and 'exportedOn' does not exist in type 'SourceFile'".

`src/lib/storage.ts` and `src/lib/merge.test.ts` still compile at this point:
they construct `SourceFile` values that are missing a field the interface does
not yet declare. They fail only after Step 4 adds the field to the interface,
which is the intended order.

**STOP if** the failure names any file outside the In-scope list, or if
`pnpm typecheck` **passes** — a pass means your new property is not reaching the
typed `resolve` and the rest of the plan will not behave as written.

### Step 4: Thread it through the types

In `src/lib/merge.ts`, add to `SourceFile`:

```ts
	/**
	 * The date the export itself says it is current as of, from its footer, or
	 * null when the file carries no footer. Provenance, not data — no figure is
	 * derived from it.
	 */
	exportedOn: string | null;
```

Add the same field to `SourceSummary`, and copy it through in `runMerge` where
the summary is built, next to `dateRange`.

In `src/lib/storage.ts`, `loadSources` constructs a `SourceFile` directly in the
"already current version" branch. Since Step 5 bumps `PARSER_VERSION`, every
stored source re-parses on the next load and picks the field up from
`parseActivities` — but the branch must still compile. Set it from the stored
entry if you add it to `StoredSource`, or `null` otherwise.

**Decide and be consistent**: adding `exportedOn` to `StoredSource`
(`src/lib/storage.ts:28`) means it survives without a re-parse next time the
version bumps. That is the better long-term shape. Do it.

004 has landed, so there are **two** write paths and both need the field — this
is the single easiest thing to half-do in this plan:

- `saveSources` — the `put` at `src/lib/storage.ts:215-216`
- `updateSources` — the `put` at `src/lib/storage.ts:246-247`

And one read path: the "already current version" branch at
`src/lib/storage.ts:180-185`, which builds a `SourceFile` from the stored entry.
Note how it handles 003's field — `problems: validateDataset(entry.activities)`,
recomputed rather than stored. Yours is different: `exportedOn` cannot be
recomputed from `activities`, because the footer row is not in `activities` at
all. Read it from the stored entry, falling back to `null` for entries written
before this change.

`loadSources` returns `{ sources, reparsed, failed }` since 004. Do not change
that shape.

**Verify**: `pnpm typecheck` → exit 0.

### Step 5: Bump the parser version

In `src/lib/wealthsimple.ts`:

```ts
/**
 * Bump whenever parsing changes semantics. Persisted sources carry the version
 * they were parsed with; a mismatch re-parses the stored raw text rather than
 * serving rows produced by known-stale logic.
 *
 * 2: accept `effective_at`, and keep the time of day it carries.
 * 3: read the export's "As of" footer instead of only discarding it.
 */
export const PARSER_VERSION = 3;
```

**Verify**: `grep -n "PARSER_VERSION = 3" src/lib/wealthsimple.ts` → one match.

Plan 004 has landed, which is what makes this bump safe: a re-parse that fails
now preserves the stored source instead of dropping it. Confirm it is really
there before bumping — `grep -n "export async function updateSources" src/lib/storage.ts`
→ one match. **If it does not, STOP** — see the Depends-on note at the top.

### Step 6: Show it

**On the merge page** (`src/app/merge/page.tsx`): the per-source table already
has a coverage column. Add the export date beside the file name or as its own
column, labelled clearly — `Exported` is enough. Render `—` when `exportedOn` is
null; a file with no footer is normal, not an error.

**On the sidebar card** (`src/components/data-source-card.tsx`): the non-compact
card already shows a line reading
`{dataset.activities.length} activities · {dataset.accounts.length} accounts`.
Add the newest `exportedOn` across all sources to that provenance line, or on a
line beneath it. "Newest" is right: the merged dataset is as current as its most
recent export.

Match the phrasing to `src/lib/price-snapshot.ts`'s existing staleness
vocabulary rather than inventing new wording. State the fact; do not warn.

**Verify**: `pnpm check` → exit 0.

**Verify**: `pnpm typecheck` → exit 0.

### Step 7: Close the open item in the data dictionary

In `docs/wealthsimple-csv-format.md` §10, move item 8 from **Open** to
**Fixed**, using the existing convention there — struck through with a sentence
saying what happened. Match the style of the existing Fixed entries, e.g.:

> 8. ~~**The export timestamp is discarded.**~~ `extractExportedOn` reads the
>    footer's "As of" date and carries it on each source; the sidebar and the
>    merge review both show it. (§1.1)

Do not renumber the other items — the Fixed and Open lists share one sequence
and other text refers to them by number.

**Verify**: `grep -n "export timestamp is discarded" docs/wealthsimple-csv-format.md`
→ the line now begins with `~~`.

### Step 8: Full verification

**Verify**: `pnpm test` → exit 0, all tests pass.

**Verify**: `pnpm build` → exit 0.

**Verify**: `git status --short` → only files from the In-scope list.

## Test plan

New tests in `src/lib/wealthsimple.test.ts`:

| Case | Expected |
|---|---|
| `"As of 2026-08-03 16:48 GMT-04:00"` | `"2026-08-03"` |
| Same with a different offset | same date |
| `undefined` | `null` |
| `""` | `null` |
| `"2026-01-15"` | `null` |
| `"2026-08-06T15:31:21-04:00"` | `null` |
| Lower-case `"as of 2026-08-03 …"` | `"2026-08-03"` |

Model structurally after the existing `describe` blocks in that file.

002 has landed, so add one case to `src/lib/merge.test.ts`: a source with an
`exportedOn` value produces a summary carrying the same value unchanged. You
will be in that file anyway — its `SourceFile` fixtures stop compiling the
moment Step 4 adds a required field.

Existing tests that must keep passing: **all of them**, unchanged. This plan
must not move a single computed figure.

Manual check, if the operator can run the app — report, do not gate:

1. `pnpm dev`, load a real export.
2. Confirm the sidebar shows the export date and the merge page shows it per
   file.
3. Confirm the activity count and every KPI are **identical** to before the
   change. The footer must not have leaked into activities.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; every pre-existing test still passes, plus at least 7
      new cases for `extractExportedOn`
- [ ] `pnpm check` exits 0, with the **same warning count you measured in your
      baseline** and no new warning outside `src/lib/google-sheet.ts`. Do not
      assert an absolute number: `plans/016` clears those five, so the correct
      count is 5 before it lands and 0 after.
- [ ] `pnpm build` exits 0
- [ ] `grep -n "PARSER_VERSION = 3" src/lib/wealthsimple.ts` returns one match
- [ ] `grep -n 'transactionDate !== ""' src/lib/wealthsimple.ts` still returns
      the original filter, unmodified
- [ ] `grep -n "exportedOn" src/lib/merge.ts` shows the field on both
      `SourceFile` and `SourceSummary`
- [ ] `grep -n "updateSources" src/lib/storage.ts` returns a match (plan 004
      landed)
- [ ] `git status --short` lists only files from the In-scope list
- [ ] `plans/README.md` status row for 008 updated

## STOP conditions

Stop and report back (do not improvise) if:

- **Plan 004 has not landed** (`grep -n "updateSources" src/lib/storage.ts`
  finds nothing). The `PARSER_VERSION` bump in Step 5 forces a re-parse of every
  stored file, and without 004 a file that fails that re-parse is deleted.
- Step 3's typecheck failure names a file outside the In-scope list.
- Any existing test fails, or any activity count or dollar figure changes. This
  plan must be figure-neutral.
- You find the footer's date does not match the documented shape in a real
  export. Report the shape you observed — **with the date replaced by
  `<date>`**, since a real export's contents are personal data.
- You conclude the footer's *time* or *offset* is needed. It is not, for this
  plan; capturing the date is the whole scope. Report why if you disagree.
- You find yourself wanting to make an old export produce a warning or block
  anything.

## Maintenance notes

For whoever owns this next:

- **State the fact, do not warn.** The deliberate choice here is to show the
  date and let the user judge. An "this export is old" warning would push people
  to re-export monthly for a tool that works perfectly well on old data, and the
  coverage window on the merge page already answers "is anything missing".
- **`exportedOn` is provenance, never an input.** No KPI, position, projection,
  or valuation may read it. If a future change wants to derive something from
  it, that is a design decision worth arguing explicitly — the whole point of
  `docs/wealthsimple-csv-format.md` §2.4's "use `transaction_date` for all time
  bucketing" is that only one date drives arithmetic.
- **The `PARSER_VERSION` bump is the risky part of this plan, not the parsing.**
  It re-parses every stored file on the next load for every existing user. That
  is exactly why plan 004 is a hard dependency.
- **What a reviewer should scrutinise**: that the activity filter is byte-for-
  byte unchanged; that no test's expected dollar figure moved; that
  `extractExportedOn` cannot match a real transaction row; and that a file with
  no footer renders `—` rather than breaking.
