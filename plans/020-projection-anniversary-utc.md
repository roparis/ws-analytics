# Plan 020: Date the projection from the local clock, and stop a recovered save reading as failed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat f502b82..HEAD -- src/lib/projection.ts src/lib/projection.test.ts src/stores/prices.ts src/components/analytics/analytics-overview.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. `plans/009` landed the helpers this uses.
- **Category**: bug
- **Planned at**: commit `f502b82`, 2026-08-17

Two unrelated defects, batched because neither justifies its own review cycle —
the same arrangement `plans/016` used. **Each gets its own commit.**

## Why this matters

### Defect 1 — the projection's dates are read in UTC

`plans/009` fixed five places that derived a `YYYY-MM-DD` from a `Date` in UTC.
It deliberately left one alone, and recorded the reason:

> "**Deferred**: `projection.ts:161`. Label-only, and fixing it would churn
> tests for no behavioural gain."

**That rationale is wrong.** The output is not label-only. It is sliced back
apart and shown to the reader as a calendar year — verified excerpt,
`src/components/analytics/analytics-overview.tsx:183-191`:

```tsx
	// Rooms that fill up inside the horizon, as calendar years rather than
	// "year 4" — the axis is labelled in calendar years and the reader shouldn't
	// have to count forward from today to place the moment.
	const limits = roomLimitYears(points);
	const roomYears: Record<string, string> = {};
	for (const [type, year] of Object.entries(limits)) {
		const point = points.find((candidate) => candidate.year === year);
		if (point) roomYears[type] = point.date.slice(0, 4);
	}
```

So `point.date`'s **year** becomes the "contribution room runs out in ⟨year⟩"
notice. A wrong date there is a wrong year in a financial projection, not a
cosmetic axis tick.

Reproduced with `TZ=America/Toronto`, against the current implementation:

| Local `startDate` | `date` for year 0 | Correct |
|---|---|---|
| `2026-08-16 14:00` | `2026-08-16` | ✅ |
| `2026-08-16 21:00` | `2026-08-17` | ❌ a day ahead |
| `2026-12-31 21:00` | **`2027-01-01`** | ❌ **a year ahead** |

The one-day shift happens every evening west of Greenwich — after 20:00 in
Toronto, 19:00 on the west coast in summer. The **year** shift happens on New
Year's Eve, which is precisely when someone reviewing the year is likely to have
this page open. Every horizon year moves with it, so "room runs out in 2027"
when the truth is 2026.

### Defect 2 — a recovered save still reads as failed

`usePriceStore.persistFailed` is set to `true` when a write fails and is
**never set back to `false` on a later success**. Only `clear()` and `reset()`
lower it. So a user who hits a full or blocked IndexedDB once, frees space, and
fetches again keeps being told their prices will vanish — while they are in fact
saved. In an app whose whole premise is that nothing leaves the device, a false
data-loss warning is worth removing.

## Current state

### Defect 1 — the function

Verified excerpt, `src/lib/projection.ts:147-162`:

```ts
/** The anniversary of `start`, `years` on. Clamps Feb 29 to Feb 28. */
function anniversary(start: Date, years: number): string {
	const date = new Date(
		Date.UTC(
			start.getUTCFullYear() + years,
			start.getUTCMonth(),
			start.getUTCDate(),
		),
	);
	// A Feb 29 start rolls into Mar 1 on a non-leap year; step back a day so the
	// axis label stays in the month the reader expects.
	if (date.getUTCMonth() !== start.getUTCMonth()) {
		date.setUTCDate(0);
	}
	return date.toISOString().slice(0, 10);
}
```

It reads **UTC** components off `start`, which is a local instant — the default
is `new Date()` at `src/lib/projection.ts:196`:

```ts
	const start = options.startDate ?? new Date();
```

Both call sites are in `projectSeries`: `:260` (`year: 0`) and `:315` (each
horizon year). `grep -rn "anniversary" src/` shows no consumer outside
`projection.ts`.

