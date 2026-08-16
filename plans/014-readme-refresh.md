# Plan 014: Make the README describe the app that exists

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d1d2640..HEAD -- README.md package.json src/app/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

For an open-source repo the README is the product page, and this one describes
an earlier, smaller app. It is wrong in four ways, and two of them are the kind
the audit playbook rates as worse than missing documentation — **actively
misleading**:

- It names **TanStack Table** as the table library. It appears nowhere in the
  repo. A contributor goes looking for column definitions and cannot tell
  whether they are in the wrong file or the wrong project.
- It names **html2canvas** for PDF export. That dependency was removed in commit
  `f858302` *because it threw on the app's `oklch()` theme tokens and every
  export failed before it drew a pixel*. Anyone trusting the README would
  reintroduce a known bug.
- It scopes the entire privacy caveat to **branch `WSA-006`** — a branch name
  that means nothing to a reader, attached to a "proof of concept" that has
  since grown a second route and moved into the global sidebar on every page.
  The precise claim it makes is still accurate; the framing is not. An accurate
  promise nobody can parse is not a promise.
- Its **feature list predates** the analytics page, the projections, the merge
  review, the account pages, the timeline, and the eight-tab spreadsheet export.
  It undersells the app to the point where a visitor would not discover them.

## Current state

### The four defects, verified

**Defect 1 — the privacy caveat.** `README.md:5-7`:

```markdown
This repository contains the self-hosted core: your data is parsed and analysed in the browser, with no external database and no file ever uploaded.

> **On this branch (`WSA-006`)** there is one exception, and it is a proof of concept: live pricing sends *ticker symbols* — never share counts, amounts, or accounts — through this app's own server to Yahoo Finance. See [docs/yahoo-pricing-poc.md](docs/yahoo-pricing-poc.md). Without it, the app still has no backend at all.
```

The factual claim is **correct** — verified: `src/lib/live-prices.ts:15-17`
documents that a request carries "never a share count, an account id, a book
cost, or a file", and the request body is built at `:163-190` from symbols and
two dates only. Only the branch-scoping and the "proof of concept" framing are
stale.

**Defect 2 — the feature list.** `README.md:22-29` lists eight features. Two are
wrong and most of the app is missing:

- "Sortable, paginated data table" — `src/components/data-table.tsx` is a
  scroll-triggered batch reveal. There is no pagination.
- "Auto-generated chart visualization with column selectors" — no column
  selector exists; commit `a41a001` is titled "Drop the activity chart".

Missing entirely: the analytics page (`src/app/analytics/page.tsx`), retirement
projections (`src/lib/projection.ts`, `src/stores/projection.ts`), the multi-file
merge and coverage review (`src/app/merge/page.tsx`), per-account and
per-account-type pages (`src/app/accounts/[type]/[accountId]/page.tsx`), the
timeline (`src/components/timeline/`), the eight-tab XLSX/Sheets workbook
(`src/lib/google-sheet.ts`, `src/lib/xlsx.ts`), and position tracking with
average-cost basis and realised P&L (`src/lib/positions.ts`).

`README.md:3` still calls the app "A lightweight open-source browser app for
exploring Wealthsimple CSV data with charts, tables, and PDF export." It is now
a personal-finance analytics tool.

**Defect 3 — TanStack Table.** `README.md:91`:

```markdown
- TanStack Table for data tables
```

Verified: `grep -rni "tanstack" src/ package.json` returns **nothing**. The table
is hand-rolled in `src/components/data-table.tsx`.

**Defect 4 — html2canvas.** `README.md:94`:

```markdown
- jsPDF + html2canvas for PDF export
```

Verified: `src/lib/pdf.ts:7` imports `html2canvas-pro`, and `package.json:19`
lists `"html2canvas-pro": "^2.3.3"` with no plain `html2canvas`. The file opens
with a six-line comment explaining exactly why the swap was necessary — worth
reading before you edit this line.

**Also stale**: `README.md:99-103` ("Project structure") omits `src/app/api/` —
the one directory whose existence changes the app's privacy shape.

### The replacement material already exists

`docs/yahoo-pricing-poc.md` §1 contains a table that says precisely what does and
does not cross the wire, in four rows. **Lift it rather than writing a new one** —
it is already accurate and already reviewed.

Its §1 also states the deployment distinction plainly: run locally, the server
is on the same machine as the browser; deployed somewhere shared, the operator
can see which symbols were looked up, though never how many shares or in what
account.

### What the app actually does — the route list

