# Plan 016: Clear the small stuff — a misplaced dependency, dead bindings, a bad edge case

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat d1d2640..HEAD -- package.json pnpm-lock.yaml src/lib/google-sheet.ts src/lib/projection.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

Three unrelated small defects, batched because each is a few lines and none
justifies its own review cycle. **Each gets its own commit** so they stay
independently revertible.

1. **`shadcn` is a CLI declared as a runtime dependency.** It is imported
   nowhere. Every `pnpm install --prod`, container image and pruned deploy pulls
   the scaffolding CLI and its 36-package transitive tree for nothing, and the
   manifest misrepresents what the app actually needs at runtime.
2. **Five dead bindings in `google-sheet.ts`.** They are the repo's *only* lint
   warnings. Clearing them means `pnpm check` is clean, which is what lets a
   future CI tighten warnings to errors — right now that step is blocked by five
   variables nobody uses.
3. **`depletionYear` can report "year 0".** A user whose export contains only
   cash-style accounts is told, in destructive red, that their balance "runs out
   in year 0" — with the phrase "At this withdrawal rate" even when the
   withdrawal rate is zero.

## Current state

### Defect 1 — `shadcn` in `dependencies`

Verified excerpt, `package.json:15-34`:

```json
	"dependencies": {
		"@base-ui/react": "^1.6.0",
		"class-variance-authority": "^0.7.1",
		"clsx": "^2.1.1",
		"html2canvas-pro": "^2.3.3",
		"jspdf": "^4.2.1",
		"lucide-react": "^1.28.0",
		"next": "16.3.0",
		"next-themes": "^0.4.6",
		"papaparse": "^5.5.4",
		"react": "19.2.8",
		"react-dom": "19.2.8",
		"recharts": "3.8.0",
		"shadcn": "^4.16.1",
		"sonner": "^2.0.7",
		"tailwind-merge": "^3.6.0",
		"tw-animate-css": "^1.4.0",
		"yahoo-finance2": "^4.0.2",
		"zustand": "^5.0.14"
	},
```

Verified: `grep -rn "from ['\"]shadcn" src/` returns **nothing**. The only other
reference in the repo is `components.json`, which is the CLI's own config file —
consumed by the CLI when you run it, not by the app at runtime.

### Defect 2 — the five dead bindings

Verified — these are exactly the five lines `pnpm check` reports, all in
`src/lib/google-sheet.ts`:

```
614:	const unrealisedTotal = holdingsCell(HC.unrealised, holdings.totalRow);
707:	const dividendsRow = sheet.push([
715:	const interestRow = sheet.push([
721:	const taxRow = sheet.push([
727:	const feesRow = sheet.push([
```

All five are inside `buildSummarySheet`. Note the shape difference: `:614` is a
plain unused local, while `:707`–`:727` capture the return value of
`sheet.push(...)` — a row number that was presumably going to be referenced by a
later formula and never was.

**`sheet.push(...)` has a side effect** — it appends a row and returns its
number. So for those four, only the **binding** is dead, not the call. Deleting
the whole statement would remove rows from the exported spreadsheet. Delete the
`const <name> = ` prefix and keep the call.

Biome offers an "unsafe fix" that renames these to `_taxRow` etc. **Do not take
it.** Prefixing with an underscore silences the warning while keeping the dead
binding; deleting it is the actual fix.

### Defect 3 — `depletionYear` counts year 0

Verified excerpt, `src/lib/projection.ts:335-343`:

```ts
/**
 * The first year the projection's total balance reaches zero, or null if it
 * never does. Only meaningful with a withdrawal rate set — without one the
 * balance can only fall if the return is negative.
 */
export function depletionYear(points: ProjectionPoint[]): number | null {
	const hit = points.find((point) => point.total <= 0);
	return hit ? hit.year : null;
}
```

`points.find(...)` scans from index 0, and the year-0 point's `total` is simply
the sum of the starting balances. If those sum to zero — which happens when
`startingBalances` yields `{}` — the function returns `0`.