### The helpers that already solve this

`plans/009` added `src/lib/calendar-date.ts`. Two of its exports are all this
needs:

- `toLocalIso(date)` — the local calendar date of an instant, as `YYYY-MM-DD`.
- `addMonths(iso, months)` — shifts by whole months **with the day clamped** to
  the target month's length rather than overflowing.

The clamp is the same behaviour the hand-rolled Feb-29 branch implements.
Verified by running it:

| Input | `addMonths(iso, years * 12)` |
|---|---|
| `2024-02-29`, 1 year | `2025-02-28` |
| `2026-01-15`, 5 years | `2031-01-15` |
| `2026-12-31`, 1 year | `2027-12-31` |

The first row is exactly what the existing leap-day test asserts.

### The tests currently agree with the bug

This is the part to read twice. Verified excerpt,
`src/lib/projection.test.ts:38-40`:

```ts
/** Fixed so the date labels are assertable rather than whatever today is. */
const START = new Date(Date.UTC(2026, 0, 15));
const AT = { startDate: START };
```

and `src/lib/projection.test.ts:278-285`:

```ts
	it("clamps a leap-day start back into February", () => {
		const points = projectSeries({ TFSA: 1 }, makeInputs({ years: 1 }), {
			startDate: new Date(Date.UTC(2024, 1, 29)),
		});

		expect(points[1].date).toBe("2025-02-28");
	});
```

Both fixtures are built with **`Date.UTC`**, so the instant's UTC components are
the intended calendar date by construction and the buggy UTC read returns the
expected answer. This is the same masking pattern `plans/009` found at
`price-snapshot.test.ts:264` — a fixed UTC instant whose assertion holds in
every timezone, and therefore proves nothing about local behaviour.

**A naive "fix the fixture" makes it worse.** `new Date(2026, 0, 15)` is local
*midnight*, whose UTC date in Toronto is still `2026-01-15`; the buggy and
correct implementations agree, and the test stays green either way. Only a
fixture at a **local evening time** separates them:

| Fixture | Buggy result | Correct result |
|---|---|---|
| `new Date(Date.UTC(2026, 0, 15))` | `2026-01-15` | `2026-01-14` |
| `new Date(2026, 0, 15)` | `2026-01-15` | `2026-01-15` |
| `new Date(2026, 0, 15, 21, 0)` | `2026-01-16` | `2026-01-15` |
| `new Date(2026, 11, 31, 21, 0)` | `2027-01-01` | `2026-12-31` |
| `new Date(2024, 1, 29, 21, 0)`, +1y | **`2025-03-01`** | `2025-02-28` |

That last row is worth dwelling on, because it is sharper than "the label is a
day out". A leap-day evening start is already **March 1st in UTC**, so
`start.getUTCMonth()` is March before the function does anything. The guard
`date.getUTCMonth() !== start.getUTCMonth()` then compares March against March,
does not fire, and **the clamp never runs at all**. The hand-rolled Feb-29
branch does not merely land on the wrong day — on the exact input it was written
for, it silently does nothing.

`vitest.config.mts` pins `env: { TZ: "America/Toronto" }` (added by 009), so the
last two rows are deterministic in the suite and in CI.

### Defect 2 — the latch

Verified excerpt, `src/stores/prices.ts:78-88`:

```ts
		setSnapshot: (snapshot) => {
			set({ snapshot });
			// The write is best-effort, as it is in `dataset.ts` — the session keeps
			// working either way. But it is *reported*: swallowing the error would
			// leave someone believing their prices are saved when they will be gone
			// on reload, which is worse than losing them loudly.
			void savePriceSnapshot(snapshot).catch((error) => {
				console.warn("Could not save prices to local storage:", error);
				set({ persistFailed: true });
			});
		},
```

`setHistory` at `:90-96` has the identical shape. Neither lowers the flag on
success. The only consumer is
`src/components/investment/import-prices-dialog.tsx:206`, which renders an amber
"these prices couldn't be saved … they'll be gone when you reload" panel.

