# Plan 009: Derive calendar dates from the local clock, not UTC

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat d1d2640..HEAD -- src/lib/price-snapshot.ts src/lib/live-prices.ts src/lib/clipboard.ts src/components/dashboard-filters.tsx src/components/investment/export-sheet-dialog.tsx vitest.config.mts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none. Soft ordering: land `plans/001-ci-workflow.md` first if
  both are queued — Step 2's `TZ` pin is what lets CI catch this bug class at
  all, and a UTC CI box without it gives false confidence on exactly these bugs.
- **Category**: bug
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

Five places in this app turn a `Date` into a `YYYY-MM-DD` calendar date using
`toISOString()`, which is **UTC**. For this app's audience — Canadian, so
UTC−4 to UTC−8 — anything computed after roughly 20:00 local lands on
**tomorrow's date**.

The failures are silent. Nothing throws, nothing looks broken; a banner fires a
day early, an exported spreadsheet is stamped with tomorrow, a chart grows a
phantom point, and a date filter reaches back three days too far.

The codebase already knows the rule and states it twice —
`src/lib/clipboard.ts:57-61` documents this exact hazard and avoids it, and
`src/lib/wealthsimple.ts:39-45` refuses to parse dates for the same reason. This
plan makes that rule the only way to do it.

## Current state

### The five bugs

| # | Site | Effect |
|---|---|---|
| 1 | `src/lib/price-snapshot.ts:69` | `asOf` default reads tomorrow in the evening |
| 2 | `src/lib/live-prices.ts:125` | same |
| 3 | `src/lib/price-snapshot.ts:239-243` | **highest impact** — age over-counted by a day |
| 4 | `src/components/investment/export-sheet-dialog.tsx:98` | `generatedOn` in the exported sheet |
| 5 | `src/components/dashboard-filters.tsx:34-40` | `setMonth` overflow + a UTC/local skew |

**Bug 1** — verified excerpt, `src/lib/price-snapshot.ts:66-70`:

```ts
export function parsePriceCsv(
	rawText: string,
	fileName: string,
	asOf = new Date().toISOString().slice(0, 10),
): PriceSnapshot {
```

**Bug 2** — verified excerpt, `src/lib/live-prices.ts:123-126`:

```ts
export function snapshotFromLivePrices(
	response: LivePriceResponse,
	asOf = new Date().toISOString().slice(0, 10),
): PriceSnapshot {
```

**Bug 3** — verified excerpt, `src/lib/price-snapshot.ts:234-243`:

```ts
/** Days between the snapshot and today. Negative is treated as today. */
export function snapshotAgeDays(
	snapshot: PriceSnapshot,
	now = new Date(),
): number {
	const then = new Date(`${snapshot.asOf}T00:00:00`).getTime();
	const today = new Date(
		`${now.toISOString().slice(0, 10)}T00:00:00`,
	).getTime();
	return Math.max(0, Math.round((today - then) / 86_400_000));
}
```

This is the highest-impact one: it feeds `STALE_AFTER_DAYS` (`:247`) and drives
the stale-price banner in four components — `live-prices-card.tsx:42`,
`import-prices-dialog.tsx:62`, `analytics-overview.tsx:206`,
`holdings-summary.tsx:102`.

**Bug 4** — `src/components/investment/export-sheet-dialog.tsx:98` sets
`generatedOn: new Date().toISOString().slice(0, 10)`, which is written into the
exported sheet at `google-sheet.ts:439` and `:620`. Note the irony: the same
dialog already uses the local-correct `todayStamp()` for the **filename** at
`:82`, `:116` and `:308`. The file name and the file's contents disagree.

**Bug 5** — verified excerpt, `src/components/dashboard-filters.tsx:27-40`:

```ts
export function resolveDateFrom(
	preset: DatePreset,
	datasetEnd: string,
): string | null {
	if (preset === ALL || !datasetEnd) return null;
	if (preset === "ytd") return `${datasetEnd.slice(0, 4)}-01-01`;

	const end = new Date(`${datasetEnd}T00:00:00`);
	if (preset === "30d") end.setDate(end.getDate() - 30);
	else if (preset === "3m") end.setMonth(end.getMonth() - 3);
	else if (preset === "6m") end.setMonth(end.getMonth() - 6);
	else if (preset === "12m") end.setMonth(end.getMonth() - 12);

	return end.toISOString().slice(0, 10);
}
```