```
src/app/page.tsx                                  timeline
src/app/dashboard/page.tsx                        dashboard
src/app/analytics/page.tsx                        year-by-year analytics + projections
src/app/investment/page.tsx                       holdings, positions, exports
src/app/merge/page.tsx                            multi-file merge + coverage review
src/app/accounts/[type]/page.tsx                  per-account-type detail
src/app/accounts/[type]/[accountId]/page.tsx      per-account detail
src/app/month/[month]/page.tsx                    month detail
src/app/api/prices/route.ts                       live quotes (server)
src/app/api/prices/history/route.ts               monthly history (server)
```

Build the feature list from this, not from the existing one.

### Conventions

- Markdown, prose, declarative. Match the existing README's voice — it is
  well-written; the content is what is stale.
- Commit style: imperative, sentence case, no conventional-commit prefix.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Confirm a claim | `grep -rni "<term>" src/ package.json` | as stated below |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings) |
| Tests | `pnpm test` | exit 0, 228 pass |

## Scope

**In scope**:
- `README.md`

**Out of scope** (do NOT touch):
- `docs/yahoo-pricing-poc.md`. Its §6 item 4 lists "A decision about the README"
  as an open item, and this plan closes it — but updating the POC doc's own
  status line is a separate judgement about whether the feature has shipped, and
  that is the maintainer's call, not the executor's. **Note it in your report.**
- `docs/wealthsimple-csv-format.md`.
- `AGENTS.md` — `plans/013` owns that.
- Any file under `src/`. If a README claim is wrong, the README is what changes.
- `package.json` — including moving the misplaced `shadcn` dependency, which is
  `plans/016`'s.
- Adding badges, a screenshot, or a licence section. Out of scope; the LICENSE
  file already exists.

## Git workflow

- Branch: `advisor/014-readme-refresh`
- Commit message in repo style (imperative, sentence-case, no
  conventional-commit prefix):
  `Describe the app this became, not the one it started as`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Verify each defect before fixing it

Do not take this plan's word for the four claims. Run:

```bash
grep -rni "tanstack" src/ package.json
```
**Expect**: no matches.

```bash
grep -n "html2canvas" package.json src/lib/pdf.ts
```
**Expect**: `html2canvas-pro` only, in both files.

```bash
git branch --show-current
```
**Expect**: not `WSA-006`.

```bash
ls src/app/analytics src/app/merge src/app/accounts
```
**Expect**: all exist, none mentioned in the README's feature list.

**If any expectation does not hold, STOP** — the README may have been fixed, or
the code may have changed.

### Step 2: Rewrite the opening and the privacy statement

Replace `README.md:3` with a description of what the app is now — a local-first
tool for analysing a Wealthsimple activities export: cash flow, holdings,
per-account and per-year analytics, projections and exports.

Replace the `WSA-006` blockquote at `:7` with an **unconditional** statement,
not one scoped to a branch. It should say, plainly:

- The default state is fully local — the CSV is parsed in the browser and never
  uploaded.
- Live pricing is **opt-in**, behind a button.
- What crosses the wire when you use it: a list of ticker symbols, and nothing
  else — no share counts, no amounts, no account identifiers, no file contents.
- Self-hosted, that server is your own machine. Deployed somewhere shared, the
  operator can see which symbols were looked up — never how many shares or in
  what account.
- A link to `docs/yahoo-pricing-poc.md` for the detail.

Lift the four-row table from `docs/yahoo-pricing-poc.md` §1 rather than writing
a new one.

**Do not overstate.** The claim that only symbols cross the wire is verified and
true; do not soften it into vagueness, and do not strengthen it into "nothing
ever leaves your machine", which the live-pricing path makes false.

**Verify**: `grep -n "WSA-006" README.md` → no matches.

### Step 3: Rebuild the feature list from the routes

Replace `README.md:22-29` with a list derived from the route table in "Current
state". Cover at minimum: CSV upload and in-browser parsing; the timeline and
dashboard; per-account and per-account-type pages; year-by-year analytics with
unrealised gain; retirement projections; multi-file merge with a coverage
review; holdings with average-cost basis and realised P&L; live pricing (opt-in)
or the Google Sheets round trip; the XLSX/Sheets workbook export; PDF export;
dark/light theme.

Remove the two false entries ("paginated", "column selectors").

**Verify**: `grep -n "paginated\|column selector" README.md` → no matches.

### Step 4: Fix the tech stack

- Delete the TanStack Table line, or replace it with an accurate description of
  the hand-rolled table in `src/components/data-table.tsx`.