### Repo conventions

- **Tabs** for indentation, enforced by Biome (not ESLint/Prettier).
- Comments are prose explaining *why*. Match the voice of the excerpts above.
- Tests colocated as `src/lib/*.test.ts`, `environment: "node"`, **no mocks and
  no fake timers anywhere** — injectable parameters (`now`, `asOf`, `startDate`)
  are the seam instead.
- Components are deliberately untested; `src/stores/` has no test files.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, your measured baseline + new |
| One file | `pnpm test projection` | all pass |
| Lint | `pnpm check` | exit 0 |
| Build | `pnpm build` | exit 0 |

**Record your own baseline before Step 1** — the passing test count, the file
count, and the warning count. Do not take a number from this document; plans
keep landing and the suite keeps growing. At the time of writing it was
`Tests 318 passed (318)` across 17 files with **0** warnings (016 cleared the
five that used to be in `google-sheet.ts`). Treat that as context, not as an
assertion: stop only if something **fails**.

## Scope

**In scope**:
- `src/lib/projection.ts` — the `anniversary` function only
- `src/lib/projection.test.ts`
- `src/stores/prices.ts` — `setSnapshot` and `setHistory` only

**Out of scope** (do NOT touch):
- `src/lib/calendar-date.ts`. It is already correct and already tested; you are
  a caller.
- `src/lib/market-month.ts`. It reads an instant in a **named exchange
  timezone** and its header explains why; a month-shift bug already shipped
  there once. Leave it alone.
- `formatDate` / `monthLabel` in `src/lib/metrics.ts`, and `todayStamp` in
  `src/lib/clipboard.ts`. All correct.
- `src/components/analytics/analytics-overview.tsx`. It is quoted above as
  *evidence* that the date is user-visible. It needs no change — fixing
  `anniversary` fixes what it displays.
- Anything about *which* year `roomLimitYears` returns. That logic is correct;
  only the date attached to the point was wrong.
- The `clear()` / `reset()` handling of `persistFailed`. Already correct.
- Adding a test file for `src/stores/`. There are none, deliberately.

## Git workflow

- Branch: `advisor/020-projection-anniversary-utc`
- **Two commits**, one per defect, in repo style (imperative, sentence case, no
  conventional-commit prefix, no trailing period):
  - `Date the projection from the local clock rather than UTC`
  - `Clear the price-save warning when a later save succeeds`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Record the baseline

Run `pnpm typecheck && pnpm test && pnpm check` and write down what you observe.

**Verify**: all three exit 0.

### Step 2: Make the masking visible

Rewrite the two fixtures in `src/lib/projection.test.ts` from `Date.UTC`
instants to **local evening** instants, per the table in "Current state":

- `START` at `:39` → a local time late enough that the UTC date has already
  rolled over in `America/Toronto`. `new Date(2026, 0, 15, 21, 0)` works.
- the leap-day fixture at `:280` → `new Date(2024, 1, 29, 21, 0)`.

Update the existing expectations to the **correct** values — `2026-01-15` for
the start, `2025-02-28` still for the clamp — not to what the code currently
returns.

**Run `pnpm test projection` and confirm it FAILS.** Expect two distinct
failures, and report both verbatim:

- dates one day later than expected, from the `START` rewrite
- the leap-day case reporting **`2025-03-01`**, not `2025-02-28`

The second is the more interesting one and you should understand it before
moving on: on a leap-day *evening* start the instant is already March in UTC, so
the `getUTCMonth()` guard compares March against March, never fires, and the
clamp does not run. If you only see the one-day failures, your leap-day fixture
is not late enough in the day.

If everything passes, your fixtures are not late enough in the day to cross the
UTC boundary, or `TZ` is not taking effect — check
`node -e "console.log(process.env.TZ, new Date().getTimezoneOffset())"` under
`pnpm test` conditions and rework before continuing. **Do not proceed on tests
that could never have failed.**