Two faults: `setMonth` overflows from a month-end date (from `2026-05-31`,
"Last 3 months" gives `2026-03-03`, not late February), and the local-midnight
parse is read back as UTC. **The `ytd` preset is NOT affected** — it returns
early on line 32 via pure string arithmetic. Do not change that line.

### The reference implementation to copy

Verified excerpt, `src/lib/clipboard.ts:55-70`:

```ts
/**
 * Today as `MM-DD-YY`, the default name for an export.
 *
 * Built from the local date rather than an ISO string: `toISOString` is UTC, so
 * anyone west of Greenwich exporting in the evening would get tomorrow's date
 * on their file.
 */
export function todayStamp(now = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return [
		pad(now.getMonth() + 1),
		pad(now.getDate()),
		String(now.getFullYear()).slice(-2),
	].join("-");
}
```

Its test is the model for yours — verified excerpt,
`src/lib/clipboard.test.ts:10-16`:

```ts
	it("reads the local date, not the UTC one", () => {
		// `toISOString().slice(0, 10)` on this moment gives 2026-08-08 anywhere
		// west of Greenwich, which would put tomorrow's date on tonight's export.
		const evening = new Date(2026, 7, 7, 22, 30);
		expect(todayStamp(evening)).toBe("08-07-26");
	});
```

The `Date` is built from **local components**, which is what makes it
timezone-robust.

### The tests that currently hide bug 3

Verified excerpt, `src/lib/price-snapshot.test.ts:254-275`:

```ts
describe("snapshotAgeDays", () => {
	const snapshot = {
		asOf: "2026-08-01",
		fileName: "Holdings.csv",
		pricesCad: {},
		matched: [],
		unpriced: [],
	};

	it("counts whole days since the prices were read", () => {
		expect(snapshotAgeDays(snapshot, new Date("2026-08-09T12:00:00Z"))).toBe(8);
	});

	it("is zero on the day it was taken", () => {
		expect(snapshotAgeDays(snapshot, new Date("2026-08-01T23:00:00Z"))).toBe(0);
	});

	it("never goes negative on a clock that disagrees", () => {
		expect(snapshotAgeDays(snapshot, new Date("2026-07-20T00:00:00Z"))).toBe(0);
	});
});
```

**These assertions agree with the bug.** `new Date("2026-08-09T12:00:00Z")` is a
fixed *instant*, and `toISOString()` of a fixed instant is identical in every
timezone — so they pass everywhere, against broken code. Step 3 rewrites them.

### The test config has no timezone pin

Verified excerpt, `vitest.config.mts`:

```ts
export default defineConfig({
	test: {
		// Every module under test is pure functions over plain objects — no DOM.
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
```

No `env`, no `setupFiles`, no fake timers anywhere in the repo. So this entire
bug class is invisible on a UTC runner.

### The precedent for `Date.UTC` arithmetic

Verified excerpt, `src/lib/price-history.ts:178-183`:

```ts
/** `2024-02` -> `2024-02-29`. */
function endOfMonth(month: string): string {
	const [year, index] = month.split("-").map(Number);
	const day = new Date(Date.UTC(year, index, 0)).getUTCDate();
	return `${month}-${String(day).padStart(2, "0")}`;
}
```

This matters: using `Date.UTC` **inside** the new arithmetic helpers is not a
contradiction of this plan. The bug is reading a **clock** in UTC. A bare
`YYYY-MM-DD` string has no timezone at all, so UTC arithmetic on it is exact and
DST-free.

### Repo conventions

- **Tabs** for indentation. Biome enforces this and auto-sorts imports.
- Comments are prose explaining *why*. Match `src/lib/market-month.ts:1-23` for
  the "why" header on a new single-concern module.
- `@/` path alias for cross-module imports.
- Tests colocated as `src/lib/*.test.ts`, `import { describe, expect, it } from "vitest";`.
- **No mocks and no fake timers anywhere** — `grep "vi.mock\|vi.fn\|vi.spyOn\|useFakeTimers"`
  across all 13 test files returns zero hits. Do not introduce one; the
  injectable `now` parameter is the seam.
