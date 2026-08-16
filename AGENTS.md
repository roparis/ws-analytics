<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ws-analytics

A local-first browser app that parses a Wealthsimple activities CSV and
derives cash flow, positions, analytics and projections from it — nothing
uploaded, nothing computed on a server, except the optional live-pricing path
below. It runs on real personal money data; arithmetic correctness is the
product.

## Read this first

`docs/wealthsimple-csv-format.md` is the source of truth for how this app
reads the export — 530 lines derived empirically from a real file, and most
of them exist because the intuitive reading is wrong. Read it before touching
`src/lib/wealthsimple.ts`, `positions.ts`, `metrics.ts`, or `merge.ts`.
`docs/yahoo-pricing-poc.md` covers the live-pricing path.

## Rules that are not obvious

Each of these is a case where reasoning from the intuitive reading gets the
wrong answer. The doc section is where the evidence lives; when this summary
and the doc disagree, the doc wins.

1. **Every monetary value is already CAD.** The `, FX Rate: 1.36xx` marker in
   `description` is informational and must never multiply a value — its only
   legitimate use is as the *listing* signal (US-listed vs TSX). Applying it
   inflates every US-listed figure by roughly 38%. (§4, §4.1)
2. **`quantity` is dual-purpose**: a share count on `Trade` /
   `LegacyCorporateAction`, a dollar amount on everything else. Sum it only
   within one `symbol`, restricted to those two types — summing across types
   produces a number with no meaning. (§2.2)
3. **Take the calendar date by slicing the first ten characters, never by
   parsing to a `Date`.** Parsing pushes any transaction after 20:00 local
   onto the next day, silently moving trades between months and tax years.
   (§1.3)
4. **Never de-duplicate rows by content.** The export has no per-row id and
   genuinely identical rows recur; de-duplicating deletes real activity and
   breaks every total. (§7)
5. **Group by `symbol`, never by `name`; key accounts on `account_id`, never
   `account_type`.** Two symbols can share a `name` across a ticker change,
   and three TFSAs share the label `TFSA`. (§2.5, §5)
6. **`net_cash_amount` is the only money column that generalises**, and on a
   trade it already includes commission: `net_cash == -(qty × price) -
   commission`, ±2¢ (I1). Reading `unit_price` instead drops the commission.
   (§2.1, §2.3)
7. **Rows within a date are not in execution order.** Never compute a
   row-by-row running balance — a naive one goes negative mid-day on real
   rebalance days. (§1.2)
8. **`Interest` (earned, +) and `InterestCharged` (paid, −) are opposites;
   `AdministrativePayment` is money coming in** and sits in `COST_TYPES`
   deliberately, so a positive refund lowers net cost. Match description
   *templates*, never substrings — `includes("Deposit")` would misclassify
   payroll's "Direct deposit received". (§3.1)

## What the export does not contain

No prices, no position snapshot, no ACB, no security metadata beyond ticker
and name. From the file alone the honest ceiling is cash flow, contributions,
income, costs, trade activity, and share counts — nothing here should ever
imply a portfolio value without an external price source. (§8)

## Where code goes

`src/lib/` never imports from `src/components/`, `src/stores/`, `src/app/`,
or `src/hooks/` — the dependency runs one way. Nothing in `src/lib/` imports
React; it is pure functions over `Activity[]` / `PositionsReport`, and the
handful of modules that touch the outside world say so in their own name:
`storage.ts` (IndexedDB), `pdf.ts` and `clipboard.ts` (DOM), `live-prices.ts`
(`fetch`). New derivation logic goes in `src/lib/`; UI in `src/components/`;
cross-page state in `src/stores/` (four Zustand stores, no middleware); the
only server code is `src/app/api/prices/`.

Derived figures delegate rather than re-derive, so two surfaces can't
disagree — see `metrics.ts:836-837`, `:182-184`, and `price-history.ts:19-22`.

## Tests

Colocated as `src/lib/*.test.ts`, `environment: "node"` (`vitest.config.mts`
— no jsdom, no DOM in the suite under test). No mocks and no fake timers
anywhere; injectable parameters (`now`, `asOf`) are the seam instead.
Components/JSX are deliberately untested — the money-critical code is
`merge.ts` and `parseActivities`, not JSX — and the data invariants (I1, I2,
I5) run at parse time against the user's real file rather than against
fixtures, because asserting them over hand-built fixtures would only test the
fixtures (§9).

## The live-pricing constraints

- **Only ticker symbols cross the wire** — never a share count, an account
  id, a book cost, or a file. POST keeps tickers out of URLs and access logs.
  (`live-prices.ts:15-17`, §1)
- **Concurrency stays at 4** (`history/route.ts:29-32`): raising it is how an
  unofficial API starts refusing.
- **The Google Sheets export path is deliberately kept** — it needs no
  server, survives Yahoo changing its API, and its ticker column is editable
  when a guess is wrong. Deleting it is a regression, not a cleanup. (§2)
- **A ticker is a guess and stays a guess.** An unknown ticker is a miss, not
  a zero — the holding falls back to book cost and the UI names it.
- **`serverExternalPackages` for `yahoo-finance2`** in `next.config.ts` is
  deliberate; its `dnt`-generated entry point breaks a production bundle
  otherwise. Read the comment there before touching it.

## Commands and conventions

`pnpm dev`, `pnpm build`, `pnpm start`, `pnpm check` (Biome — not
ESLint/Prettier), `pnpm check:write`, `pnpm typecheck`, `pnpm test`,
`pnpm test:watch`, `pnpm test:e2e` (Playwright). Package manager pinned at
`pnpm@10.14.0`.

Commit messages are imperative, sentence case, descriptive prose — no
conventional-commit prefix, no ticket id in the subject, no trailing period.
Tabs for indentation everywhere, enforced by Biome.
