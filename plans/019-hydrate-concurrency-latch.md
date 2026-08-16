# Plan 019: Stop `hydrate()` from racing itself and deleting the file it was protecting

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 776deaf..HEAD -- src/stores/dataset.ts src/stores/prices.ts src/lib/storage.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. Builds on 004, 005 and 018, all merged.
- **Category**: bug
- **Planned at**: commit `776deaf`, 2026-08-16

## Why this matters

`hydrate()`'s guard is a **check-then-act on shared state**, and the consequence
is data loss.

```ts
if (get().hydrated) return;          // check
const { sources, ... } = await loadSources();   // ...await...
set((state) => { ... });             // act
```

Two concurrent calls both pass the check, because neither has resolved
`loadSources()` yet. The first resolves and sets `sources`. The second then
observes `state.sources.length !== 0`, concludes that a **user** raced it, takes
plan 005's `raced` branch, and calls `saveSources(get().sources)` — a wholesale
replace that **deletes any record which failed to re-parse**.

That record is precisely what plan 004 exists to preserve. So 005's
data-protecting path becomes data-destroying whenever `hydrate` races itself.

This was found by plan 018's Playwright suite and confirmed with an instrumented
`indexedDB.open` counter: **9 opens and 2 identical toasts under `next dev`, versus
4 opens and 1 toast against the production build.**

**Today the only trigger is React Strict Mode**, which double-invokes effects in
development and is off in production. So the symptom is development-only right
now — but:

- The guard is unsafe *by construction*. Any second caller of `hydrate`, ever,
  reproduces it in production. Nothing prevents one being added.
- Developers run `next dev` constantly, and this destroys their data in exactly
  the scenario 004 was written for.
- It is three lines to fix, using an idiom this repository already contains.

## Current state

### The unsafe guard

Verified excerpt, `src/stores/dataset.ts`:

```ts
	hydrate: async () => {
		if (get().hydrated) return;
		try {
			const { sources, reparsed, failed } = await loadSources();
			let raced = false;

			set((state) => {
				if (state.sources.length === 0) {
					return { ...withSources(sources), hydrated: true };
				}
				// Files were added while IndexedDB was being read...
				raced = true;
				...
			});

			if (raced) {
				persist(saveSources(get().sources));
			} else if (reparsed > 0) {
				persist(updateSources(sources));
			}

			if (failed.length > 0) reportFailedSources(failed);
		} catch (error) {
			console.warn("Could not read local storage:", error);
			set({ hydrated: true });
		}
	},
```

The `raced` branch is **correct for the case it was written for** — a real user
dropping a file mid-read. Do not change its logic. The bug is that a second
`hydrate` looks identical to a user from inside that `set`.

### The exemplar — this repository already solves this, one layer down

Verified excerpt, `src/lib/storage.ts`:

```ts
/**
 * Shared across callers so the schema check happens once. Both stores hydrate
 * on mount, and two concurrent version-change opens would block each other —
 * one would win and the other would reject, taking a page's data with it.
 */
let schemaReady: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (!schemaReady) {
		// A failed check isn't cached: the next call gets to try again rather
		// than the app staying broken for the rest of the session.
		schemaReady = ensureSchema().catch((error) => {
			schemaReady = null;
			throw error;
		});
	}
	...
}
```

That is the same hazard, the same fix, and its comment even names "both stores
hydrate on mount" as the reason. **Match this idiom** — do not invent a different
one.

### The sibling store has the same shape but not the same bug

Verified excerpt, `src/stores/prices.ts`:

```ts
	hydrate: async () => {
		if (get().hydrated) return;
		try {
			const [snapshot, history] = await Promise.all([
				loadPriceSnapshot(),
				loadPriceHistory(),
			]);
			set({ hydrated: true, history, snapshot });
		} catch {
			set({ hydrated: true, history: null, snapshot: null });
		}
	},
```

Same check-then-act, but the `set` is an idempotent overwrite: no `raced` branch,
no wholesale database write. A double entry writes the same values twice and
loses nothing. **It is not broken today.** It is in scope anyway — see Scope.

### Where `hydrate` is called

Both stores are hydrated from `src/components/store-hydrator.tsx`, mounted once
in the root layout. That single call site is why the bug is currently confined to
Strict Mode's double-invoke.

### Repo conventions

- **Tabs** for indentation; Biome auto-sorts imports.
- Comments are prose explaining *why*.
- Tests colocated as `src/lib/*.test.ts`, `environment: "node"`.
- **No mocks, no fake timers anywhere** in the suite — `grep "vi.mock\|vi.fn\|vi.spyOn\|useFakeTimers"`
  across all test files returns zero hits. This constrains how the fix is tested;
  see the Test plan, which is designed around it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Unit tests | `pnpm test` | exit 0, 13 files / **244** baseline + new |