- Small single-concern pure modules are the house style: `market-month.ts`,
  `yahoo-ticker.ts`, `xlsx.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, 227 baseline + new |
| One file | `pnpm test calendar-date` | all pass |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings) |
| Build | `pnpm build` | exit 0 |

## Scope

**In scope**:
- `src/lib/calendar-date.ts` (create)
- `src/lib/calendar-date.test.ts` (create)
- `src/lib/date-range.ts` (create)
- `src/lib/date-range.test.ts` (create)
- `src/lib/price-snapshot.ts`
- `src/lib/price-snapshot.test.ts`
- `src/lib/live-prices.ts`
- `src/lib/live-prices.test.ts`
- `src/lib/clipboard.ts` (Step 7 only, optional)
- `src/components/investment/export-sheet-dialog.tsx`
- `src/components/dashboard-filters.tsx`
- `src/components/dashboard.tsx` (import swap only)
- `src/components/charts/capital-chart.tsx` (import swap only)
- `vitest.config.mts`

**Out of scope** — these look related and are all **correct**:
- `src/lib/market-month.ts`. It reads an instant in a **named exchange
  timezone**, not the user's local zone. Its 22-line header exists because this
  exact class of month-shift already shipped once. Folding it in would
  reintroduce that bug.
- `formatDate` (`src/lib/metrics.ts:782`) and `monthLabel`
  (`src/lib/metrics.ts:596`). Both use a `T00:00:00` local-midnight parse
  correctly, and `formatDate` has 17+ call sites.
- `endOfMonth` (`price-history.ts:178`), `monthsBetween` (`price-history.ts:158`),
  `coveredMonths` (`analytics.ts:99`), `toTransactionDate` (`wealthsimple.ts:46`).
- `src/lib/projection.ts:161` (`anniversary`). Its output is consumed only as an
  axis label by `projection-chart.tsx` — never as a map key — so an evening
  off-by-one is cosmetic. Fixing it would churn `projection.test.ts:39,280` for
  no correctness gain.
- `fetchedAt` in `src/app/api/prices/route.ts:116` and
  `src/app/api/prices/history/route.ts:117`. Full ISO **instants**, correctly
  UTC. An instant is not a calendar date.
- `STALE_AFTER_DAYS` (`price-snapshot.ts:247`). The threshold was never the bug.
- Widening `vitest.config.mts`'s `include` glob to `.tsx`. Moving
  `resolveDateFrom` to a `.ts` module is the fix; the glob stays as it is.

## Git workflow

- Branch: `advisor/009-local-calendar-dates`
- Commit per logical unit. Messages in repo style (imperative, sentence-case, no
  conventional-commit prefix — cf. `16e197a "Read a bar's month in the timezone
  it was stamped in"`):
  - `Read today's date off the local clock, not off UTC`
  - `Step back whole months without overflowing a month end`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 0: Record the baseline

**Verify**: `pnpm typecheck && pnpm test && pnpm check` → exit 0, with
`Test Files 13 passed (13)` and `Tests 227 passed (227)`, and `pnpm check`
printing exactly 5 warnings, all in `src/lib/google-sheet.ts`.

If the counts differ, the tree has drifted from this plan — STOP.

### Step 1: Add `src/lib/calendar-date.ts`

Create the module with this exact surface:

```ts
export function toLocalIso(date: Date): string
export function todayLocalIso(now = new Date()): string
export function addDays(iso: string, days: number): string
export function addMonths(iso: string, months: number): string
export function daysBetween(from: string, to: string): number
```

Implementation notes:

- `toLocalIso` — `getFullYear()`, `getMonth() + 1`, `getDate()`, zero-padded.
  Exactly the technique proven at `clipboard.ts:63-70`. **No default argument**
  — a bare `toLocalIso()` reads badly at a call site.
- `todayLocalIso(now = new Date())` — `return toLocalIso(now)`. The injectable
  `now` is what makes every consumer testable without fake timers.
- `addDays(iso, days)` — parse `y/m/d` off the string by index, then
  `new Date(Date.UTC(y, m - 1, d + days))` read back with `getUTC*`. `Date.UTC`
  normalizes overflow correctly and for free.
