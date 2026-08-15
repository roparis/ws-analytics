# Plan 001: Run the existing checks automatically on every push and pull request

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1d09a07..HEAD -- package.json .github/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `1d09a07`, 2026-08-15 (revised — see "A trap this plan
  originally walked into" below)

## Why this matters

This repository has a lint script, a typecheck script, a test suite of 228
tests, and a production build — and nothing runs any of them except a human who
remembers to. `git log` shows twelve merged pull requests, none of them gated.
It also shows two `Merge origin/main into <branch>` commits, which is exactly
the pattern where a semantic conflict passes locally on both sides and lands
broken on `main`.

Every other plan in this directory is a one-time patch with nothing preventing
regression. This plan is the thing that makes the others stick, which is why it
runs first.

## Current state

- `package.json` — defines every command CI needs. There is no CI configuration
  anywhere: `.github/` does not exist, and neither does `.gitlab-ci.yml`.

Verified excerpt from `package.json:5-14`:

```json
"scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "check": "biome check .",
    "check:write": "biome check --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
},
```

`package.json:46` pins the package manager:

```json
"packageManager": "pnpm@10.14.0"
```

`package.json` devDependencies pin `"@types/node": "^20"`, so Node 20 is the
floor. Next.js 16 and Vitest 4 both run on Node 20.

**Gate status on a clean checkout**, measured in a fresh worktree with no
`node_modules` and no `.next/`:

| Command | Exit code on a clean checkout |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `pnpm check` | 0 (prints 5 warnings, still exits 0) |
| `pnpm typecheck` | **2 — fails. See the trap below.** |
| `pnpm test` | 0 — 13 files, 228 tests |
| `pnpm build` | 0 |

`pnpm check` emitting warnings while exiting 0 is expected and is **not** a
failure. Do not add `--error-on-warnings` or any equivalent flag; making the
build red on day one is out of scope and would be a behaviour change nobody
asked for. All 5 warnings are `noUnusedVariables` in `src/lib/google-sheet.ts`
at lines 614, 707, 715, 721 and 727.

### A trap this plan originally walked into

The first version of this plan claimed all gates passed and was wrong, because
the measurement was taken in a working directory that already had a `.next/`
from a previous `next dev`. On a genuinely clean checkout — which is exactly
what GitHub Actions does — `pnpm typecheck` fails:

```
src/app/accounts/[type]/[accountId]/page.tsx(8,9): error TS2304: Cannot find name 'PageProps'.
src/app/accounts/[type]/page.tsx(7,48): error TS2304: Cannot find name 'PageProps'.
src/app/layout.tsx(25,50): error TS2304: Cannot find name 'LayoutProps'.
```

`PageProps` and `LayoutProps` are Next.js 16 **generated** ambient types.
`tsconfig.json` includes them:

```json
	"include": [
		"next-env.d.ts",
		"**/*.ts",
		"**/*.tsx",
		".next/types/**/*.ts",
		".next/dev/types/**/*.ts",
		"**/*.mts"
	],
```

…and both sources are gitignored — `.gitignore:17` (`/.next/`) and
`.gitignore:45` (`next-env.d.ts`) — so neither exists until something generates
them. `next dev`, `next build` and `next typegen` all do.

**Verified fix**: `next typegen` alone is enough, and it is fast. From a clean
worktree, `next typegen && tsc --noEmit` exits 0. Step 2 below makes
`pnpm typecheck` self-provisioning so this is fixed for CI, for `pnpm verify`,
and for any human's first clone in one line — rather than papering over it with
a CI-only step that leaves a fresh clone broken.

`pnpm build` was **not** measured during planning. `docs/yahoo-pricing-poc.md`
§6 item 3 records it as verified clean on an earlier branch:

> "Done on `WSA-007`: `pnpm build` compiles and prerenders clean, with both API
> routes served on demand. `serverExternalPackages` is set for `yahoo-finance2`
> in `next.config.ts` because its dnt-generated entry point pulls a
> `createRequire` polyfill that bundlers dislike."

That workaround in `next.config.ts` exists *because* a production build broke
once, and nothing currently enforces that it stays fixed — which is precisely
why `build` belongs in this workflow. See Step 2 for what to do if it fails.

### Repo conventions to match

- Indentation is **tabs**, everywhere, enforced by Biome (`biome.jsonc`).
  YAML cannot use tabs — use 2 spaces in the workflow file only. This is not an
  inconsistency; YAML forbids tabs.
- Commit messages are imperative, sentence-case, descriptive prose. Real
  examples from `git log`:
  - `Wrap the activities table in a card, like every other table`
  - `Leave margin out of the analytics page`
  - `Value every year against the prices it closed at`

  They are **not** conventional commits. Do not write `feat:` or `chore:`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Lint | `pnpm check` | exit 0 (warnings are fine) |
| Typecheck | `pnpm typecheck` | exit 0 **after Step 2**; fails before it |
| Tests | `pnpm test` | exit 0, 13 files / 228 tests pass |
| Build | `pnpm build` | exit 0 |
| Generate route types | `pnpm exec next typegen` | exit 0, "Types generated successfully" |
| Lint the workflow | `pnpm check` | exit 0 (Biome ignores `.github/`) |

## Scope

**In scope** (the only files you should create or modify):
- `.github/workflows/ci.yml` (create)
- `package.json` — **only** the two script changes in Steps 2 and 4: making
  `typecheck` self-provisioning, and adding a `verify` script. Change nothing
  else in this file — in particular, do not reorder, add, remove, or re-version
  any dependency.

**Out of scope** (do NOT touch, even though they look related):
- The 5 Biome warnings in `src/lib/google-sheet.ts`. They are unused variables
  and they are real, but fixing them is a separate change and would make this
  diff impossible to review as "added CI".
- `biome.jsonc` — do not tighten any rule, do not promote warnings to errors.
- Any source file under `src/`. If CI fails on a source file, that is a STOP
  condition, not an invitation to fix the source.
- Branch protection settings, required-checks configuration, release
  automation, publishing, deployment, caching beyond what `pnpm/action-setup`
  and `actions/setup-node` provide out of the box.
- Adding a coverage provider. Deliberately deferred — see Maintenance notes.

## Git workflow

- Branch: `advisor/001-ci-workflow`
- One commit is fine for this plan. Message, matching repo style:
  `Run the checks on every push instead of trusting memory`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Create the workflow file

Create `.github/workflows/ci.yml` with the content below. Use 2-space
indentation (YAML forbids tabs).

The step order is deliberate: cheapest and most likely to fail first, so a
broken build reports in seconds rather than minutes.

```yaml
name: CI

on:
  push:
    branches: ["**"]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Lint and format check
        run: pnpm check

      - name: Typecheck
        run: pnpm typecheck

      - name: Tests
        run: pnpm test

      - name: Production build
        run: pnpm build
```

Notes on choices you should not change without reporting back:

- `pnpm/action-setup@v4` with no `version` input reads the `packageManager`
  field in `package.json` (`pnpm@10.14.0`). Do not hard-code a pnpm version
  here — it would drift from that field.
- `cache: pnpm` in `setup-node` requires `pnpm/action-setup` to run **before**
  it. Keep that order.
- `--frozen-lockfile` makes CI fail if `pnpm-lock.yaml` disagrees with
  `package.json`, which is a real class of bug worth catching.

**Verify**: `test -f .github/workflows/ci.yml && echo OK` → prints `OK`

**Verify**: `pnpm check` → exit 0. (Biome reads `.gitignore` via
`biome.jsonc`'s `vcs.useIgnoreFile`, and does not lint YAML; this confirms you
did not accidentally break formatting elsewhere.)

### Step 2: Make `pnpm typecheck` work on a clean checkout

Read "A trap this plan originally walked into" above before doing this — it
explains why the change is necessary and why it goes in the script rather than
in the workflow.

In `package.json`, change the `typecheck` script so it generates the Next.js
route types before running `tsc`:

```json
"typecheck": "next typegen && tsc --noEmit"
```

`next` resolves from `node_modules/.bin` inside a script, so no `pnpm exec`
prefix is needed. Keep the file's existing tab indentation.

This is the one place this plan modifies an existing script, and it is
deliberate. The alternative — adding a typegen step to the workflow only —
would leave `pnpm typecheck` broken for anyone running it on a fresh clone,
which is the actual root problem.

**Verify**: `pnpm typecheck` → exit 0.

**Verify** it works from genuinely nothing, which is what CI does:

```bash
rm -rf .next next-env.d.ts && pnpm typecheck
```
→ exit 0. This is the load-bearing check for this step. If it fails, STOP.

### Step 3: Confirm every gate the workflow runs actually passes locally

Run each command the workflow runs, in the same order, and record the exit
code. This is the whole point of the step — do not skip it because the workflow
"looks right".

```bash
pnpm install --frozen-lockfile && pnpm check && pnpm typecheck && pnpm test && pnpm build
```

**Verify**: the chained command exits 0.

Expected along the way: `pnpm check` prints 5 warnings and exits 0; `pnpm test`
reports `Test Files 13 passed (13)` and `Tests 228 passed (228)`.

**If `pnpm build` fails**: STOP and report. Do not remove the build step from
the workflow to make it pass, and do not modify `next.config.ts` or any source
file. A failing production build is a genuine finding that the operator needs
to see, and it is exactly what this plan exists to surface.

**If `pnpm install --frozen-lockfile` fails**: STOP and report. It means
`pnpm-lock.yaml` is out of sync with `package.json`. Do not run a plain
`pnpm install` to "fix" it — that would rewrite the lockfile and hide the
problem this plan is meant to expose.

### Step 4: Add a single local `verify` script

So a contributor (and future plans in this directory) can run the same gates
locally with one command.

In `package.json`, add exactly one line to `scripts`, after `"test:watch"`:

```json
"verify": "pnpm check && pnpm typecheck && pnpm test"
```

Note this deliberately excludes `pnpm build` — it is slow, and the point of
`verify` is a fast pre-push loop. CI still runs the build. It picks up the
typegen fix for free, because `typecheck` now provides it.

Keep the file's existing tab indentation. Change nothing else in
`package.json` — in particular, do not reorder, add, remove, or re-version any
dependency.

**Verify**: `pnpm verify` → exit 0.

**Verify**: `git diff --stat package.json` → shows exactly 1 file changed, 2
insertions, 1 deletion (the `typecheck` line from Step 2 is rewritten, and the
`verify` line is added).

## Test plan

No new unit tests. This plan adds no application code — its correctness is
established by the gates themselves running and passing.

The verification that matters is Step 3: every command the workflow runs must
pass locally first, **from a clean state**, so the first CI run is green rather
than a debugging session. The `rm -rf .next next-env.d.ts` check in Step 2 is
what makes "clean" real rather than assumed — a leftover `.next/` from a
previous `next dev` is precisely what hid this problem the first time.

If the operator can push the branch, the real end-to-end check is that the
`CI / verify` job appears and passes on the pull request. Do not push unless
instructed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.github/workflows/ci.yml` exists and is valid YAML
      (`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo OK` → prints `OK`)
- [ ] `pnpm check` exits 0
- [ ] `rm -rf .next next-env.d.ts && pnpm typecheck` exits 0 — **from clean**,
      which is the criterion the first version of this plan was missing
- [ ] `pnpm test` exits 0 with 228 tests passing across 13 files
- [ ] `pnpm build` exits 0
- [ ] `pnpm verify` exits 0
- [ ] `git status --short` shows only `.github/workflows/ci.yml` (new) and
      `package.json` (modified). Nothing under `src/` is modified.
- [ ] `git diff package.json` shows exactly two changes: the rewritten
      `typecheck` script and the added `verify` script. No dependency moved.
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pnpm build` fails. Report the full error output. Do not delete the build
  step, do not edit `next.config.ts`, do not edit any source file.
- `pnpm install --frozen-lockfile` fails because the lockfile is out of sync.
- `pnpm test` reports anything other than 228 passing tests in 13 files. A
  different count means the codebase drifted from this plan's baseline.
- `pnpm check` exits non-zero (today it exits 0 with 5 warnings). A non-zero
  exit means new lint errors landed and they are not yours to fix here.
- `pnpm typecheck` still fails **after** Step 2's script change. Report the
  errors — it would mean there is a second cause beyond the missing generated
  types, and that is a genuine finding rather than something to work around.
- You find yourself wanting to modify a file under `src/` for any reason.
- You find yourself wanting to add a `next build` step *before* `typecheck` in
  the workflow to make the types appear. That inverts the deliberate
  cheapest-first ordering and hides a type error behind a slow build. Step 2 is
  the intended fix.

## Maintenance notes

For whoever owns this next:

- **The generated-types trap is the thing to remember.** `pnpm typecheck` used
  to pass locally and fail on a clean checkout, because `tsconfig.json` includes
  `next-env.d.ts` and `.next/types/**` and both are gitignored. Anything that
  runs `tsc` outside a directory where `next dev` has run needs `next typegen`
  first. That is now baked into the `typecheck` script, so it should not recur —
  but if someone "simplifies" that script back to a bare `tsc --noEmit`, CI goes
  red on the next clean run and the cause will not be obvious.
- **Warnings vs. errors.** `pnpm check` currently exits 0 with 5 unused-variable
  warnings in `src/lib/google-sheet.ts`. If someone later wants CI to fail on
  warnings, those five must be cleaned up first, in their own change —
  `plans/016` does exactly that.
- **The build step is the load-bearing one.** `next.config.ts` carries a
  `serverExternalPackages` workaround for `yahoo-finance2` whose whole
  justification is that the package survives dev and falls over in a production
  build. `pnpm check` and `pnpm test` would never catch a regression there.
- **Coverage was deliberately not added.** A percentage would mostly restate
  what is already known by name: `src/lib/merge.ts` and `parseActivities` are
  the dangerous untested paths, and plan 002 addresses the first of those.
  Add a provider only if someone intends to act on the number.
- **What a reviewer should scrutinise**: that no source file is in the diff,
  that no Biome rule was tightened, and that the pnpm version is read from
  `packageManager` rather than pinned in the workflow.
