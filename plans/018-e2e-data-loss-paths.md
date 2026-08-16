# Plan 018: Cover the data-loss paths with Playwright, where unit tests structurally cannot reach

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 1d09a07..HEAD -- src/lib/storage.ts src/stores/dataset.ts src/components/data-source-card.tsx src/components/csv-uploader.tsx package.json`
> Changes from plans 004 and 005 are **expected** — this plan builds on them.
> Anything else is a mismatch; treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (adds a test layer; touches no application code)
- **Depends on**: **004 and 005 must both be present.** This plan tests exactly
  what they fixed. Both merged to `main` via PR #18 — branch from `origin/main`.
  (An earlier revision said to branch from `advisor/005-gate-uploader-on-hydration`;
  that branch no longer exists.)
- **Category**: tests
- **Planned at**: commit `a4a1c9e`, 2026-08-16

## Why this matters

Plans 004 and 005 fixed the two paths in this app where a user can lose the only
copy of their financial export. Both were reviewed and approved — and both were
verified **structurally only**. Nobody has watched either work.

They cannot be verified any other way today. `vitest.config.mts` sets
`environment: "node"`, and all three behaviours need things node does not have:

| Behaviour | Needs |
|---|---|
| A file survives a failed re-parse (004) | Real IndexedDB, a stored record with a stale `parserVersion` |
| A mid-hydration drop doesn't wipe the store (005) | Real IndexedDB, real timing, real file upload |
| Data round-trips across a reload | A real browser session |

`src/lib/storage.ts` has **zero** tests. It is the module that decides whether
someone's data survives, and nothing exercises it.

This is deliberately **not** a reversal of the "no jsdom, no Testing Library"
decision recorded in `plans/README.md`. That decision was about *component*
tests, and its reasoning — the dangerous untested code is `merge.ts` and
`parseActivities`, not JSX — still stands. This plan adds no component tests. It
covers the storage and timing layer, which nothing covers at all.

## Current state

### No E2E infrastructure exists

Verified: `package.json` mentions neither Playwright nor Cypress; there is no
`e2e/`, `tests/`, `cypress/` or `playwright.config.*`. This is greenfield, so
the conventions it establishes are the ones the repo will keep.

### The upload seam

`src/components/csv-uploader.tsx` renders a real file input:

```tsx
		<input
			accept=".csv,text/csv"
			...
			ref={inputRef}
			type="file"