- `addMonths(iso, months)` — **this is what kills bug 5**. Do the month wrap in
  integer arithmetic on `y * 12 + (m - 1) + months`, then **clamp** the day to
  `min(d, daysInMonth(targetYear, targetMonth))`. Do not hand an out-of-range
  month to `Date` and let it normalize — that is precisely the current bug.
  Keep `daysInMonth` **private**.
- `daysBetween(from, to)` — difference in whole days between two `YYYY-MM-DD`
  strings, via `Date.UTC` on both endpoints so the result is an exact multiple
  of 86 400 000 with no rounding needed.
- **Do not validate or throw.** These run inside `useMemo` in a render path
  (`capital-chart.tsx:150`), where a throw takes the page down. The only public
  entry point that can receive garbage is `resolveDateFrom`, which already
  guards. Document the precondition in the header instead.

Write a module header in the style of `src/lib/market-month.ts:1-23` covering:
(a) `toISOString()` is UTC and this app's readers are in Canada, so an evening
derivation lands on tomorrow; (b) the failure is silent; (c) `Date.UTC` inside
`addDays`/`addMonths` is arithmetic on a timezone-free calendar date, not a
clock read — a reader will flinch at it, so say why; (d) `market-month.ts`
solves a different problem and must not be folded in.

Also create `src/lib/calendar-date.test.ts` with the cases listed in the Test
plan below.

**Verify**: `pnpm test calendar-date` → all new tests pass.

**Verify**: `pnpm typecheck` → exit 0. Nothing imports the module yet, so the
rest of the suite cannot have moved: `pnpm test` still shows 227 + your new
count.

### Step 2: Pin the timezone, and prove the pin is live

Add to `vitest.config.mts`, inside `test`:

```ts
		// Pinned so the local-vs-UTC date bugs this suite guards against are
		// reproducible on any machine. A UTC runner is exactly the blind spot
		// that let them ship: `toISOString().slice(0, 10)` is only wrong when
		// local and UTC disagree. Toronto is the app's audience, is west of
		// Greenwich, and observes DST, which the date-arithmetic tests rely on.
		env: { TZ: "America/Toronto" },
```

**Verify**: `pnpm test` → still 227 baseline tests passing plus yours. The pin
should move nothing yet. (Checked during planning: `market-month.test.ts` passes
explicit named zones, `clipboard.test.ts` builds from local components, and
`projection.test.ts` is `Date.UTC` in and `getUTC*` out — all timezone-independent.)

**Node caches timezone state, so confirm the pin actually takes effect** — this
is verified for real in Step 3, where a test must go red. If Step 3's assertions
pass instead of failing, the pin is not live: fall back to
`"test": "TZ=America/Toronto vitest run"` in `package.json` and re-run Step 3.

### Step 3: Fix bug 3, test-first — **you must observe a failure**

First rewrite the three masking assertions in
`src/lib/price-snapshot.test.ts:263-274` to build their `Date` from **local
components**, adding a comment above the block in the style of
`clipboard.test.ts:11-12` explaining that a fixed UTC instant reads the same in
every timezone and therefore agrees with the bug:

| Line | Replace `now` with | Expected |
|---|---|---|
| 264 | `new Date(2026, 7, 9, 21, 0)` | `8` |
| 268 | `new Date(2026, 7, 1, 23, 0)` | `0` |
| 272 | `new Date(2026, 6, 20, 12, 0)` | `0` |