### Step 3: Add the case that motivates the plan

Add a test pinning the New Year's Eve behaviour, since that is where the defect
costs a whole year rather than a day:

```ts
	it("dates the projection from the local calendar, not UTC", () => {
		// 21:00 in Toronto on New Year's Eve is already January 1st in UTC, so
		// reading the instant's UTC components moved every horizon year forward.
		const points = projectSeries({ TFSA: 1000 }, makeInputs({ years: 5 }), {
			startDate: new Date(2026, 11, 31, 21, 0),
		});

		expect(points[0].date).toBe("2026-12-31");
		expect(points[5].date).toBe("2031-12-31");
	});
```

**Verify**: this fails too, reporting `2027-01-01`.

### Step 4: Fix `anniversary`

Replace the body with the two helpers that already solve it:

```ts
/**
 * The anniversary of `start`, `years` on, as a local calendar date.
 *
 * `start` is an instant; the projection is dated by the day the reader is
 * having, so the calendar date comes from the local clock. Reading the UTC
 * components instead moved every date a day forward for anyone west of
 * Greenwich in the evening — and on New Year's Eve moved the *year*, which
 * `analytics-overview.tsx` shows as "room runs out in ⟨year⟩".
 *
 * `addMonths` clamps the day to the target month's length, which is where the
 * hand-rolled Feb 29 → Feb 28 step used to happen.
 */
function anniversary(start: Date, years: number): string {
	return addMonths(toLocalIso(start), years * 12);
}
```

Add the import; Biome sorts imports, so run `pnpm check:write` if it complains
about ordering rather than hand-placing it.

**Verify**: `pnpm test projection` → every case passes, including the two you
turned red and the leap-day clamp.

**Verify**: `grep -n "getUTC" src/lib/projection.ts` → **no matches**.

### Step 5: Commit defect 1

Commit with the first message from the Git workflow section. The body should
say what the reader saw wrong, not only what the code did — the year in the
room-exhaustion notice is the reason this is worth a commit.

### Step 6: Clear the persist flag on a successful write

In `src/stores/prices.ts`, make `setSnapshot` and `setHistory` lower
`persistFailed` when the write resolves, leaving the existing `catch` behaviour
alone.

A `.then(...)` beside the existing `.catch(...)`, or setting the flag false in
the same `set` that stores the value and only raising it in the `catch`, both
work. **Pick one and use the same shape in both functions** — they are
deliberately parallel today and should stay that way.

Note the ordering hazard and say in your report how you handled it: two writes
in flight at once mean a slow failure could land after a fast success. Lowering
the flag optimistically at the start of each write is the simpler reading and
matches the existing best-effort posture; a sequence number would be
over-engineering here. Whichever you choose, the user-visible rule must be
"the flag reflects the most recent write attempt", not "the flag never comes
down".

Add a comment explaining *why* the flag comes down, in the house voice — the
existing comment explains why it goes up, and the pair should read together.

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `grep -n "persistFailed" src/stores/prices.ts` → the flag is now
set `false` on a success path in both setters, and still `true` in both
`catch`es.

### Step 7: Commit defect 2, then verify everything

Commit with the second message.

**Verify**: `pnpm typecheck && pnpm test && pnpm check && pnpm build` → exit 0.

**Verify**: `pnpm check` reports **no new warnings** relative to your Step 1
baseline. Do not assert an absolute number — the count is 0 today only because
`plans/016` cleared five; check the shape, not the digit.

**Verify**: `git status --short` lists only the three in-scope files.

**Verify**: `git log --oneline -2` shows two separate commits.

## Test plan

All in `src/lib/projection.test.ts`. The suite is `environment: "node"` with
`TZ: "America/Toronto"` pinned, so local-evening fixtures are deterministic.

