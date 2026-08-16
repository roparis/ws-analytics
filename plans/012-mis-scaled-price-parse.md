# Plan 012: Reject a mis-scaled price instead of reading it as a fraction

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 99fa8b4..HEAD -- src/lib/price-snapshot.ts src/lib/price-snapshot.test.ts`
> If either file changed since this plan was reconciled, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d1d2640`, 2026-08-15
- **Reconciled at**: commit `99fa8b4`, 2026-08-16 — `plans/009` has since landed
  and edited this same file (`asOf` default, `snapshotAgeDays`). `toNumber` is
  **byte-for-byte unchanged**; only line numbers moved, and every excerpt below
  is re-verified against `99fa8b4`. The test-count baseline and the Step 2
  fixture guidance were also corrected — see the notes in those steps.

## Why this matters

The Google Sheets round trip lets a user download a Holdings tab and re-import
it to price their portfolio. The number parser in that path treats a comma as a
**decimal separator whenever the string contains no dot** — a rule meant to
accept European formatting like `1 234,56`.

That rule also fires on a thousands-grouped integer. `95,000` becomes `95.000`,
i.e. **95** — a price wrong by three orders of magnitude, silently. Market
value, unrealised gain, the valued balances, and the whole projection's starting
balance all follow it down.

The asymmetry is what makes this worth fixing: a *missing* price is handled
loudly (the symbol goes into `unpriced` and the UI names it), while a
*mis-scaled* price sails through. A price parser should refuse what it cannot
read confidently rather than guess.

The trigger is ordinary: a spreadsheet cell formatted to zero decimal places,
which is a plausible default for a high-priced instrument.

## Current state

Verified excerpt, `src/lib/price-snapshot.ts:127-145`:

```ts
/**
 * `$1,234.56` and `1 234,56` alike. Sheets writes plain numbers for
 * `GOOGLEFINANCE` output, but a locale-formatted export shouldn't be rejected
 * over a thousands separator.
 */
function toNumber(value: string | undefined): number | null {
	if (!value) return null;
	const cleaned = value.replace(/[^\d.,-]/g, "").replace(/\s/g, "");
	if (!cleaned) return null;

	// A comma is a decimal separator only when no dot is present.
	const normalized = cleaned.includes(".")
		? cleaned.replace(/,/g, "")
		: cleaned.replace(/,/g, ".");

	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : null;
}
```

Worked examples against the current rule:

| Input | `cleaned` | Has `.`? | `normalized` | Result | Correct? |
|---|---|---|---|---|---|
| `$1,234.56` | `1,234.56` | yes | `1234.56` | `1234.56` | ✅ |
| `1 234,56` | `1234,56` | no | `1234.56` | `1234.56` | ✅ |
| `95,000` | `95,000` | **no** | `95.000` | **`95`** | ❌ **1000× too small** |
| `1,234,567` | `1,234,567` | no | `1.234.567` | `NaN` → `null` | ✅ (by accident) |

Note the last row: a multi-comma integer already fails safely, because
`Number("1.234.567")` is `NaN`. Only the **single-comma** integer is dangerous.

### The only guard the value passes

Verified excerpt, `src/lib/price-snapshot.ts:98-102`:

```ts
		const price = toNumber(row[COLUMNS.priceCad]);
		if (price === null || price <= 0) {
			unpriced.add(symbol);
			continue;
		}
```

`95` is positive and finite, so it is accepted as a real price.

### Where a rejected price goes

The `unpriced` set is surfaced to the user — a symbol that lands there is named
in the UI and the holding falls back to book cost. That is the existing,
correct failure mode, and it is where an unreadable price should go.

### Repo conventions

- **Tabs** for indentation.
- Comments are prose explaining *why*. The existing docblock on `toNumber`
  states the intent — update it rather than leaving it describing the old rule.
- Tests colocated as `src/lib/*.test.ts`, `import { describe, expect, it } from "vitest";`,
  no mocks anywhere in the suite.
- `src/lib/price-snapshot.test.ts` already exists — add to it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, your measured baseline + new |
| One file | `pnpm test price-snapshot` | all pass |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings) |

## Scope

**In scope**:
- `src/lib/price-snapshot.ts` — the `toNumber` function only
- `src/lib/price-snapshot.test.ts`