**Now run `pnpm test` and confirm the first two FAIL** (they return `9` and `1`
against today's code, because 21:00 and 23:00 EDT are already tomorrow in UTC).

**If they pass, STOP** — either the TZ pin is not live (see Step 2) or the
rewrite did not land. Do not proceed to the fix until you have seen red.

The third case cannot fail — `Math.max(0, …)` clamps it either way. Convert it
for consistency but do not claim it exposes anything.

Then fix `src/lib/price-snapshot.ts:239-243` to use the new helpers:

```ts
	return Math.max(0, daysBetween(snapshot.asOf, todayLocalIso(now)));
```

**Verify**: `pnpm test` → green, all three cases passing.

Add one more case pinning `daysBetween` across a DST boundary through its real
consumer: `asOf: "2026-10-30"` with `now = new Date(2026, 10, 3, 12, 0)` → `4`.

### Step 4: Fix bugs 1 and 2 (the `asOf` defaults)

- `src/lib/price-snapshot.ts:69` → `asOf = todayLocalIso(),`
- `src/lib/live-prices.ts:125` → `asOf = todayLocalIso(),`

Add the import to each. Every existing test in both files passes an explicit
`asOf`, so nothing else moves.

Add one wiring assertion per file: `parsePriceCsv(csv, "Holdings.csv").asOf`
equals `todayLocalIso()`, and `snapshotFromLivePrices(response()).asOf` equals
`todayLocalIso()`.

Be aware of what these assertions are: tautological about the *value* (both
sides call the same function) but not about the *wiring* — they go red if
someone reintroduces `toISOString().slice(0, 10)` **and** the suite runs in a
timezone where the two differ. The TZ pin from Step 2 supplies that second
condition. Without it they are worthless.

**Verify**: `pnpm test` → exit 0.

### Step 5: Fix bug 4 (`generatedOn`)

`src/components/investment/export-sheet-dialog.tsx:98` → `todayLocalIso()`. Add
the import alongside the existing `todayStamp` import.

Safe to change: both `google-sheet.ts` consumers (`:439`, `:620`) receive the
value as text, and every test passes `generatedOn` explicitly
(`google-sheet.test.ts:109,469`, `price-snapshot.test.ts:84`).

**Verify**: `pnpm typecheck && pnpm test` → exit 0.

### Step 6: Fix bug 5, test-first

**6a — move without changing.** Create `src/lib/date-range.ts` containing
`DATE_PRESETS`, `DatePreset` and `resolveDateFrom`, moved **verbatim** from
`src/components/dashboard-filters.tsx:14-40` (still broken). Update three
importers:

- `src/components/dashboard.tsx` — drop `type DatePreset` and `resolveDateFrom`
  from the `@/components/dashboard-filters` import (keep `DashboardFilters`);
  add `import { type DatePreset, resolveDateFrom } from "@/lib/date-range";`
- `src/components/charts/capital-chart.tsx` — same swap
- `src/components/dashboard-filters.tsx` — delete lines 14-40, add
  `import { DATE_PRESETS, type DatePreset } from "@/lib/date-range";`

Move `DATE_PRESETS` and `DatePreset` **with** the function: `resolveDateFrom`
takes a `DatePreset`, and leaving the type in the component would make
`src/lib/` import from `src/components/` — backwards, and the repo has zero such
imports today. **No re-export shim** — both importers are in-repo and updated in
the same commit; typecheck catches a miss.

**Verify**: `pnpm typecheck` → exit 0. Behaviour is unchanged so far.

**6b — pin it, and watch it fail.** Create `src/lib/date-range.test.ts` with the
cases in the Test plan. Run `pnpm test date-range`.

**The `3m`, `6m` and `12m` clamp cases must FAIL.** They fail in *every*
timezone, including a UTC box, because the `setMonth` overflow is not a timezone
bug. If they pass, STOP.

**6c — fix it.** Rewrite the body so no `Date` appears:

```ts
	if (preset === ALL || !datasetEnd) return null;
	if (preset === "ytd") return `${datasetEnd.slice(0, 4)}-01-01`;
	if (preset === "30d") return addDays(datasetEnd, -30);
	return addMonths(datasetEnd, preset === "3m" ? -3 : preset === "6m" ? -6 : -12);
```

Keep the signature `(preset: DatePreset, datasetEnd: string) => string | null`.
**Do not add a `now` parameter** — this function is deliberately anchored on the
dataset's last day, not on the clock, and a clock-anchored preset would silently
change yesterday's numbers overnight.

**Verify**: `pnpm test date-range` → all green.

### Step 7 (optional, zero behaviour change): re-express `todayStamp`

`src/lib/clipboard.ts:63-70` is now the only hand-rolled local-date triple left
outside the canonical module, and its comment names the hazard the module exists
for — a trap for the next reader.

Re-express it on `toLocalIso`, keeping it in `clipboard.ts` (it produces
`MM-DD-YY` for a **filename**, not a calendar date, and belongs with
`safeFileName`/`downloadBlob`):

```ts
	const [year, month, day] = toLocalIso(now).split("-");
	return [month, day, year.slice(2)].join("-");
```

`clipboard.ts` importing a pure module is fine — the prohibition runs the other
way, and `calendar-date.ts` imports nothing.

**Verify**: `pnpm test clipboard` → passes with `src/lib/clipboard.test.ts`
**completely unchanged**. That is the proof the refactor is behaviour-preserving.
If the test needs touching, the refactor is wrong — revert this step.

This step can be dropped entirely without affecting any of the five fixes.

### Step 8: Full verification

**Verify**: `pnpm typecheck && pnpm test && pnpm check && pnpm build` → all exit 0.

**Verify**: `pnpm check` still prints exactly 5 warnings, all in
`src/lib/google-sheet.ts`, and none in your new files.

**Verify**: `grep -rn 'toISOString().slice(0, 10)' src/` → matches only
`src/lib/market-month.ts` (which uses `slice(0, 7)`, so likely zero matches) and
`src/lib/projection.ts:161` (explicitly out of scope). **No match in
`price-snapshot.ts`, `live-prices.ts`, `export-sheet-dialog.tsx` or
`dashboard-filters.tsx`.**

## Test plan

### `src/lib/calendar-date.test.ts` (new)

`toLocalIso` — model on `clipboard.test.ts:10-15`, comment included:
- `new Date(2026, 7, 7, 22, 30)` → `"2026-08-07"` (the canonical evening case)
- `new Date(2026, 0, 1)` → `"2026-01-01"` (zero-padding)
- `new Date(2026, 11, 31, 23, 59)` → `"2026-12-31"` — a UTC slice gives
  `2027-01-01`; a year boundary is the worst version of this bug

`todayLocalIso` — equals `toLocalIso(now)` for an explicit `now`; matches
`/^\d{4}-\d{2}-\d{2}$/` with no argument.

`addDays`:
- `("2026-05-31", -30)` → `"2026-05-01"`
- `("2026-03-01", -1)` → `"2026-02-28"`; `("2024-03-01", -1)` → `"2024-02-29"`
- `("2026-12-31", 1)` → `"2027-01-01"`; `(iso, 0)` → `iso`
- `("2026-03-07", 1)` → `"2026-03-08"` and `("2026-11-01", -1)` → `"2026-10-31"`
  — DST spring-forward and fall-back in the pinned zone. These only have teeth
  because of the TZ pin, and are what a naive local `setDate` gets wrong.

`addMonths` — the clamp is the whole point:
- **`("2026-05-31", -3)` → `"2026-02-28"`** (today's code gives `2026-03-03`)
- `("2024-05-31", -3)` → `"2024-02-29"` (leap clamp)
- `("2026-05-31", -6)` → `"2025-11-30"` (31→30, year cross)
- `("2026-05-31", -12)` → `"2025-05-31"` (no clamp needed)
- `("2026-01-31", 1)` → `"2026-02-28"` (forward clamp)
- `("2026-03-15", -3)` → `"2025-12-15"` (year underflow)

`daysBetween`:
- `("2026-08-01", "2026-08-09")` → `8`; same day → `0`; reversed → `-8`
- `("2026-10-30", "2026-11-02")` → `3`, spanning the fall-back — proves the
  answer is exact rather than a value that happened to round

### `src/lib/date-range.test.ts` (new)

- `("all", "2026-05-31")` → `null`; `("3m", "")` → `null`
- `("ytd", "2026-05-31")` → `"2026-01-01"`; `("ytd", "2026-01-01")` →
  `"2026-01-01"` — characterization pins proving the move preserved the one
  preset that was already correct
- **`("3m", "2026-05-31")` → `"2026-02-28"`** — today gives `2026-03-03`.
  Red in every timezone. The flagship.
- **`("6m", "2026-08-31")` → `"2026-02-28"`** — today gives `2026-03-03`
- `("12m", "2024-02-29")` → `"2023-02-28"` — today gives `2023-03-01`
- `("30d", "2026-05-31")` → `"2026-05-01"`; `("30d", "2026-01-15")` →
  `"2025-12-16"`

Add a note in the file: the east-of-Greenwich half of bug 5 has no red test
under a west-of-Greenwich pin. It is eliminated **structurally** — the fixed
function constructs no `Date` at all — and its observable effect is subsumed by
the clamp cases. Say so, rather than leaving a reader wondering.

### Modified test files

- `src/lib/price-snapshot.test.ts` — three assertions rewritten (Step 3), one
  DST-age case added, one `asOf` wiring assertion added
- `src/lib/live-prices.test.ts` — one `asOf` wiring assertion added
- `src/lib/clipboard.test.ts` — **unchanged**, and that is a done criterion

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; all 227 pre-existing tests still pass, plus the new
      `calendar-date` and `date-range` suites
- [ ] `pnpm check` exits 0 with exactly 5 warnings, all in
      `src/lib/google-sheet.ts`
- [ ] `pnpm build` exits 0
- [ ] `grep -n "toISOString" src/lib/price-snapshot.ts src/lib/live-prices.ts src/components/dashboard-filters.tsx src/components/investment/export-sheet-dialog.tsx`
      returns **no matches**
- [ ] `grep -n "setMonth\|setDate" src/components/dashboard-filters.tsx` returns
      no matches
- [ ] `grep -n "env" vitest.config.mts` shows the `TZ` pin
- [ ] `git diff --stat d1d2640..HEAD -- src/lib/clipboard.test.ts` shows **no
      changes**
- [ ] `git diff --stat d1d2640..HEAD -- src/lib/market-month.ts src/lib/metrics.ts src/lib/projection.ts`
      shows **no changes**
- [ ] `git status --short` lists only files from the In-scope list
- [ ] `plans/README.md` status row for 009 updated

## STOP conditions

Stop and report back (do not improvise) if:

- **Step 3's rewritten assertions pass instead of failing.** The TZ pin is not
  live. Try the `package.json` fallback; if that also fails, report — proceeding
  would ship a fix whose tests could never have caught the bug.
- **Step 6b's clamp cases pass instead of failing.** They should fail in every
  timezone; passing means the move in 6a changed behaviour.
- Any of the 227 pre-existing tests fails at any point.
- `src/lib/clipboard.test.ts` needs modification to keep passing after Step 7.
  Revert Step 7 and report.
- Adding the TZ pin in Step 2 breaks a test other than the three being rewritten.
  Report which — it means a test is timezone-dependent in a way this plan did
  not anticipate.
- You conclude `market-month.ts` should be folded into the new module. It must
  not be.
- You find a sixth site with the same bug. Report it with `file:line` rather
  than folding it in silently.

## Maintenance notes

For whoever owns this next:

- **The rule this establishes**: there is exactly one place that turns a `Date`
  into a calendar date (`toLocalIso`), and once you have a `YYYY-MM-DD` string,
  all arithmetic stays in string space. A future `toISOString().slice(0, 10)`
  anywhere in `src/` is a bug.
- **`market-month.ts` is the deliberate exception** and must stay one. It reads
  an instant in a *named exchange* zone — a different question from "what day is
  it here".
- **Persisted snapshots need no migration.** A snapshot written yesterday
  evening carries an `asOf` one day in the future. `snapshotAgeDays` already
  clamps negatives to 0 (its doc comment at `price-snapshot.ts:234` says so),
  display shows tomorrow for at most one day, and the next fetch overwrites
  `asOf` wholesale. Self-correcting — no version bump, no schema change.
- **Two user-visible numbers change, both intended.** Evening users west of
  Greenwich will see the stale banner stop firing a day early (a boundary
  snapshot flips 8 → 7). And `resolveDateFrom("3m", …)` on a month-end dataset
  now reaches back to late February rather than March 3, so a few extra days of
  activity enter the filtered set and the dashboard KPIs move. Worth a line in
  the commit body.
- **`12m` on a leap day moves by two days**, not one: `("12m", "2024-02-29")`
  goes from `2023-03-01` to `2023-02-28`. Intended; don't be surprised in review.
- **What a reviewer should scrutinise**: that `clipboard.test.ts` is untouched;
  that `market-month.ts`, `formatDate` and `monthLabel` are untouched; that the
  `ytd` early return is byte-identical; and that the executor's report says they
  *saw the tests fail* in Steps 3 and 6b.
- **Deferred**: `projection.ts:161`. Label-only, and fixing it would churn
  `projection.test.ts` for no correctness gain.
- **Reconciliation**: `plans/012` also edits `src/lib/price-snapshot.ts` (the
  `toNumber` comma rule, a different function) and `plans/015` also edits
  `src/lib/live-prices.ts` (extracting a shared validator). Neither overlaps
  this plan's lines, but whichever lands second should re-read the other's
  version of the file before editing.