| Lint | `pnpm check` | exit 0, exactly 5 warnings in `src/lib/google-sheet.ts` |
| Build | `pnpm build` | exit 0 |
| E2E | `pnpm test:e2e` | 3 specs pass |

## Scope

**In scope**:
- `src/lib/once.ts` (create) — the latch helper
- `src/lib/once.test.ts` (create) — its tests
- `src/stores/dataset.ts` — apply the latch
- `src/stores/prices.ts` — apply the same latch

**Out of scope** (do NOT touch):
- **The `raced` branch's logic.** It is correct for a real user drop, which is
  what it was written for. This plan stops a second `hydrate` from *impersonating*
  a user; it does not change what happens when a genuine one appears.
- `src/lib/storage.ts` — `saveSources`, `updateSources`, `schemaReady`, the
  schema. Read `schemaReady` as the exemplar; change nothing.
- `src/components/store-hydrator.tsx`. Do **not** "fix" this by removing Strict
  Mode, setting `reactStrictMode: false`, or adding a ref guard in the component.
  Strict Mode is a diagnostic doing its job — it surfaced a real defect. Disabling
  it hides the symptom and leaves the store unsafe for the next caller.
- `next.config.ts`.
- The `e2e/` suite and `playwright.config.ts`. The existing 3 specs must keep
  passing untouched; adding a spec for this is discussed in Maintenance notes and
  is **not** part of this plan.
- Introducing a mocking library to test the stores directly.

**On including `prices.ts`**: it has no bug today. It is in scope because the two
stores sit side by side with the same guard, and latching one while leaving the
other would leave a reader unable to tell whether the difference is deliberate.
It is the same three lines. If applying it there turns out to be anything more
than that, stop and report rather than improvising.

## Git workflow

- Branch: `advisor/019-hydrate-concurrency-latch`, from `origin/main`
- Two commits:
  - `Share one in-flight hydration instead of racing a boolean`
  - `Latch the price store's hydration the same way`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Record the baseline

**Verify**: `pnpm typecheck && pnpm test && pnpm check && pnpm build` → exit 0,
with 13 files / 244 tests and exactly 5 warnings.

**Verify**: `pnpm test:e2e` → 3 specs pass. You will re-run this at the end;
these are the tests that cover the behaviour you are touching.

### Step 2: Write the latch helper, test-first

Create `src/lib/once.ts` exporting a single function that takes an async function
and returns one which, while a call is in flight, hands every caller the **same**
promise rather than starting a second run.

Requirements, each of which has a test in Step 3:

- Concurrent callers share one underlying invocation.
- The in-flight promise is released once it settles, so a later call can run
  again — matching `schemaReady`'s behaviour, and required because the failure
  path must be retryable.
- A rejection propagates to **every** waiting caller, and does not leave a
  poisoned promise cached.

Write the module header in the style of `src/lib/market-month.ts` — explain the
hazard (check-then-act across an `await` lets two callers both pass a boolean
guard) and point at `schemaReady` in `src/lib/storage.ts` as the pattern this
generalises.

**This helper is the whole reason the fix is testable.** The stores themselves
call `loadSources`, which needs IndexedDB, which does not exist under
`environment: "node"` — and this suite has no mocks and should not gain any. A
pure helper is verifiable with an ordinary async function and zero infrastructure.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Test the helper

Cases in `src/lib/once.test.ts` — see the Test plan. Write them before Step 4 and
confirm they pass; the helper is the piece carrying the correctness argument.

**Verify**: `pnpm test once` → all pass.

### Step 4: Apply it in `dataset.ts`

Wrap the body of `hydrate` so concurrent callers share one run. Keep the
`if (get().hydrated) return;` fast path — it is still the cheap check for the
already-done case; it was never sufficient on its own.

Add a comment at the latch explaining *why*, in the repo's voice: two callers
both passing the boolean guard is how a second `hydrate` came to look like a
user drop to the `raced` branch below, and delete the file 004 had preserved.

**Do not change anything inside the `try` block.** The `raced` logic, the
`updateSources` call, the `failed` reporting and the `catch` all stay exactly as
they are.

**Verify**: `pnpm typecheck && pnpm test` → exit 0, 244 tests still pass.

**Verify**: `git diff src/stores/dataset.ts` shows the latch and its comment, and
**no change inside the `set` callback**.

### Step 5: Apply it in `prices.ts`

Same three lines. Note in the comment that this store is not currently reachable
by the bug — its `set` is an idempotent overwrite — and that it is latched so the
two stores do not diverge.