The docstring already states the precondition ("Only meaningful with a
withdrawal rate set") and nothing enforces it.

Two further facts to confirm while working, rather than assume:

- `startingBalances` in `src/lib/analytics.ts` skips cash-style account types,
  so an export containing only chequing/save accounts produces `{}`. **Read it
  and confirm** before writing the test.
- `src/components/analytics/analytics-overview.tsx` renders the depletion
  message when `depleted !== null`, in destructive styling, phrased "At this
  withdrawal rate…". **Read the actual call site and quote it in your report** —
  the exact line number moves as that file changes.

### Repo conventions

- **Tabs** for indentation; Biome auto-sorts imports and Tailwind classes.
- Comments are prose explaining *why*.
- Tests colocated as `src/lib/*.test.ts`; `src/lib/projection.test.ts` already
  exists. No mocks anywhere in the suite.
- Commit style: imperative, sentence case, no conventional-commit prefix.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0, lockfile updated |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, 227 baseline + new |
| Lint | `pnpm check` | **exit 0 with 0 warnings** after Step 3 |
| Build | `pnpm build` | exit 0 |

## Scope

**In scope**:
- `package.json` — move one dependency
- `pnpm-lock.yaml` — regenerated by `pnpm install`, not hand-edited
- `src/lib/google-sheet.ts` — the five dead bindings only
- `src/lib/projection.ts` — `depletionYear` only
- `src/lib/projection.test.ts`

**Out of scope** (do NOT touch):
- Any other dependency in `package.json`. No version bumps, no reordering, no
  removals. In particular **do not** attempt the `nanoid` advisory — it is
  build-time only, unreachable with untrusted input, and recorded as
  not-worth-doing in `plans/README.md`.
- Anything else in `src/lib/google-sheet.ts`. It is 1366 lines and the audit
  explicitly concluded it should **not** be decomposed. Touch the five lines
  and nothing else.
- `biome.jsonc`. Do not promote warnings to errors here — that belongs with CI
  (`plans/001`), and doing it in the same change makes this diff unreviewable.
- `src/lib/analytics.ts` (`startingBalances`) — read it, do not change it.
- `src/components/analytics/analytics-overview.tsx`. The UI gate on
  `withdrawalRate > 0` is tempting and is **deliberately deferred** — see
  Maintenance notes.
- The projection arithmetic itself.

## Git workflow

- Branch: `advisor/016-small-cleanups`
- **Three commits**, one per defect, so each is independently revertible.
  Messages in repo style (imperative, sentence-case, no conventional-commit
  prefix):
  - `Move the shadcn CLI out of the runtime dependencies`
  - `Drop the row numbers the summary sheet never uses`
  - `Stop telling an empty projection it ran out in year zero`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Record the baseline

**Verify**: `pnpm typecheck && pnpm test` → exit 0, `Tests 227 passed (227)`.

**Verify**: `pnpm check` → exit 0, **5 warnings**, all in
`src/lib/google-sheet.ts`. Note the count; Step 3 takes it to 0.

If either differs, the tree has drifted — STOP.

### Step 2: Move `shadcn` to `devDependencies`

First re-confirm it is unused:

```bash
grep -rn "from ['\"]shadcn" src/
```
**Expect**: no matches. **If there are matches, STOP** — the premise is wrong.

Move the `"shadcn": "^4.16.1"` line from `dependencies` to `devDependencies` in
`package.json`, keeping both blocks alphabetically ordered as they already are.
Change nothing else in the file.

Then run `pnpm install` to update the lockfile's importer block. **Do not
hand-edit `pnpm-lock.yaml`.**

**Verify**: `pnpm install` → exit 0.

**Verify**: `git diff package.json` → exactly one line moved: one deletion from
`dependencies`, one insertion into `devDependencies`. No version change.

**Verify**: `pnpm build` → exit 0. This is the real check that nothing imported
it at runtime.

**Verify**: `pnpm typecheck && pnpm test` → exit 0.

Commit.

### Step 3: Delete the five dead bindings

In `src/lib/google-sheet.ts`:

- `:614` — `const unrealisedTotal = holdingsCell(...)`. Nothing else uses it, so
  delete the whole statement. **Confirm first**:
  `grep -n "unrealisedTotal" src/lib/google-sheet.ts` should show exactly one
  line. If it shows more, it is used and the warning is stale — STOP.
- `:707`, `:715`, `:721`, `:727` — these capture `sheet.push(...)`, which
  **appends a row**. Delete only the `const <name> = ` prefix, keeping the call
  and its arguments intact.

Before deleting each of the four, confirm the binding is genuinely unreferenced:

```bash
grep -n "dividendsRow\|interestRow\|taxRow\|feesRow" src/lib/google-sheet.ts
```
**Expect**: exactly four lines, the declarations themselves. Any additional hit
means the binding is used and Biome is wrong — STOP and report.

Do **not** rename them with a leading underscore.

**Verify**: `pnpm check` → **exit 0 with 0 warnings**. This is the step's whole
point.

**Verify**: `pnpm test` → exit 0. `src/lib/google-sheet.test.ts` exercises the
workbook builder, so if a row went missing it should show here.

**Verify**: `pnpm typecheck && pnpm build` → exit 0.

Commit.

### Step 4: Guard `depletionYear`

Read `startingBalances` in `src/lib/analytics.ts` and confirm it can return `{}`
for a cash-only dataset. Record what you found in your report.

Then change `depletionYear` in `src/lib/projection.ts` so a year-0 point cannot
be reported as a depletion: search from year 1 onward, or return `null` when the
year-0 total is already at or below zero.

Update the docstring to say what is now enforced rather than merely advised.
Keep the existing explanation of why depletion is only meaningful with a
withdrawal rate — it is still true and still useful.

**Verify**: `pnpm test projection` → the new cases pass and every pre-existing
case in `src/lib/projection.test.ts` still passes.

Commit.

### Step 5: Full verification

**Verify**: `pnpm typecheck && pnpm test && pnpm check && pnpm build` → all exit
0, and `pnpm check` reports **0 warnings**.

**Verify**: `git status --short` lists only the five in-scope files.

**Verify**: `git log --oneline -3` shows three separate commits.

## Test plan

New cases in `src/lib/projection.test.ts`, modelled on the existing fixtures in
that file (which pin `startDate` with `Date.UTC` so labels are assertable):

| # | Case | Expected |
|---|---|---|
| 1 | Empty starting balances (`{}`), no withdrawal rate | `depletionYear(...)` returns `null`. **Red before the fix.** |
| 2 | All starting balances zero, no withdrawal rate | `null` |
| 3 | A real balance with a withdrawal rate that genuinely exhausts it | Returns the correct year > 0 — the characterization guard that the fix did not break the feature |
| 4 | A real balance, no withdrawal, positive return | `null` |

Case 1 must be **observed failing** before Step 4's change. If it passes, the
fixture does not reproduce the bug — rework it.

No new tests for Steps 2 and 3: `pnpm build` proves the dependency move, and
`pnpm check` going from 5 warnings to 0 plus the existing
`src/lib/google-sheet.test.ts` proves the binding deletions.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; all 227 pre-existing tests pass, plus at least 4 new
      projection cases
- [ ] **`pnpm check` exits 0 with 0 warnings**
- [ ] `pnpm build` exits 0
- [ ] `grep -n '"shadcn"' package.json` shows it under `devDependencies`
- [ ] `grep -rn "from ['\"]shadcn" src/` returns no matches
- [ ] `grep -c "dividendsRow\|interestRow\|taxRow\|feesRow\|unrealisedTotal" src/lib/google-sheet.ts`
      returns 0
- [ ] `grep -c "_taxRow\|_feesRow\|_dividendsRow\|_interestRow\|_unrealisedTotal" src/lib/google-sheet.ts`
      returns 0 — deleted, not underscore-renamed
- [ ] `git diff d1d2640..HEAD -- biome.jsonc` shows **no changes**
- [ ] `git log --oneline -3` shows three separate commits
- [ ] `git status --short` lists only the five in-scope files
- [ ] `plans/README.md` status row for 016 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `grep -rn "from ['\"]shadcn" src/` finds a match. The dependency is used and
  Step 2's premise is wrong.
- Any of the five bindings turns out to be referenced elsewhere in
  `google-sheet.ts`. Biome would be wrong, which is worth reporting on its own.
- `src/lib/google-sheet.test.ts` fails after Step 3. A row went missing —
  you deleted a `sheet.push` call rather than just its binding.
- Case 1 of the test plan passes before Step 4's fix.
- `pnpm check` does not reach 0 warnings after Step 3. Report what remains.
- `pnpm build` fails after Step 2 — something did import `shadcn` at runtime.
- You find yourself editing `biome.jsonc`, or any part of
  `src/lib/google-sheet.ts` beyond the five lines.

## Maintenance notes

For whoever owns this next:

- **Step 3 unblocks a future CI tightening.** With `pnpm check` at 0 warnings,
  `plans/001`'s workflow could later be tightened to fail on warnings. That is
  deliberately not done here — it belongs with the CI change, not this one.
- **The four `sheet.push` bindings were probably intentional once.** They capture
  row numbers, which is how this module cross-references cells in formulas
  (see `holdingsCell` and the `totalRow` pattern nearby). If someone later adds
  a formula referencing the dividends or fees row, they will re-introduce the
  binding — that is fine and correct.
- **Deferred deliberately**: gating the depletion message in
  `analytics-overview.tsx` on `withdrawalRate > 0`. The docstring says depletion
  is "only meaningful with a withdrawal rate set", and the UI currently shows
  "At this withdrawal rate…" even at zero. Fixing the library function removes
  the absurd case; the UI phrasing is a copy decision worth making deliberately
  rather than folding into a cleanup sweep.
- **What a reviewer should scrutinise**: that only the `const … = ` prefixes were
  removed and no `sheet.push` call disappeared; that no binding was
  underscore-renamed; that `package.json` shows exactly one moved line with no
  version change; and that `biome.jsonc` is untouched.