```

It is visually hidden and normally triggered by a button click
(`inputRef.current?.click()`), and there is a drag-drop handler on the
surrounding element. **Playwright's `setInputFiles` drives the input directly**
regardless of visibility — do not try to simulate a drag.

### What the parser requires of a fixture

`src/lib/wealthsimple.ts` rejects anything missing a column:

```ts
				const missing: string[] = REQUIRED_COLUMNS.filter(
					(column) => !fields.includes(column),
				);
				if (!dateColumn) missing.unshift(DATE_COLUMNS.join(" or "));

				if (!dateColumn || missing.length > 0) {
					reject(
						new Error(
							`${fileName} doesn't look like a Wealthsimple activities export. Missing columns: ${missing.join(", ")}.`,
						),
					);
```

`REQUIRED_COLUMNS` is: `account_id`, `account_type`, `activity_type`,
`activity_sub_type`, `description`, `symbol`, `name`, `currency`, `quantity`,
`unit_price`, `commission`, `net_cash_amount`. Plus a date column, which is
`effective_at` (preferred) or `transaction_date`.

Two data rules your generated fixture must respect, so it does not trip the
invariant checks (`validateDataset`) and produce console noise:

- On any non-`Trade`, non-`LegacyCorporateAction` row, `quantity` **equals**
  `net_cash_amount` exactly, sign included.
- Per account, `Σ net_cash_amount` must be a small non-negative number — it is
  the account's idle cash balance.

Read `docs/wealthsimple-csv-format.md` §2.1, §2.2 and §6 before writing the
generator. Getting this wrong produces a fixture that "works" but exercises a
warning path you did not intend.

### The IndexedDB schema, which the tests will seed directly

From `src/lib/storage.ts`:

```ts
const DB_NAME = "ws-analytics";
const SOURCES = "sources";      // keyPath: "fileName"
const META = "meta";            // keyPath: "key"
const PRICES = "prices";        // keyPath: "key"
const ORDER_KEY = "order";
```

and a stored source is:

```ts
interface StoredSource {
	fileName: string;
	rawText: string;
	activities: Activity[];
	parserVersion: number;
}
```

`PARSER_VERSION` is currently **2** (`src/lib/wealthsimple.ts`).

**Seeding this directly from the test is the technique that makes 004 testable.**
You cannot make the app produce a stale record without shipping two builds; you
can write one in three lines of `page.evaluate`. The cost is that the test knows
the storage schema — accept it, and say so in a comment, because a schema change
should break these tests loudly rather than silently stop covering anything.

### Why the production build, not `pnpm dev`

`next.config.ts` does not set `reactStrictMode`, so it takes Next's default,
which is **on in development**. Strict Mode double-invokes effects, so
`StoreHydrator`'s `useEffect` calls `hydrate()` twice — and both calls pass the
`if (get().hydrated) return` guard, because neither has resolved yet. That is a
dev-only artifact, and hydration-timing tests run against it would be measuring
React's development behaviour rather than the app's.

Run the suite against `pnpm build && pnpm start`.

### Repo conventions

- **Tabs** for indentation; Biome formats and auto-sorts imports. Biome will lint
  the new test files — run `pnpm check` and accept its formatting.
- Comments are prose explaining *why*.
- Commit style: imperative, sentence case, no conventional-commit prefix.
- **No CSV may be committed.** `.gitignore:27-29` excludes `*.csv` and `*.xlsx`
  under the comment "personal data — this app runs on real Wealthsimple
  exports". No CSV is tracked anywhere in the repo today. **Do not add a
  gitignore exception.** See Step 3.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typegen (before any typecheck) | `pnpm exec next typegen` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Unit tests | `pnpm test` | exit 0, 13 files / 228 tests |
| Lint | `pnpm check` | exit 0, exactly 5 warnings in `src/lib/google-sheet.ts` |
| Build | `pnpm build` | exit 0 |
| E2E (new) | `pnpm test:e2e` | all specs pass |

## Scope

**In scope** (create):
- `playwright.config.ts`
- `e2e/` — the specs and their helpers
- `package.json` — add `@playwright/test` to devDependencies and a `test:e2e`
  script. Nothing else in this file.
- `pnpm-lock.yaml` — regenerated by `pnpm install`, never hand-edited
- `.gitignore` — add Playwright's output dirs (`/test-results/`,
  `/playwright-report/`, `/blob-report/`). **Do not touch the `*.csv` rule.**
- `.github/workflows/` — a **separate** E2E job (Step 6)

**Out of scope** (do NOT touch):
- **Every file under `src/`.** This plan adds tests for existing behaviour. If a
  test fails, that is a finding to report, not code to change. This is the single
  most important boundary in this plan.
- `vitest.config.mts` and every existing `*.test.ts`. Playwright and Vitest must
  not collide: Playwright's default `testMatch` picks up `*.spec.ts`, and Vitest
  is pinned to `src/**/*.test.ts`. Keep E2E specs in `e2e/` named `*.spec.ts`.
- The existing `verify` job in `.github/workflows/ci.yml`. Add a job; do not
  slow the fast gate down.
- Committing any `.csv` or `.xlsx`, or adding a `!` exception for one.
- Component-level tests, jsdom, Testing Library. Explicitly rejected in
  `plans/README.md` and not revisited here.
- Visual regression / screenshot assertions. Brittle, and not what this covers.
- Testing the live-pricing routes. Plans 010 and 015 are changing them.

## Git workflow

- Branch: `advisor/018-e2e-data-loss-paths`, from
  `advisor/005-gate-uploader-on-hydration`
- Commit per logical unit. Messages in repo style:
  - `Drive the app in a real browser, where the storage bugs live`
  - `Cover the two ways a saved export used to disappear`
- Do NOT push or open a pull request.

## Steps

### Step 1: Record the baseline

**Verify**: `pnpm install && pnpm exec next typegen && pnpm typecheck && pnpm test && pnpm check && pnpm build` → exit 0 throughout, with 13 files / 228 tests and exactly 5 warnings.

### Step 2: Add Playwright

Add `@playwright/test` to `devDependencies` and install browsers
(`pnpm exec playwright install --with-deps chromium`). **Chromium only** — this
suite tests IndexedDB behaviour, not cross-browser rendering, and three browsers
would triple CI time for no added signal.

Create `playwright.config.ts`:

- `testDir: "e2e"`
- `webServer`: run the **production** build (`pnpm build && pnpm start`) on port
  3000, with `reuseExistingServer: !process.env.CI`. See "Why the production
  build" above — this is load-bearing, not a preference.
- `use: { baseURL: "http://localhost:3000" }`
- `fullyParallel: false` — **every spec shares one IndexedDB origin**. Parallel
  specs would race each other's storage. This is the single most important line
  in the config; comment it.
- `retries: process.env.CI ? 1 : 0`

Add to `package.json` scripts: `"test:e2e": "playwright test"`.

**Verify**: `pnpm exec playwright --version` → prints a version.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Write the fixture generator — in code, not as a committed file

Create `e2e/fixtures.ts` exporting a function that **returns CSV text as a
string**, built from a small set of synthetic rows.

Do **not** write a `.csv` file into the repo. `.gitignore` excludes `*.csv`
deliberately, and an exception is the kind of thing someone later drops a real
export into. Generating the text keeps that rule absolute and makes the data's
synthetic nature obvious at the point of use.

Feed it to Playwright via the in-memory form of `setInputFiles`:

```ts
await page.locator('input[type="file"]').setInputFiles({
	name: "activities.csv",
	mimeType: "text/csv",
	buffer: Buffer.from(csvText),
});
```

The generator needs to produce at least two *distinct* files (different account
ids or date ranges) so the merge and multi-file cases are testable.

Every figure must be small, round and obviously invented. Follow the rules in
"What the parser requires of a fixture" above so the invariant checks stay quiet.

**Verify**: a scratch assertion that the generated text contains all 12 required
columns plus `effective_at`. Delete the scratch check before committing, or keep
it as a real spec assertion.

### Step 4: Cover the round trip (the provable cases first)

Create `e2e/data-persistence.spec.ts`. Each spec must start from a clean origin
— clear IndexedDB in a `beforeEach` via `page.evaluate`, or use a fresh context.
A spec that inherits another's storage proves nothing.

| # | Case | Assertion |
|---|---|---|
| 1 | Upload one file | Figures render; the sidebar names the file |
| 2 | Reload after upload | Data is still there — the IndexedDB round trip |
| 3 | Upload a second file | Both listed; totals reflect the merge |
| 4 | "Clear data", then reload | Gone, and stays gone |

The clear button is reachable by its accessible name — `aria-label="Clear data"`
in `src/components/data-source-card.tsx`. Prefer role/label locators over CSS
throughout; they survive restyling.

**Verify**: `pnpm test:e2e` → these four pass.

### Step 5: Cover the two data-loss paths

Create `e2e/data-loss.spec.ts`.

**5a — a file that fails to re-parse survives (plan 004).** Seed IndexedDB
directly with two `sources` records: one valid at the current `PARSER_VERSION`,
and one with `parserVersion: 1` whose `rawText` is **not** parseable. Also seed
the `meta` `order` record naming both. Then load the app.

Assert:
- The valid file's figures render.
- A toast names the unreadable file (plan 004's `reportFailedSources`).
- **After a reload, the broken record is still in IndexedDB** — read it back via
  `page.evaluate`. This is the assertion the whole plan exists for; before 004 it
  was deleted.

**5b — the mid-hydration race (plan 005).** Two parts, in order:

First, the *guard*, which is straightforward: delay the IndexedDB read using
`page.addInitScript` to wrap `indexedDB.open`, load the app, and assert the
sidebar shows a **skeleton and no file input** during the read. That is plan
005's Step 1 and it is deterministically testable.

Second, the *recovery*, which is the hard one: with the read still delayed, drop
a file, let hydration land, and assert both the seeded files and the dropped one
survive — in `[...stored, ...dropped]` order, and present in IndexedDB after a
reload.

**If you cannot make 5b's second half deterministic, STOP and report.** Do not
ship a test that passes on timing luck; a flaky test on a data-loss path is worse
than no test, because it trains people to re-run until green. Report what you
tried. The guard half (first part) still lands and is worth having on its own.

Note the trade-off to state in a comment: delaying `indexedDB.open` via
`addInitScript` means the test instruments the environment rather than the app.
That is acceptable here — the instrumentation is a delay, not a behaviour change
— but it should be visible to whoever reads the test next.

**Verify**: `pnpm test:e2e` → all specs pass, run three times in a row with no
flakes.

### Step 6: Wire a separate CI job

In `.github/workflows/`, add an **`e2e` job** that runs on `pull_request` only —
not on every push. Leave the existing `verify` job untouched, including its
triggers.

The job needs: checkout, pnpm, Node 20, `pnpm install --frozen-lockfile`,
`pnpm exec playwright install --with-deps chromium`, then `pnpm test:e2e`.
Upload the Playwright report as an artifact on failure.

Whether this is a second job in `ci.yml` or its own workflow file is your call —
pick one and say which in your report. The constraint is that the fast gate's
runtime does not change.

**Verify**: the workflow file is valid YAML.

**Verify**: `pnpm check && pnpm typecheck && pnpm test && pnpm build` → all exit
0, unit suite still 228 tests.

### Step 7: Full verification

**Verify**: `pnpm test:e2e` → all pass.

**Verify**: `git status --short` → only files from the In-scope list.

**Verify**: `git diff --stat 1d09a07..HEAD -- src/` → shows **only** plans 004
and 005's changes. **Nothing new under `src/`.**

## Test plan

The specs above are the test plan. What matters most:

- **Every spec starts from a clean IndexedDB.** Shared-origin state between
  specs is the main way an E2E suite silently stops proving anything.
- **Locate by role and accessible name**, not CSS classes. This app is styled
  with Tailwind utility classes that change freely.
- **No arbitrary `waitForTimeout`.** Wait on a condition — an element, a network
  idle, a storage read. A sleep is how a suite becomes flaky six months later.
- **Assert on IndexedDB contents, not just the UI**, for 5a and 5b. The bugs
  these cover are about what survives on disk; the screen can look right while
  the database is wrong. That is precisely how both bugs went unnoticed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm test:e2e` exits 0
- [ ] Running `pnpm test:e2e` three times consecutively passes all three times
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0 — still 13 files / 228 tests (Playwright did not
      capture Vitest's specs, or vice versa)
- [ ] `pnpm check` exits 0 with exactly 5 warnings, all in
      `src/lib/google-sheet.ts`
- [ ] `pnpm build` exits 0
- [ ] `git diff --stat 1d09a07..HEAD -- src/` shows no files beyond those
      changed by plans 004 and 005
- [ ] `git ls-files | grep -c '\.csv$'` returns **0** — no CSV committed
- [ ] `grep -c '!.*\.csv' .gitignore` returns **0** — no exception added
- [ ] `grep -n "fullyParallel" playwright.config.ts` shows it set to `false`
- [ ] `grep -n "webServer" playwright.config.ts` shows the production build, not
      `next dev`
- [ ] The existing `verify` job in `.github/workflows/ci.yml` is unchanged
      (`git diff 1d09a07..HEAD -- .github/workflows/ci.yml` shows only additions,
      if you edited that file at all)

## STOP conditions

Stop and report back (do not improvise) if:

- **Any spec fails against the current code.** That means 004 or 005 does not
  actually work, which is a finding worth far more than this plan. Report the
  failure in full. **Do not modify anything under `src/` to make a test pass.**
- **5b's recovery half cannot be made deterministic.** Report what you tried.
  Ship the guard half.
- A spec passes only sometimes across the three consecutive runs.
- Playwright's `testMatch` picks up the Vitest specs under `src/`, or Vitest
  starts collecting `e2e/`. The two runners must stay disjoint.
- The production `webServer` cannot start in the sandbox. Say so plainly rather
  than silently switching to `next dev` — that would change what the hydration
  tests measure.
- You find yourself wanting to commit a `.csv` fixture or add a `.gitignore`
  exception.

## Maintenance notes

For whoever owns this next:

- **These tests know the IndexedDB schema.** `DB_NAME`, the store names, and
  `StoredSource`'s shape are hard-coded in the seeding helpers. That coupling is
  deliberate: a schema change *should* break them loudly. If `storage.ts` grows
  a migration, these are the tests that will tell you it worked.
- **The suite is Chromium-only and that is a deliberate scope choice**, not an
  oversight. It tests storage semantics, not rendering. Adding browsers triples
  CI time for no added signal on what this covers.
- **`fullyParallel: false` is load-bearing.** Every spec shares one IndexedDB
  origin. Anyone turning parallelism on must first give each spec its own origin
  or its own worker context.
- **What this suite does *not* cover**, deliberately: the live-pricing routes
  (plans 010 and 015 are changing them), the analytics and projection maths
  (already unit-tested, and far better tested there), and anything visual.
- **The natural next case**, once plan 008 lands: it bumps `PARSER_VERSION`,
  which is exactly the real-world trigger for 004's re-parse path. Spec 5a
  simulates that trigger by seeding a stale record; after 008 the real thing can
  be exercised end to end.
- **What a reviewer should scrutinise**: that no `src/` file is in the diff; that
  no CSV is committed; that 5a and 5b assert on **IndexedDB contents** and not
  only on what the screen shows; and that there is no `waitForTimeout` anywhere.