**Out of scope** (do NOT touch):
- `parsePriceCsv`'s header detection, the `Total`-row skip, the `unpriced`
  handling, or the `price <= 0` guard. All correct.
- The `asOf` default at `src/lib/price-snapshot.ts:70` and `snapshotAgeDays` at
  `:236-241` — those were `plans/009`'s, **and 009 has landed**. Both now call
  `todayLocalIso` from `@/lib/calendar-date`. Leave them exactly as they are;
  they are correct and they are not this plan's concern.
- `src/lib/google-sheet.ts` — the *writer* side. Changing what the sheet emits
  is a different change with a different risk profile, and would not help a
  user whose sheet is already formatted.
- Adding a plausibility check against `averageCost`. Tempting, and deliberately
  deferred — see Maintenance notes.

## Git workflow

- Branch: `advisor/012-mis-scaled-price-parse`
- Commit message in repo style (imperative, sentence-case, no
  conventional-commit prefix):
  `Refuse a price the parser can't read rather than guessing at it`
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
context, not as an assertion — a different number is drift to note, not a
failure to stop on. Stop only if something **fails**.

### Step 2: Write the failing test first

Add to `src/lib/price-snapshot.test.ts` a case asserting that a
thousands-grouped integer price is **not** read as a fraction.

`toNumber` is private, so assert through the public `parsePriceCsv`.

**Do not hand-write a CSV.** The test file already has the right tool: a
`holdingsCsv(prices)` helper (`price-snapshot.test.ts:80`) that builds the
fixture from `buildWorkbook` — the real exporter — so a column rename fails here
rather than in someone's browser. Use it.

Its parameter is typed `Record<string, number | "">`, so you cannot pass the
string `"95,000"` through it. The file already solves this, at
`price-snapshot.test.ts:162-171`: build with an ordinary numeric price, then
string-replace that one cell with the formatted variant.

```ts
	it("reads a price the sheet formatted with a currency symbol", () => {
		const csv = holdingsCsv({ ZAG: 11.5, VTI: 140, XEQT: 34.25 }).replace(
			",11.5,",
			',"$1,211.50",',
		);
		expect(parsePriceCsv(csv, "Holdings.csv").pricesCad.ZAG).toBeCloseTo(
			1211.5,
			6,
		);
	});
```

Two details that will cost you an hour if you miss them:

- **The replacement must be quoted.** A bare `95,000` in a CSV is two columns,
  and Papaparse will read it as such — you would be testing the CSV quoting
  rules, not `toNumber`. Write `',"95,000",'`, exactly as the excerpt above
  quotes `"$1,211.50"`.
- **The `.replace` target must be unique in the document.** `replace` swaps only
  the first match; pick prices for the three symbols that cannot collide with
  each other or with any other number the workbook emits, and assert on the
  symbol you actually replaced.

**Run `pnpm test price-snapshot` and confirm it FAILS**, reporting `95`.

If it passes, your fixture is not exercising the path — rework it until it goes
red. Do not proceed on a test that could never have failed.

### Step 3: Narrow the decimal-comma rule

Change `toNumber` so a comma is treated as a decimal separator **only** when it
is followed by exactly one or two digits at the end of the string — which is
what a decimal comma always looks like in a price. Otherwise strip it as a
group separator.

A rule of the shape `/,\d{1,2}$/` distinguishes the two cases:

| Input | Matches `/,\d{1,2}$/`? | Treat comma as | Result |
|---|---|---|---|
| `1234,56` | yes | decimal | `1234.56` |
| `95,000` | no (three digits) | group separator | `95000` |
| `1,234.56` | no (dot present, handled first) | group separator | `1234.56` |
| `1,234,567` | no | group separator | `1234567` |

Keep the existing dot-present branch first — when a dot is present the comma is
unambiguously a group separator, and that path is already correct.

Update the docblock so it states the new rule rather than the old one, and say
*why* the digit count is the discriminator: a decimal comma in a price is always
followed by one or two digits, so a group of three is a thousands separator.

**Verify**: `pnpm test price-snapshot` → the new case now passes, and every
pre-existing case in the file still passes.

### Step 4: Cover the rest of the truth table

