# Plan 003: Run the data-invariant checks in every build and show the result in the UI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat d1d2640..HEAD -- src/lib/wealthsimple.ts src/lib/merge.ts src/lib/storage.ts src/components/data-source-card.tsx src/app/merge/page.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none. Landing 002 first is recommended but not required.
- **Category**: bug
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

The project's data dictionary, `docs/wealthsimple-csv-format.md` §9, makes this
promise:

> "I1, I2 and I5 run against the *real* file at parse time via `validateDataset`
> in `wealthsimple.ts` — asserting them over hand-built fixtures would only test
> the fixtures. The reference export produces zero violations. **If you have
> your own export, the same checks run automatically the moment you load it.**"

They do not. The call is wrapped in `if (process.env.NODE_ENV !== "production")`,
which Next.js inlines at build time — so the entire block is dead code in
`next build`, the exact command `README.md` tells self-hosting users to run. And
even in development, the result goes to `console.warn`, which reaches nobody who
does not have devtools open.

So the app's single best defence against a Wealthsimple format change — a sign
flip, a renamed column silently coerced to `0`, rows dropped in a merge — is
switched off in the build people actually use. §6.1 of the same document calls
the I5 check "the single best regression test for the parser and the merge
logic."

This plan turns the checks on everywhere and routes the result to the screen
instead of the console. It also removes an incidental privacy wart: the current
warning strings embed account identifiers and dollar balances, and writing those
to the browser console is worse than showing them in the app's own UI, where
they belong.

## Current state

Files and their roles:

- `src/lib/wealthsimple.ts` — the parser. Owns `validateDataset` and the
  `NODE_ENV` gate that disables it.
- `src/lib/merge.ts` — owns the `SourceFile` and `SourceSummary` types; merges
  sources into `MergedDataset`.
- `src/lib/storage.ts` — reads persisted sources back out of IndexedDB.
- `src/components/data-source-card.tsx` — the sidebar card; already renders a
  warning line for merge conflicts. This is the pattern to match.
- `src/app/merge/page.tsx` — the merge review screen; already renders a
  per-source footnote list for anything below `high` confidence.

### The gate to remove

Verified excerpt, `src/lib/wealthsimple.ts:319-333`:

```ts
				if (unknown.length > 0) {
					console.warn(
						`${fileName}: unrecognized activity types not in the KPI breakdown: ${unknown.join(", ")}. They still count in net cash flow.`,
					);
				}

				if (process.env.NODE_ENV !== "production") {
					const problems = validateDataset(activities);
					if (problems.length > 0) {
						console.warn(
							`${fileName}: ${problems.length} data-invariant violation(s). The export may not match docs/wealthsimple-csv-format.md:\n${problems.slice(0, 20).join("\n")}`,
						);
					}
				}

				resolve({ fileName, rawText, activities });
```

### Why the strings must not go to the console

`validateDataset` builds messages that embed account identifiers and dollar
totals. Verified excerpt, `src/lib/wealthsimple.ts:255-262`:

```ts
	for (const [accountId, { total, accountType }] of residuals) {
		const floor = isMarginAccount(accountType)
			? Number.NEGATIVE_INFINITY
			: -CENT;
		if (total < floor || total > CASH_RESIDUAL_LIMIT) {
			problems.push(
				`${accountId}: net cash sums to ${total.toFixed(2)}, which is not a plausible cash balance — rows may be missing or duplicated`,
			);
		}
	}
```

These belong on screen, in the user's own app, looking at their own data. They
do not belong in a console log that screen-recording and console-scraping
browser extensions can read. **Step 2 removes that `console.warn` entirely
rather than un-gating it.**

### The type to extend

Verified excerpt, `src/lib/merge.ts:14-19`:

```ts
export interface SourceFile {
	fileName: string;
	/** Kept so a later parser fix can re-derive instead of trusting cached rows. */
	rawText: string;
	activities: Activity[];
}
```

Verified excerpt, `src/lib/merge.ts:35-44`:

```ts
export interface SourceSummary {
	fileName: string;
	rowsUsed: number;
	rowsSkipped: number;
	dateRange: { start: string; end: string };
	segments: CoverageSegment[];
	confidence: Confidence;
	confidenceReason: string;
}
```

### Where the persisted path rebuilds a `SourceFile`

Verified excerpt, `src/lib/storage.ts:167-184`:

```ts
		let reparsed = 0;
		const sources: SourceFile[] = [];
		for (const entry of ordered) {
			if (entry.parserVersion === PARSER_VERSION) {
				sources.push({
					fileName: entry.fileName,
					rawText: entry.rawText,
					activities: entry.activities,
				});
				continue;
			}
			try {
				sources.push(await parseActivities(entry.rawText, entry.fileName));
				reparsed++;
			} catch {
				// A file that no longer parses is dropped rather than blocking startup.
			}
		}
```

Note the first branch constructs a `SourceFile` **without** going through
`parseActivities`, so it will not have `problems` unless you compute them there.
`validateDataset` is a pure function over rows already in memory, so computing it
at load is correct and cheap. **Do not add a field to `StoredSource` and do not
bump `PARSER_VERSION`** — recomputing is always fresh and needs no schema change.

### The UI pattern to match

Verified excerpt, `src/components/data-source-card.tsx:26-33` and `:84-97`:

```tsx
	const conflicts = dataset.sources.filter(
		(source) => source.confidence === "low",
	).length;
	const skipped = dataset.sources.reduce(
		(total, source) => total + source.rowsSkipped,
		0,
	);
```

```tsx
				{conflicts > 0 ? (
					<span className="flex items-start gap-1 pt-0.5 text-destructive text-xs">
						<AlertTriangle className="mt-0.5 size-3 shrink-0" />
						{conflicts} file{conflicts === 1 ? "" : "s"} disagree with an
						earlier file
					</span>
				) : (
					skipped > 0 && (
						<span className="pt-0.5 text-xs">
							{skipped.toLocaleString()} duplicate rows skipped
						</span>
					)
				)}
```

And on the merge page, `src/app/merge/page.tsx:267-271` opens a footnote list
rendered only when something is below `high` confidence:

```tsx
					{analysis.summaries.some(
						(summary) => summary.confidence !== "high",
					) && (
						<ul className="flex flex-col gap-1 text-xs">
```

### Repo conventions

- **Tabs** for indentation, everywhere. Biome enforces this.
- Comments are prose and explain *why*, not what. Match the surrounding voice —
  see the block comment at the top of `src/lib/merge.ts` for the house style.
- `@/` path alias for all cross-module imports.
- Tailwind classes are auto-sorted by Biome; run `pnpm check` and let it tell
  you.