**Verify**: `pnpm typecheck && pnpm test && pnpm check && pnpm build` → exit 0.

### Step 6: Confirm the real behaviour changed

The unit tests cover the helper. This step checks the thing that actually
mattered.

Run the app in **development**, where Strict Mode double-invokes the effect:

```
pnpm dev
```

Load a CSV, then reload with devtools open. **Before this fix**, the console
shows the hydration path running twice. After it, once.

If you can, use the technique plan 018's suite used to make this countable —
instrument `indexedDB.open` from the console and compare counts, or simply count
the duplicate "Couldn't read … saved file" toasts, which is what made the bug
visible in the first place: **2 identical toasts before, 1 after.**

Report what you observed. If you cannot run a browser, say so plainly rather than
claiming it.

**Verify**: `pnpm test:e2e` → the 3 existing specs still pass. They run against
the production build, where this bug never fired, so they should be unaffected —
confirming that is the point.

## Test plan

New file `src/lib/once.test.ts`, no mocks, no fake timers:

| # | Case | Assertion |
|---|---|---|
| 1 | Two concurrent calls | The wrapped function runs **once**; both callers get the same resolved value |
| 2 | Many concurrent calls | Still one invocation — proves it is not just a two-caller special case |
| 3 | Sequential calls, after the first settles | Runs **again** — the latch releases, matching `schemaReady` |
| 4 | Rejection | **Every** concurrent caller rejects |
| 5 | Rejection, then retry | A later call runs again rather than replaying a cached failure |
| 6 | Callers share identity | The value each concurrent caller receives is the same object reference |

Use a counter incremented inside the wrapped function and a manually-resolved
promise to hold it open — no timers.

Case 1 is the one that would fail against today's boolean guard, so it is the
regression test. **Write it before Step 4 and confirm it passes against the new
helper**; it is testing the helper, not the store, so it will not go red against
the old store code — say so in your report rather than implying it did.

Existing tests that must keep passing unchanged: all 244, plus plan 018's 3 E2E
specs.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; 244 pre-existing tests pass, plus at least 6 new
- [ ] `pnpm check` exits 0 with exactly 5 warnings, all in
      `src/lib/google-sheet.ts`
- [ ] `pnpm build` exits 0
- [ ] `pnpm test:e2e` — the 3 existing specs still pass
- [ ] `grep -c "once" src/stores/dataset.ts` and `src/stores/prices.ts` each show
      the helper imported and applied
- [ ] `git diff 776deaf..HEAD -- src/lib/storage.ts` shows **no changes**
- [ ] `git diff 776deaf..HEAD -- src/components/store-hydrator.tsx next.config.ts`
      shows **no changes** — Strict Mode was not disabled
- [ ] `git diff 776deaf..HEAD -- e2e/ playwright.config.ts` shows **no changes**
- [ ] `git status --short` lists only the four in-scope files
- [ ] `plans/README.md` status row for 019 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the 244 unit tests, or any of the 3 E2E specs, fails.
- You conclude the fix requires changing the `raced` branch, `saveSources`,
  `updateSources`, or the storage schema. It does not.
- You find yourself about to set `reactStrictMode: false`, remove
  `StoreHydrator`'s effect, or add a `useRef` guard in the component. All three
  hide the symptom and leave the store unsafe. If you believe one is right,
  report why rather than doing it.
- Applying the latch to `prices.ts` needs more than the same three lines.
- You discover a **second** production caller of either `hydrate`. That would
  mean the bug is live in production, not dev-only, which changes this plan's
  priority — report it immediately.

## Maintenance notes

For whoever owns this next:

- **The rule**: a boolean "already done" flag is not a concurrency guard when
  anything is awaited between the check and the write. `src/lib/storage.ts`'s
  `schemaReady` had it right; the stores did not. `src/lib/once.ts` now makes the
  correct thing the easy thing.
- **Strict Mode was the messenger, not the problem.** It surfaced a real defect
  in three lines of store code. Anyone tempted to disable it to quiet a
  double-invocation should read this plan first.
- **Deliberately not added: an E2E spec for this.** Reproducing it needs two
  concurrent `hydrate` calls, and the store is not exposed on `window` — reaching
  it would mean changing `src/` to expose internals purely for a test, which plan
  018 explicitly declined to do for the same reason. The helper's unit tests carry
  the correctness argument; the dev-mode observation in Step 6 carries the
  behavioural one.
- **What a reviewer should scrutinise**: that nothing inside the `try` block of
  either `hydrate` changed; that Strict Mode is still on; that the latch releases
  on settle so a failure is retryable; and that the executor reports what they
  actually observed in Step 6 rather than asserting the toast count.