- Change `html2canvas` to `html2canvas-pro`. Consider a parenthetical pointing at
  `src/lib/pdf.ts` for why — that comment is the reason the swap happened, and a
  future reader tempted to "simplify back" needs it.

Check the rest of the list against `package.json` while you are here. Every other
entry was correct at the time of writing, but verify rather than assume.

**Verify**: `grep -ni "tanstack" README.md` → no matches.

**Verify**: `grep -n "html2canvas" README.md` → shows `html2canvas-pro` only.

### Step 5: Fix the project structure section

Add `src/app/api/` to the list at `README.md:99-103`, described for what it is:
the only server-side code in the app, serving the live-pricing routes. That is
the directory whose existence changes the privacy story, so omitting it while
making a privacy claim two screens earlier is the worst omission in the section.

**Verify**: `grep -n "src/app/api" README.md` → at least one match.

### Step 6: Re-read the whole file

Read `README.md` start to finish. The Quick start, the export instructions, the
Development and Contributing sections were accurate at the time of writing —
confirm they still are, and fix anything you find, but do not restructure the
document. This is a correction, not a rewrite.

**Verify**: `pnpm check && pnpm typecheck && pnpm test` → all exit 0, 228 tests
pass. (This plan changes no code; movement means something is wrong.)

**Verify**: `git status --short` → only `README.md`.

## Test plan

No automated tests — this plan changes documentation only.

The verification is Step 1's greps, repeated as done criteria: every claim the
README makes about a dependency must be checkable against `package.json` or
`src/`, and every feature it lists must correspond to a route or module that
exists.

If the operator can run the app, a useful manual check: follow the Quick start
from a clean clone and confirm the steps work as written. Report the outcome;
do not treat it as a gate.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -ni "tanstack" README.md` returns no matches
- [ ] `grep -n "html2canvas" README.md` shows only `html2canvas-pro`
- [ ] `grep -n "WSA-006" README.md` returns no matches
- [ ] `grep -n "paginated\|column selector" README.md` returns no matches
- [ ] `grep -n "src/app/api" README.md` returns at least one match
- [ ] `grep -ci "analytics" README.md` and `grep -ci "projection" README.md` and
      `grep -ci "merge" README.md` each return at least 1
- [ ] The privacy statement names ticker symbols as the only thing that crosses
      the wire, and is not scoped to a branch
- [ ] `pnpm check && pnpm typecheck && pnpm test` all exit 0, 228 tests pass
- [ ] `git status --short` lists only `README.md`
- [ ] `plans/README.md` status row for 014 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any Step 1 expectation fails — the README may already be fixed, or the code
  may have moved.
- You find that the privacy claim is **not** accurate against the code — i.e.
  something other than ticker symbols and two dates reaches
  `src/app/api/prices/*`. That would be a serious finding and must be reported
  rather than documented.
- You conclude the README should recommend deploying this publicly, or should
  claim the hosted instance is hardened. It is not — the routes still have no
  rate limiting (`plans/015` addresses that).
  **Note the premise changed**: an earlier revision of this plan told you not to
  resolve the hosting question. It is resolved — `https://ws-analytics.vercel.app`
  has served production since 2026-08-11 and is set as this repository's
  homepage. So the README must describe **both** cases honestly: self-hosted,
  the server is the reader's own machine; on the hosted instance, their ticker
  symbols pass through someone else's deployment. Saying only the first would
  now be misleading.
- You find yourself editing a file under `src/` to make a README claim true.

## Maintenance notes

For whoever owns this next:

- **This closes `docs/yahoo-pricing-poc.md` §6 item 4** ("A decision about the
  README"). Updating that doc's own status line — which still reads "POC on
  `WSA-006`. Works end to end; not yet a decision to ship" — is deliberately left
  out of scope, because whether the feature has *shipped* is a maintainer's
  judgement, not a documentation edit.
- **The hosting question stays open.** The README should describe the
  self-hosted case accurately and state the shared-deployment caveat, without
  resolving whether the app should be hosted. `plans/007` and the POC doc's §6
  track that.
- **The pattern that caused this**: the README was written once and the app kept
  growing. The cheapest guard is to add a line to it whenever a route is added —
  the route list in this plan's "Current state" is the thing that should stay in
  sync.
- **What a reviewer should scrutinise**: that the privacy statement is neither
  softened nor overstated; that no `src/` file is in the diff; and that the
  feature list matches the actual route list rather than an aspirational one.