- Icons come from `lucide-react`. `AlertTriangle` is already imported in
  `data-source-card.tsx`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, 227 tests pass (plus 002's, if landed) |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings) |
| Build | `pnpm build` | exit 0 |
| Run just parser tests | `pnpm test wealthsimple` | all pass |

## Scope

**In scope** (the only files you should modify):
- `src/lib/wealthsimple.ts`
- `src/lib/merge.ts`
- `src/lib/storage.ts`
- `src/components/data-source-card.tsx`
- `src/app/merge/page.tsx`
- `src/lib/merge.test.ts` — **only if plan 002 has landed**, to keep its
  fixtures compiling. If 002 has not landed, this file does not exist and you
  create nothing.

**Out of scope** (do NOT touch, even though they look related):
- The body of `validateDataset` itself (`src/lib/wealthsimple.ts:~150-265`).
  Its logic, thresholds, and message wording are correct and separately tested.
  You are changing *when it runs and where the result goes*, nothing else.
- `PARSER_VERSION` and the `StoredSource` interface in `src/lib/storage.ts`.
  No schema change is needed; see above.
- The unrecognized-activity-type `console.warn` at
  `src/lib/wealthsimple.ts:320-323`. It is a separate concern and touching it
  widens this diff for no benefit.
- `src/lib/wealthsimple.test.ts` — the existing `validateDataset` tests must
  keep passing unchanged. If they break, you changed the function's behaviour,
  which is out of scope.
- Any change that makes a violation *block* loading a file. A violation is a
  warning, never a rejection — a real export with an odd row must still load.

## Git workflow

- Branch: `advisor/003-invariants-in-production`
- Commit per step or per logical unit. Message style, matching `git log`
  (imperative, sentence-case, no conventional-commit prefix):
  `Check the invariants in every build, and say so on screen`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Add `problems` to `SourceFile` and `SourceSummary`

In `src/lib/merge.ts`, add the field to both interfaces:

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

Add `problems: string[];` to `SourceSummary` with a one-line doc comment saying
it is carried through from the source file unchanged.

Make it **required, not optional** — every construction site is in scope and
will be updated in the steps below, and an optional field would let a future
call site silently skip it.

In `runMerge` (`src/lib/merge.ts:~230`), copy it through when building each
summary:

```ts
		summaries.push({
			fileName: source.fileName,
			rowsUsed: used,
			rowsSkipped: skipped,
			dateRange: windowOf(source.activities) ?? { start: "", end: "" },
			segments,
			confidence,
			confidenceReason,
			problems: source.problems,
		});
```

**Verify**: `pnpm typecheck` → **fails**, with errors at every place a
`SourceFile` is constructed without `problems`. That is expected and is how you
find the call sites. Record the list of files it names; they should be
`src/lib/wealthsimple.ts` and `src/lib/storage.ts` and, if plan 002 landed,
`src/lib/merge.test.ts`. **If it names any file not in the In-scope list, STOP.**

### Step 2: Run the check unconditionally and stop logging it

In `src/lib/wealthsimple.ts`, replace the gated block (excerpt in "Current
state") with an unconditional computation whose result travels on the returned
`SourceFile` rather than to the console:

```ts
				// The invariants are the export's own self-check, so they run in
				// every build rather than only in development. The messages name
				// accounts and balances, so they travel to the UI on the source
				// itself instead of to a console anyone recording the screen can
				// read. See docs/wealthsimple-csv-format.md §6.
				const problems = validateDataset(activities);

				resolve({ fileName, rawText, activities, problems });
```

Delete the `console.warn` for invariant violations entirely. Leave the
unrecognized-activity-type `console.warn` above it exactly as it is.

**Verify**: `grep -n "NODE_ENV" src/lib/wealthsimple.ts` → **no matches**.

**Verify**: `pnpm test wealthsimple` → all existing `validateDataset` tests still
pass. If any fails, you changed the function body — revert that part.

### Step 3: Compute `problems` on the persisted-load path

In `src/lib/storage.ts`, add `validateDataset` to the existing import from
`@/lib/wealthsimple`, and fill the field in the branch that skips re-parsing:

```ts
			if (entry.parserVersion === PARSER_VERSION) {
				sources.push({
					fileName: entry.fileName,
					rawText: entry.rawText,
					activities: entry.activities,
					// Recomputed rather than stored: it is a pure pass over rows
					// already in memory, and a stored copy could outlive a change to
					// the checks themselves.
					problems: validateDataset(entry.activities),
				});
				continue;
			}
```

The other branch calls `parseActivities`, which now supplies `problems` itself —
leave it alone.

**Verify**: `pnpm typecheck` → exit 0. All errors from Step 1 are now resolved.

### Step 4: Surface a count in the sidebar card

In `src/components/data-source-card.tsx`, add a derived count beside the
existing `conflicts` and `skipped`:

```tsx
	const flagged = dataset.sources.reduce(
		(total, source) => total + source.problems.length,
		0,
	);
```

Extend the existing warning block so an invariant violation is reported. Keep
the current precedence — a merge conflict is the more actionable problem, so it
still wins the single line — and add the invariant line beneath it when
`flagged > 0`. The line should link to `/merge` like the rest of the card
already does (the whole block is already wrapped in a `<Link href="/merge">`),
and read something like:

```tsx
				{flagged > 0 && (
					<span className="flex items-start gap-1 pt-0.5 text-destructive text-xs">
						<AlertTriangle className="mt-0.5 size-3 shrink-0" />
						{flagged} row{flagged === 1 ? "" : "s"} don't add up — review
					</span>
				)}
```

Also add an indicator to the `compact` branch (`data-source-card.tsx:47-69`),
which currently shows the `AlertTriangle` only when `conflicts > 0`. Change that
condition to `conflicts > 0 || flagged > 0` so the mobile header does not hide
the signal.

**Verify**: `pnpm check` → exit 0 (Biome will re-sort Tailwind classes; accept
its formatting).

**Verify**: `pnpm typecheck` → exit 0.

### Step 5: Show the detail on the merge page

In `src/app/merge/page.tsx`, the footnote list at `:267` currently renders only
when some summary is below `high` confidence. Widen that condition to also fire
when any summary has problems, and render each problem string as its own list
item under its file name, reusing the existing `<li>` styling.

Cap what is rendered per file at **20 messages**, matching the cap the old
console log used, and when there are more, add a final line reading
`…and N more`. A malformed export can produce one message per row, and an
unbounded list would be unusable.

Keep the existing confidence footnotes exactly as they are — you are adding a
second category of footnote, not replacing the first.

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `pnpm check` → exit 0.

### Step 6: Update the fixtures in plan 002's tests, if that plan landed

If `src/lib/merge.test.ts` exists, its `makeSource` helper now needs a
`problems` field. Add `problems: []` to the helper's default. Do not add
assertions about `problems` here — merge does not compute them, it only carries
them.

If `src/lib/merge.test.ts` does not exist, skip this step.

**Verify**: `pnpm test` → exit 0.

### Step 7: Confirm the checks actually run in a production build

This is the whole point of the plan, so verify it directly rather than trusting
the diff.

**Verify**: `pnpm build` → exit 0.

**Verify**: `grep -rn "NODE_ENV" src/lib/` → no matches in `wealthsimple.ts`.

**Verify**: `pnpm test` → exit 0, all tests pass.

## Test plan

New tests in `src/lib/wealthsimple.test.ts` — add a `describe("parseActivities
problems")` block **only if** you can do it without restructuring the existing
file. `parseActivities` is promise-based and uses `worker: true`, which makes it
awkward to test directly; if it resists, do not fight it. Note it as deferred
and rely on the checks below instead. Testing the parse path properly is its own
piece of work.

Required regression coverage that does not depend on the parser:

- In `src/lib/merge.test.ts` (if plan 002 landed): assert that
  `mergeSources([source])!.sources[0].problems` is the same array of strings the
  input `SourceFile` carried — i.e. merge passes it through untouched, including
  for a source whose rows were partly skipped.

Existing tests that must keep passing unchanged:

- Every test in `src/lib/wealthsimple.test.ts`. They exercise `validateDataset`
  directly and its behaviour is out of scope for this plan.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "NODE_ENV" src/lib/wealthsimple.ts` returns no matches
- [ ] `grep -n "data-invariant violation" src/lib/wealthsimple.ts` returns no
      matches (the console warning is gone, not merely un-gated)
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; every pre-existing test still passes
- [ ] `pnpm check` exits 0 with no new warnings (still exactly 5, all in
      `src/lib/google-sheet.ts`)
- [ ] `pnpm build` exits 0
- [ ] `git status --short` lists only files from the In-scope list
- [ ] `grep -n "problems" src/lib/merge.ts` shows the field on both
      `SourceFile` and `SourceSummary`
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's typecheck failure names a file outside the In-scope list. It means
  `SourceFile` is constructed somewhere this plan did not anticipate.
- Any existing test in `src/lib/wealthsimple.test.ts` fails. That means
  `validateDataset`'s behaviour changed, which is out of scope.
- `pnpm build` fails.
- You find yourself wanting to make a violation reject the file or block
  loading. It must not — a real export with an unusual row has to keep working.
- You conclude `problems` needs to be persisted in IndexedDB or needs a
  `PARSER_VERSION` bump. Recomputing at load is deliberate; if you believe it is
  wrong, report why rather than changing the storage schema.
- Turning the checks on makes the app report violations against an export you
  have available. That is a genuine and interesting finding — report the count
  and the *category* of message, and do **not** paste account identifiers or
  balances into your report.

## Maintenance notes

For whoever owns this next:

- **This closes a documented gap, so update the doc.** After this lands,
  `docs/wealthsimple-csv-format.md` §9's claim that "the same checks run
  automatically the moment you load it" becomes true for the first time. Nothing
  in the doc needs rewording, but a reviewer should confirm the claim now holds.
- **Expect first-run noise.** Turning a dormant check on tends to surface
  something. The threshold constants (`CENT`, `CASH_RESIDUAL_LIMIT`,
  `SHARE_DUST`) were tuned against one real export; a different portfolio may
  trip them legitimately. If that happens, the fix is to tune the threshold with
  evidence, not to re-hide the check.
- **The privacy shape matters.** These messages name accounts and balances. They
  are fine on screen in a local-first app; they are not fine in a console, a log
  file, an error-reporting service, or a bug report. Anyone adding telemetry
  later must exclude them.
- **What a reviewer should scrutinise**: that `validateDataset`'s body is
  untouched, that no violation can block a file from loading, that the merge page
  caps its list, and that nothing writes these strings to `console`.