Add the remaining cases from the table in Step 3 plus the ones in the Test plan
below, so the rule is pinned in both directions — a decimal comma must still
work, and a group separator must not be eaten.

**Verify**: `pnpm test` → exit 0, your Step 1 baseline plus your new cases, with
nothing previously passing now failing.

### Step 5: Full verification

**Verify**: `pnpm typecheck && pnpm test && pnpm check` → exit 0.

**Verify**: `pnpm check` prints exactly 5 warnings, all in
`src/lib/google-sheet.ts`.

**Verify**: `git status --short` lists only the two in-scope files.

## Test plan

All cases go in `src/lib/price-snapshot.test.ts`, asserted through
`parsePriceCsv`:

| Input cell | Expected price | Why |
|---|---|---|
| `95,000` | `95000` | **The bug.** Red before the fix. |
| `1,234.56` | `1234.56` | Anglo formatting with a group separator — regression |
| `1234,56` | `1234.56` | European decimal comma — regression, must keep working |
| `1 234,56` | `1234.56` | European with a space group separator — regression |
| `$1,234.56` | `1234.56` | Currency symbol stripped — regression |
| `1,234,567` | `1234567` | Multi-group integer; previously `NaN`, now correct |
| `42.7592` | `42.7592` | Plain decimal, the common `GOOGLEFINANCE` output |
| `0` or empty | symbol lands in `unpriced` | The existing `price <= 0` guard still fires |

The first row must be observed failing in Step 2. The four regression rows are
what stop the fix from breaking European-formatted sheets — the reason the
original rule existed.

Check the existing cases in `price-snapshot.test.ts` before writing: if any of
these are already covered, extend rather than duplicate.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; every test in your Step 1 baseline still passes, plus
      at least 6 new cases
- [ ] `pnpm check` exits 0 with exactly 5 warnings, all in
      `src/lib/google-sheet.ts`
- [ ] `grep -n "A comma is a decimal separator only when no dot is present" src/lib/price-snapshot.ts`
      returns no matches — the old rule's comment is gone
- [ ] `git diff 99fa8b4..HEAD -- src/lib/google-sheet.ts` shows **no changes**
- [ ] `git status --short` lists only `src/lib/price-snapshot.ts` and
      `src/lib/price-snapshot.test.ts`
- [ ] `plans/README.md` status row for 012 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The Step 2 test **passes** against the unfixed code. Rework the fixture; do not
  proceed on a test that could never have failed.
- Any pre-existing test in `src/lib/price-snapshot.test.ts` fails after the
  change. That means a real formatting case is being rejected — report which
  input, since it would mean the new rule is too narrow.
- You conclude the fix needs to change what `src/lib/google-sheet.ts` writes.
  It does not — a user's existing sheet is already formatted however it is
  formatted.
- You find another number-parsing path with the same rule elsewhere in `src/`.
  Report the `file:line`; do not fold it in.

## Maintenance notes

For whoever owns this next:

- **The principle**: an unreadable price should land in `unpriced`, where the UI
  names it and the holding falls back to book cost. Silently accepting a number
  the parser is unsure about is the failure mode being removed.
- **Deliberately deferred**: a plausibility check comparing the parsed price
  against the position's `averageCost` and flagging an order-of-magnitude
  divergence. It would catch mis-scaling this rule cannot — but it needs a
  threshold, and a genuine ten-bagger would trip it. Worth doing only with real
  evidence about false positives.
- **The writer side is untouched**, so a sheet whose cells are formatted to zero
  decimals will keep producing `95,000`. After this change it parses correctly
  rather than needing the user to reformat.
- **Reconciliation (resolved)**: `plans/009` also edited
  `src/lib/price-snapshot.ts` and landed first, in PR #31. It touched the `asOf`
  default (`:70`) and `snapshotAgeDays` (`:236-241`), both different functions
  from `toNumber`, which it left byte-for-byte unchanged. The excerpts in this
  plan were re-verified against `99fa8b4` after that merge; nothing but line
  numbers moved.
- **What a reviewer should scrutinise**: that all four European/Anglo formatting
  regressions are covered; that the dot-present branch is still evaluated first;
  and that the executor reports having *seen the new case fail* first.