| Case | Pins |
|---|---|
| `new Date(2026, 0, 15, 21, 0)` → year 0 is `2026-01-15` | **The bug.** Red in Step 2. |
| `new Date(2026, 11, 31, 21, 0)` → year 0 is `2026-12-31` | **The year shift.** Red in Step 3. |
| the same, year 5 → `2031-12-31` | The error propagates to every horizon year |
| `new Date(2024, 1, 29, 21, 0)`, 1 year → `2025-02-28` | **The clamp that never fired.** Red at `2025-03-01`. |
| existing cases with the rewritten `START` | Nothing else moved |

All three red cases must be **observed failing** before Step 4. Report the
output for each.

`src/stores/prices.ts` gets no test: there are no store tests in this repo and
adding a harness for one boolean is out of proportion. Verify it by reading, and
say so.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; every test in your Step 1 baseline still passes, plus
      at least 2 new cases
- [ ] `pnpm check` exits 0 with no new warnings versus your baseline
- [ ] `pnpm build` exits 0
- [ ] `grep -n "getUTC" src/lib/projection.ts` returns no matches
- [ ] `grep -n "Date.UTC" src/lib/projection.test.ts` returns no matches
- [ ] `git diff f502b82..HEAD -- src/lib/calendar-date.ts src/lib/market-month.ts src/components/analytics/analytics-overview.tsx`
      shows **no changes**
- [ ] `git status --short` lists only `src/lib/projection.ts`,
      `src/lib/projection.test.ts` and `src/stores/prices.ts`
- [ ] `git log --oneline -2` shows two separate commits
- [ ] `plans/README.md` status row for 020 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The Step 2 fixtures **pass** against the unfixed code. Something is wrong with
  the timezone pin or your fixture times, and every later step depends on this
  being red first.
- The leap-day clamp cannot be made to pass with `addMonths`. That would mean
  the helper's clamping differs from the hand-rolled branch, which contradicts
  the verified table above — report the inputs and outputs rather than
  reinstating the old branch.
- You find another consumer of `ProjectionPoint.date` beyond
  `analytics-overview.tsx:191` and the chart axes. Report the `file:line`; it
  may widen the blast radius and is worth knowing before this merges.
- Fixing `anniversary` moves a **balance**, not just a date. It must not: the
  date is a label attached to a point, and `projectSeries` computes balances
  from `year`, never from `date`. If a money figure changes, stop — something
  else is wired to the date and this plan's premise is wrong.

## Maintenance notes

For whoever owns this next:

- **The lesson worth keeping**: `plans/009` deferred this as "label-only" and
  that was checked against the function, not against its consumers. A derived
  value is only a label until someone slices it. The check that would have
  caught it is `grep -rn "\.date" src/components/` — cheap, and worth doing
  before declaring anything cosmetic.
- **The masking pattern has now appeared twice** — `price-snapshot.test.ts:264`
  and `projection.test.ts:39`. Both were fixed UTC instants asserted against
  UTC-derived output, which agrees in every timezone and proves nothing. If you
  see `new Date(Date.UTC(...))` in a fixture whose assertion is a calendar date,
  suspect it.
- **`anniversary` is now one line and delegates**, which is the pattern
  `AGENTS.md` describes: derived figures delegate rather than re-derive, so two
  surfaces cannot disagree. The Feb-29 clamp lives in exactly one place now —
  and note that the hand-rolled version it replaces was *itself* broken on a
  leap-day evening, where it compared March to March and skipped the clamp
  entirely. A special case with its own test that still fails on its own input
  is a good argument for delegating to a tested helper.
- **Deliberately not done**: dating the projection from the dataset's last
  activity date rather than from "today". Arguably more meaningful — a
  projection over a six-month-old export is anchored to a date the data never
  saw — but it changes what the feature *means* and needs a maintainer decision,
  not a bug fix.
- **What a reviewer should scrutinise**: that the executor reports having seen
  both new cases fail first; that no balance moved; and that `persistFailed`
  comes down on success in *both* setters, not just the one that was easier to
  reach.
