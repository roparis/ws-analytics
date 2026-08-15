# Plan 001: Run the existing checks automatically on every push and pull request

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d1d2640..HEAD -- package.json .github/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

This repository has a lint script, a typecheck script, a test suite of 227
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

**All four gates pass at commit `d1d2640`** — this was measured, not assumed:

| Command | Exit code today |
|---|---|
| `pnpm check` | 0 (prints 5 warnings, still exits 0) |
| `pnpm typecheck` | 0 |
| `pnpm test` | 0 — 13 files, 227 tests |

`pnpm check` emitting warnings while exiting 0 is expected and is **not** a
failure. Do not add `--error-on-warnings` or any equivalent flag; making the
build red on day one is out of scope and would be a behaviour change nobody
asked for.

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
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Tests | `pnpm test` | exit 0, 13 files / 227 tests pass |
| Build | `pnpm build` | exit 0 |
| Lint the workflow | `pnpm check` | exit 0 (Biome ignores `.github/`) |

## Scope

**In scope** (the only files you should create or modify):
- `.github/workflows/ci.yml` (create)
- `package.json` — **only** to add a single `verify` script (Step 3). Change
  nothing else in this file.

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

### Step 2: Confirm every gate the workflow runs actually passes locally

Run each command the workflow runs, in the same order, and record the exit
code. This is the whole point of the step — do not skip it because the workflow
"looks right".

```bash
pnpm install --frozen-lockfile && pnpm check && pnpm typecheck && pnpm test && pnpm build
```

**Verify**: the chained command exits 0.

Expected along the way: `pnpm check` prints 5 warnings and exits 0; `pnpm test`
reports `Test Files 13 passed (13)` and `Tests 227 passed (227)`.

**If `pnpm build` fails**: STOP and report. Do not remove the build step from
the workflow to make it pass, and do not modify `next.config.ts` or any source
file. A failing production build is a genuine finding that the operator needs
to see, and it is exactly what this plan exists to surface.

**If `pnpm install --frozen-lockfile` fails**: STOP and report. It means
`pnpm-lock.yaml` is out of sync with `package.json`. Do not run a plain
`pnpm install` to "fix" it — that would rewrite the lockfile and hide the
problem this plan is meant to expose.

### Step 3: Add a single local `verify` script

So a contributor (and future plans in this directory) can run the same gates
locally with one command.

In `package.json`, add exactly one line to `scripts`, after `"test:watch"`:

```json
"verify": "pnpm check && pnpm typecheck && pnpm test"
```

Note this deliberately excludes `pnpm build` — it is slow, and the point of
`verify` is a fast pre-push loop. CI still runs the build.

Keep the file's existing tab indentation. Change nothing else in
`package.json` — in particular, do not reorder, add, remove, or re-version any
dependency.

**Verify**: `pnpm verify` → exit 0.

**Verify**: `git diff --stat package.json` → shows exactly 1 file changed, 1
insertion, 0 deletions.

## Test plan

No new unit tests. This plan adds no application code — its correctness is
established by the gates themselves running and passing.

The verification that matters is Step 2: every command the workflow runs must
pass locally first, so the first CI run is green rather than a debugging
session.

If the operator can push the branch, the real end-to-end check is that the
`CI / verify` job appears and passes on the pull request. Do not push unless
instructed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.github/workflows/ci.yml` exists and is valid YAML
      (`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo OK` → prints `OK`)
- [ ] `pnpm check` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0 with 227 tests passing across 13 files
- [ ] `pnpm build` exits 0
- [ ] `pnpm verify` exits 0
- [ ] `git status --short` shows only `.github/workflows/ci.yml` (new) and
      `package.json` (modified). Nothing under `src/` is modified.
- [ ] `git diff package.json` shows only the added `verify` script line
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pnpm build` fails. Report the full error output. Do not delete the build
  step, do not edit `next.config.ts`, do not edit any source file.
- `pnpm install --frozen-lockfile` fails because the lockfile is out of sync.
- `pnpm test` reports anything other than 227 passing tests in 13 files. A
  different count means the codebase drifted from this plan's baseline.
- `pnpm check` exits non-zero (today it exits 0 with 5 warnings). A non-zero
  exit means new lint errors landed and they are not yours to fix here.
- You find yourself wanting to modify a file under `src/` for any reason.

## Maintenance notes

For whoever owns this next:

- **Warnings vs. errors.** `pnpm check` currently exits 0 with 5 unused-variable
  warnings in `src/lib/google-sheet.ts`. If someone later wants CI to fail on
  warnings, those five must be cleaned up first, in their own change.
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
