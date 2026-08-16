# Plan 013: Give `AGENTS.md` the domain knowledge that makes this repo hard

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d1d2640..HEAD -- AGENTS.md CLAUDE.md docs/`
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

`docs/wealthsimple-csv-format.md` is 530 lines of empirically-derived rules
about how to read a Wealthsimple export, and most of them exist **because the
intuitive reading is wrong**. `AGENTS.md` — the file a coding agent or new
contributor actually reads first — is eight machine-generated lines about
Next.js and contains no pointer to any of it.

The gap has a measurable cost. The single most dangerous rule (the `FX Rate:`
marker is informational and must never multiply a value; doing so inflates every
US-listed figure by roughly 38%) is currently re-explained in **six separate
inline comments** across the codebase, including inside the exported spreadsheet
itself. That is the knowledge being re-litigated at every call site because it is
stated nowhere a reader arrives first.

Someone opening `src/lib/positions.ts`, seeing a `unitPrice` and an FX rate in
the same row, and multiplying them is not being careless. They are reasoning
correctly from wrong premises. This file is what supplies the right ones.

## Current state

### The whole of `AGENTS.md` today

```markdown
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
```

`CLAUDE.md` is a single line: `@AGENTS.md`.

**The `<!-- BEGIN:nextjs-agent-rules -->` / `<!-- END:nextjs-agent-rules -->`
block is machine-managed.** It is written and re-added by `next dev`. Your
content must go **outside** those markers — below the `END` marker — or it will
be clobbered. Do not edit, reorder, or remove the block itself.

### Where the knowledge lives today

- `docs/wealthsimple-csv-format.md` — declared "source of truth for how this app
  interprets the CSV". Numbered sections; §6 lists invariants I1–I10; §10 has
  Fixed and Open lists.
- `docs/yahoo-pricing-poc.md` — records the live-pricing proof of concept, its
  privacy argument (§1), its comparison of the two price paths (§2), and its
  known-open gaps (§6).

**Read both in full before writing.** This plan tells you which rules to include
and why; it does not reproduce their evidence, and your prose should be grounded
in what the docs actually say.

### The eight rules, with citations

Each of these is a case where a competent reader gets it wrong by reasoning
correctly from wrong premises. This is the content of the new section.

| # | Rule | Doc § | Cost of getting it wrong |
|---|---|---|---|
| 1 | Every monetary value is **already CAD**. The `, FX Rate: 1.36xx` marker in `description` is informational — it must never multiply a value. Its only legitimate use is as the *listing* signal (US-listed vs TSX). | §4, §4.1 | Inflates every US-listed figure by ~38% |
| 2 | `quantity` is **dual-purpose**: a share count on `Trade`/`LegacyCorporateAction`, a dollar amount on everything else. Only sum it within one `symbol`, restricted to those two types. | §2.2 | Summing across types produces a number with no meaning |
| 3 | Take the calendar date by **slicing the first ten characters**; never parse to a `Date`. | §1.3 | Silently moves trades between months and tax years |
| 4 | **Never de-duplicate rows by content.** The export has no per-row id and genuinely identical rows recur. | §7 | Deletes real activity and breaks every total |
| 5 | Group by `symbol`, never by `name`; key accounts on `account_id`, never `account_type`. | §2.5, §5 | Silent mis-grouping — three TFSAs share one type label |
| 6 | `net_cash_amount` is the only money column that generalises, and on a trade it **already includes commission** (I1: `net_cash == -(qty × price) - commission`, ±2¢). | §2.1, §2.3 | Reading `unit_price` drops the commission |
| 7 | Rows within a date are **not in execution order**. Never compute a row-by-row running balance. | §1.2 | A naïve running balance goes negative mid-day |
| 8 | `Interest` (earned, +) and `InterestCharged` (paid, −) are opposites; `AdministrativePayment` is money coming **in** and sits in `COST_TYPES` deliberately. Match description **templates**, never substrings. | §3.1 | Sign-flipped income/cost; `includes("Deposit")` misclassifies payroll |

**Evidence these are the right eight** — each is currently restated inline at
the call sites, which is the symptom this plan treats:

- Rule 1: `positions.ts:18-19`, `:96`, `:213-219`, `:249`, `:629-632`, and
  written into the exported workbook at `google-sheet.ts:798` and `:1235`
- Rule 2: `wealthsimple.ts:176-178`, `positions.ts:257-258`
- Rule 3: `wealthsimple.ts:32-36`, `:39-45`; `clipboard.ts:57-61`;
  `market-month.ts:1-23`
- Rule 4: `merge.ts:3-12`
- Rule 5: `positions.ts:22-23`, `:72-73`, `:130`, `:239-247`
- Rule 6: `positions.ts:16-17`, `:86-93`, `:94`, `:629-632`
- Rule 7: `positions.ts:415-432`
- Rule 8: `metrics.ts:50-52`, `:61-66`, `:132`, `:146-155`

### The scope statement worth including

`docs/wealthsimple-csv-format.md` §8 lists what the export does **not** contain —
no prices, no position snapshot, no ACB, no security metadata — and concludes
that the honest ceiling from the file alone is cash flow, contributions, income,
costs, trade activity and share counts. `positions.ts:8-12` and `metrics.ts:814`
both restate it. It belongs in the file as a scope statement, because it is what
stops someone inventing a portfolio value.

### The architectural conventions, verified

- **`src/lib/` never imports from `src/components/`, `src/stores/`, `src/app/`
  or `src/hooks/`.** `grep -rn "@/components\|@/stores\|@/app\|@/hooks" src/lib/`
  returns zero hits. The dependency runs one way.
- **Nothing in `src/lib/` imports React.** Most modules are pure functions over
  plain objects; the impure surface is quarantined and named — `storage.ts`
  (IndexedDB), `pdf.ts` (DOM), `clipboard.ts` (DOM; its header at `:1-4` states
  the convention explicitly), `live-prices.ts` (`fetch`).
- **Where new code goes**: derivation → `src/lib/` as a pure function over
  `Activity[]` / `PositionsReport`; UI → `src/components/`; cross-page state →
  `src/stores/` (four Zustand stores, no middleware); the only server code is
  the two files under `src/app/api/prices/`.
- **The anti-drift convention**: derived figures delegate rather than re-derive,
  so two surfaces cannot disagree. See `metrics.ts:836-837`, `:182-184`, and
  `price-history.ts:19-22`.
- **Tests**: colocated as `src/lib/*.test.ts`, `environment: "node"`, 13 files /
  228 tests in ~260ms. **No mocks, no fake timers anywhere** —
  `grep "vi.mock\|vi.fn\|vi.spyOn\|useFakeTimers"` across all 13 files returns
  zero hits. Injectable parameters (`now`, `asOf`) are the seam instead.
- **Deliberately not tested**: components/JSX (no jsdom — see
  `vitest.config.mts:6` and the rejected-findings list in `plans/README.md`), and
  the data invariants are run at parse time against the user's real file rather
  than asserted over fixtures (`docs/wealthsimple-csv-format.md` §9 argues why).

### The live-pricing constraints

From `docs/yahoo-pricing-poc.md` and the code — a contributor must not casually
change these:

- **Only ticker symbols cross the wire.** Never a share count, an account id, a
  book cost, or a file (`live-prices.ts:15-17`). POST is used so tickers stay
  out of URLs and access logs (§1).
- **Concurrency stays at 4** (`history/route.ts:28-31`): "raising it is how an
  unofficial API starts refusing."
- **The Google Sheets path is deliberately kept** (§2) — it needs no server,
  survives Yahoo changing its API, and its ticker column is editable. Deleting
  it is a regression, not a cleanup.
- **A ticker is a guess and stays a guess.** An unknown ticker is a **miss, not
  a zero** — the holding falls back to book cost and the UI names it.
- **`serverExternalPackages` for `yahoo-finance2`** in `next.config.ts` is
  deliberate; the comment there explains it.

### Commands and conventions

From `package.json:5-13`: `pnpm dev`, `pnpm build`, `pnpm start`, `pnpm check`
(Biome — **not** ESLint/Prettier), `pnpm check:write`, `pnpm typecheck`,
`pnpm test`, `pnpm test:watch`. Package manager pinned at `pnpm@10.14.0`.

Commit style, from `git log`: **imperative, sentence case, descriptive prose, no
conventional-commit prefix, no ticket id in the subject, no trailing period.**
Ticket ids live in the branch name (`WSA-001`…`WSA-009`). Real examples:

- `Measure what you put in, not what you traded`
- `Read a bar's month in the timezone it was stamped in`
- `Leave margin out of the analytics page`

Tabs for indentation, everywhere, enforced by Biome.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings) |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, 228 pass |

## Scope

**In scope**:
- `AGENTS.md` — append a project section **below** the `END:nextjs-agent-rules`
  marker

**Out of scope** (do NOT touch):
- Anything between `<!-- BEGIN:nextjs-agent-rules -->` and
  `<!-- END:nextjs-agent-rules -->`. Machine-managed; `next dev` rewrites it.
- `CLAUDE.md` — its one-line `@AGENTS.md` import already picks up your addition.
- `docs/wealthsimple-csv-format.md` and `docs/yahoo-pricing-poc.md`. This plan
  **points at** them; it does not edit them. (`plans/008` updates the first
  one's Open list for a different reason.)
- Any file under `src/`. In particular, **do not delete the inline comments**
  that restate these rules at the call sites. They are useful where they are;
  the problem is that they were the *only* statement, not that they exist.
- `README.md` — `plans/014` owns that.
- Adding a `CONTRIBUTING.md`, an editorconfig, or pre-commit hooks. Considered
  and rejected in `plans/README.md`.

## Git workflow

- Branch: `advisor/013-agents-domain-knowledge`
- Commit message in repo style (imperative, sentence-case, no
  conventional-commit prefix):
  `Say once what the code keeps re-explaining at every call site`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Read the source material

Read `docs/wealthsimple-csv-format.md` and `docs/yahoo-pricing-poc.md` in full.
You are writing a summary that must not misstate them, and several of the rules
are counter-intuitive enough that a paraphrase from this plan alone would drift.

**Verify**: you can state, in one sentence each, why the FX rate must not be
applied and why `quantity` cannot be summed across activity types.

### Step 2: Append the project section

Add a section **after** the `<!-- END:nextjs-agent-rules -->` line. Structure it
roughly as:

1. **What this project is** — two sentences. A local-first browser app that
   parses a Wealthsimple activities CSV and derives cash flow, positions,
   analytics and projections from it. Real personal money data; arithmetic
   correctness is the product.
2. **Read this first** — point at `docs/wealthsimple-csv-format.md` **by name**
   as the source of truth, and `docs/yahoo-pricing-poc.md` for the pricing path.
3. **Rules that are not obvious** — the eight from the table above, one line
   each, each with its doc section reference and its consequence. Lead with the
   FX rule; it is the most expensive.
4. **What the export does not contain** — the §8 scope statement, so nobody
   invents a portfolio value.
5. **Where code goes** — the layering, the one-way dependency, the pure-`src/lib/`
   convention and its named exceptions.
6. **Tests** — location, environment, the no-mocks convention, and what is
   deliberately untested with the reason.
7. **The live-pricing constraints** — the five bullets above.
8. **Commands and commit style.**

Keep it **tight**. This is a file people read before starting work, not a second
copy of the data dictionary. One line per rule, with a pointer to the section
that carries the evidence. If it runs much past a hundred lines it has stopped
being an orientation and started being a duplicate — and a duplicate will drift
from the doc it duplicates.

Write in the repo's voice: prose, declarative, explaining *why*. Match the tone
of the module headers in `src/lib/merge.ts` and `src/lib/market-month.ts`.

**Verify**: `grep -c "BEGIN:nextjs-agent-rules" AGENTS.md` → `1`, and
`grep -c "END:nextjs-agent-rules" AGENTS.md` → `1`. Both markers intact.

**Verify**: `head -12 AGENTS.md` → the generated block is unchanged, byte for
byte, and your content is not inside it.

### Step 3: Check every citation you wrote

For each doc section and `file:line` you reference, open it and confirm it says
what you claim. A pointer to the wrong section is worse than no pointer — it
sends a reader looking for evidence that is not there, and this file's entire
value is that it can be trusted.

**Verify**: every `§` reference resolves to a real section of the named doc, and
every `file:line` you cite exists.

### Step 4: Confirm nothing else moved

**Verify**: `pnpm check && pnpm typecheck && pnpm test` → all exit 0, 228 tests
pass. (This plan changes no code, so any movement means something is wrong.)

**Verify**: `git status --short` → only `AGENTS.md`.

## Test plan

No automated tests — this plan adds documentation.

The meaningful check is Step 3: every citation verified against the source. A
second reviewer reading only the new section should be able to state the FX rule
and the `quantity` rule correctly without opening the data dictionary, and know
where to go for the evidence.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `AGENTS.md` contains a project section **after** the
      `<!-- END:nextjs-agent-rules -->` marker
- [ ] `grep -c "BEGIN:nextjs-agent-rules" AGENTS.md` returns `1` and
      `grep -c "END:nextjs-agent-rules" AGENTS.md` returns `1`
- [ ] `git diff d1d2640..HEAD -- AGENTS.md | grep "^-"` shows **no deleted
      lines** other than the diff header — the change is purely additive
- [ ] `grep -c "wealthsimple-csv-format.md" AGENTS.md` is at least 1
- [ ] `grep -c "yahoo-pricing-poc.md" AGENTS.md` is at least 1
- [ ] All eight rules from the table are present
- [ ] `pnpm check && pnpm typecheck && pnpm test` all exit 0, 228 tests pass
- [ ] `git status --short` lists only `AGENTS.md`
- [ ] `plans/README.md` status row for 013 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A rule in the table above contradicts what the doc actually says. The doc
  wins — report the discrepancy rather than writing either version.
- You find that a cited `file:line` no longer contains what this plan claims.
  The code may have moved; report it.
- You conclude the section should live in a new file rather than `AGENTS.md`.
  `CLAUDE.md` imports `AGENTS.md` specifically, so a new file would not be read.
- You find yourself editing anything under `src/` — including deleting an inline
  comment because "it's in AGENTS.md now". They stay.
- The generated Next.js block appears to have changed or moved.

## Maintenance notes

For whoever owns this next:

- **This file summarises; the docs carry the evidence.** When the two disagree,
  `docs/wealthsimple-csv-format.md` wins — it says so itself. Anyone changing a
  rule should change the doc first and the summary second.
- **Drift is the risk.** A one-line-per-rule summary with section pointers drifts
  slowly; a full restatement of the evidence would drift fast. That is why this
  plan caps the length.
- **The inline comments stay.** Six restatements of the FX rule is a symptom, but
  deleting them now would remove the warning from exactly the places someone is
  about to make the mistake. If the count grows, that is a signal the summary
  is not being read — not a reason to delete more comments.
- **The generated block will keep reappearing.** `next dev` rewrites it. Never
  put project content inside the markers.
- **What a reviewer should scrutinise**: that the diff is purely additive; that
  every doc section reference resolves; that the FX rule leads; and that the
  section is short enough that someone will actually read it.
