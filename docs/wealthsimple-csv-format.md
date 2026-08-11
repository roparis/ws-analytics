# Wealthsimple activities export — data dictionary

**Status:** source of truth for how this app interprets the CSV.

**Derived from:** a real Wealthsimple activities export — several thousand activity rows across
eight accounts of six account types, spanning roughly four and a half years with no gaps.

**A note on the numbers in this document:** that export is a complete record of one person's
finances, and this is a public repository, so the real figures, account IDs, and holdings are
not reproduced here. Every *rule* below was verified against the real file. Every *number* used
to illustrate a rule is invented — small, round, self-consistent — not sampled from anyone's
actual data. For a runnable example built the same way, see the fixtures in
[`src/lib/wealthsimple.test.ts`](../src/lib/wealthsimple.test.ts).

Wealthsimple publishes no schema for this file. Everything below was derived empirically from
the export and stated with the evidence that supports it. Where a rule was verified against
every row in the dataset, that is stated as such. Where a claim is an inference that a future
export could contradict, it is marked **assumption**.

---

## 1. File shape

| Property | Value |
|---|---|
| Encoding | UTF-8, `\n` line endings |
| Header | Row 1, 15 columns, `snake_case`, stable order |
| Data rows | One activity per row, 15 fields, all quoted-as-needed (RFC 4180) |
| Footer | A blank line, then a single-field row: `"As of <date> <time> GMT-04:00"` |
| Sort order | Grouped by `account_id`; within each block, ascending by `transaction_date` |

### 1.1 The footer is not data

The last two lines of the file are a blank line and an export-timestamp row. A naïve
`header: true` CSV parse yields a bogus final record whose `transaction_date` is
`As of <date> <time> GMT-04:00` and whose other 14 fields are empty.

[wealthsimple.ts:37](../src/lib/wealthsimple.ts:37) already drops it by requiring
`transaction_date` to match `^\d{4}-\d{2}-\d{2}`. Keep that filter — it is the only thing
standing between the footer and a `NaN` in every total.

The timestamp is genuinely useful metadata (it is the "data is current as of" watermark) but
is currently discarded. Capturing it would let the UI say how stale a source is.

### 1.3 The date column was renamed, and gained a time

Exports from 2026 onward replace `transaction_date` with **`effective_at`**, and change its
type from a bare `YYYY-MM-DD` to a full ISO timestamp carrying the account's UTC offset:

```
transaction_date   2026-08-01
effective_at       2026-08-06T15:31:21-04:00
```

[wealthsimple.ts](../src/lib/wealthsimple.ts) accepts either. Two rules matter:

1. **Take the calendar date by slicing the first ten characters, never by parsing to a
   `Date`.** The timestamp already states the date in the account's own timezone, so
   converting to UTC pushes every transaction after 20:00 local onto the following day —
   silently moving trades between months and tax years.
2. **The time is real information.** §1.2 below was written against the old format and still
   applies to it; where `effective_at` is present, same-day activity *can* be ordered by when
   it actually happened, and `positions.ts` does exactly that. The buys-before-sells
   convention is now a fallback for date-only files rather than the only option.

The footer row survives this change and is still dropped by the same leading-date test.

### 1.2 Ordering is day-level only, never intra-day

Rows within a single date are **not** in execution order. On one rebalance day in the reference
export, four buys are listed before the two sells that funded them, driving a naïve running
cash balance to roughly −$340 mid-day before it recovers by end of day.

**Consequence:** never compute or display a row-by-row running balance. Cumulative sums are
only meaningful at end-of-day or coarser boundaries.

---

## 2. Column reference

| # | Column | Type | Populated | Notes |
|---|---|---|---|---|
| 1 | `effective_at` | ISO timestamp | all rows | **Renamed, see §1.3.** Was `transaction_date` (`YYYY-MM-DD`). |
| 2 | `settlement_date` | `YYYY-MM-DD` | trade rows only | Empty for everything else. |
| 3 | `account_id` | string | all rows | Opaque account key. One per account. |
| 4 | `account_type` | string | all rows | Display label. **Not unique per account** — see §5. |
| 5 | `activity_type` | enum | all rows | 10 values. See §3. |
| 6 | `activity_sub_type` | enum | all rows | 15 values, incl. the literal `-` sentinel. |
| 7 | `description` | free text | all rows | Templated per sub-type; carries FX rate and record date. |
| 8 | `direction` | enum | rows with a `symbol` | Only ever `LONG`. Carries no information today. |
| 9 | `symbol` | string | some rows | Set on `Trade`, `Dividend`, `LegacyCorporateAction` only. |
| 10 | `name` | string | same rows as `symbol` | Security long name. **Dirty — see §2.5.** |
| 11 | `currency` | string | almost all rows | Always `CAD`. Account currency, *not* the security's. |
| 12 | `quantity` | decimal | all rows | **Dual-purpose — see §2.2.** |
| 13 | `unit_price` | decimal | trade rows only | **In CAD — see §4.** |
| 14 | `commission` | decimal | trade rows only | Non-zero only on crypto trades in the reference export. |
| 15 | `net_cash_amount` | decimal | almost all rows | Signed cash impact in CAD. The money column. |

### 2.1 `net_cash_amount` is the only money column that generalises

Every row's effect on the account's cash is `net_cash_amount`, signed from the account's point
of view: **positive = cash in, negative = cash out**. This holds for every row that has it. Any
aggregate about money should be built from this column and nothing else.

A small number of rows have it empty (`LegacyCorporateAction` / `NAME_CHANGE`, §3.10). The
parser coerces null → `0`, which is correct: a share-count correction moves no cash.

### 2.2 `quantity` means two different things

This is the single most dangerous column in the file.

| `activity_type` | `quantity` means |
|---|---|
| `Trade` | **Share/unit count**, signed: `+` on BUY, `−` on SELL |
| `LegacyCorporateAction` | Share-count adjustment, signed |
| everything else | **A dollar amount** — exactly equal to `net_cash_amount` |

Verified: for every non-trade, non-corporate-action row, `quantity == net_cash_amount` to the
cent (not merely equal in magnitude — same sign too).

So on a `MoneyMovement` row, `quantity` might be `50.00` *dollars*, not 50 units of anything.
Summing `quantity` across mixed activity types produces a number with no meaning. Only ever
sum `quantity` within a single `symbol`, restricted to `Trade` + `LegacyCorporateAction`.

Sign convention on trades is uniform and was verified exhaustively: every BUY row has
non-negative quantity, and every SELL row has negative quantity.

### 2.3 The trade cash identity

For every trade row, to within two cents:

```
net_cash_amount == -(quantity × unit_price) - commission
```

Two cents, not one: Wealthsimple rounds the cash total independently of the quantity and price
it reports, so a $25 recurring crypto buy books as exactly `-25.00` while
`quantity × unit_price + commission` works out to `-24.99`. A handful of rows sit at that
one-cent offset; none exceed it.

Because `quantity` is signed, this single formula covers both sides: a BUY (`quantity > 0`)
yields negative cash, a SELL (`quantity < 0`) yields positive cash. Commission is always
subtracted — it is a cost on both buys and sells.

This identity is the strongest integrity check available on the file, and it holds **including
on every FX row**, which is what proves `unit_price` is already CAD (§4).

Use it as a parse-time assertion. If it ever fails, either the export changed or the parse is
misaligned.

### 2.4 `settlement_date`

Present on every `Trade` row and no other row. Lag from `transaction_date` in the reference
export ranges from same-day out to about a week, with next-business-day settlement the most
common case by far.

One row in the reference export has a *negative* lag — a crypto buy where settlement is
stamped one day **before** the transaction — a timezone artifact of the crypto venue, not
corrupt data. Don't assert `settlement_date >= transaction_date`.

**Use `transaction_date` for all time bucketing.** It is the only date present on every row;
bucketing by settlement date would silently drop every non-trade row.

### 2.5 `name` needs normalisation before it is used as a key

Two dirt patterns confirmed in the reference export:

- **Non-breaking space (U+00A0):** e.g. a fund name that reads correctly on screen but has a
  non-breaking space where a regular space belongs. Splitting or matching on `" "` will not
  behave as expected.
- **Trailing whitespace:** e.g. a company name with a trailing space after the closing
  parenthesis of a share-class suffix.

There are more distinct `symbol` values than distinct `name` values in the reference export —
two symbols can share one `name` across a ticker change (ticker changes issuer, legal name
doesn't). **Group by `symbol`, never by `name`.**

### 2.6 `activity_sub_type` uses `-` as its null

A meaningful fraction of rows carry the literal string `-`, meaning "this activity type has no
sub-type." The parser maps `-` → `null`
([wealthsimple.ts:105](../src/lib/wealthsimple.ts:105)), which is correct. Anything reading the
raw CSV must not treat `-` as a real category.

### 2.7 `direction` is dead weight

Only ever `LONG` in the reference export, and only on rows that already have a `symbol`. It
carries no information in this dataset. **Assumption:** a `SHORT` value would appear for short
positions in a margin account — this export's margin account never shorted, so this is
untested.

---

## 3. Activity taxonomy

Every `activity_type` × `activity_sub_type` combination present in the reference export, with
its cash direction.

| `activity_type` | `activity_sub_type` | Sign | Meaning |
|---|---|---|---|
| `Trade` | `BUY` | always − | Security or crypto purchase |
| `Trade` | `SELL` | always + | Security or crypto sale |
| `MoneyMovement` | `EFT` | either | Bank ↔ Wealthsimple electronic transfer |
| `MoneyMovement` | `TRANSFER` | either | Between the owner's own accounts, or a credit-card payment — see §3.1 |
| `MoneyMovement` | `TRANSFER_TF` | either | Between registered accounts (e.g. TFSA→TFSA) |
| `MoneyMovement` | `E_TRFOUT` | always − | Interac e-Transfer sent out |
| `MoneyMovement` | `AFT_IN` | always + | Direct deposit (payroll) |
| `MoneyMovement` | `AFT_OUT` | always − | Pre-authorized debit |
| `Dividend` | `-` | always + | Cash distribution |
| `Fee` | `-` | always − | Management fee / generic fee |
| `AdministrativePayment` | `MANAGEMENT_FEE_REFUND` | always + | **Fee rebate — income, not cost** |
| `Tax` | `NRT` | always − | Non-resident withholding tax |
| `Interest` | `-` | always + | Interest **earned** on cash |
| `InterestCharged` | `-` | always − | Margin interest **paid** |
| `BonusPayment` | `CASHBACK` | always + | Credit-card cash back |
| `BonusPayment` | `REFER` | always + | Referral bonus |
| `BonusPayment` | `GIVEAWAY` | always + | Promotional giveaway |
| `LegacyCorporateAction` | `NAME_CHANGE` | n/a | Share-count correction, zero cash |

### 3.1 Traps in this taxonomy

**`Interest` vs `InterestCharged` are opposites.** Near-identical names, opposite sign,
opposite meaning. `Interest` is income earned on a cash balance (every row in the reference
export is in the Chequing account). `InterestCharged` is margin interest paid (every row in the
reference export is in the margin account). [metrics.ts:53](../src/lib/metrics.ts:53) already
calls this out.

**`AdministrativePayment` is money coming *in*.** Every row is positive
(`MANAGEMENT_FEE_REFUND`). It sits in `COST_TYPES` in
[metrics.ts:54](../src/lib/metrics.ts:54), which is *deliberate and correct* — costs are
computed as `-Σ net_cash` over that set, so a positive refund reduces reported costs. Net cost
is therefore lower than gross cost. Just don't ever re-label the type itself as an expense in
the UI.

**`EFT` is bidirectional, `TRANSFER` is bidirectional, the rest are one-way.** Only `EFT`,
`TRANSFER` and `TRANSFER_TF` carry both signs, so the sub-type alone never tells you which way
an `EFT` went — but the **description does**, and that is what the app keys on:

| Description | Direction |
|---|---|
| `Deposit` / `Deposit (executed at …)` | in |
| `Withdrawal` / `Withdrawal (executed at …)` | out |

Both readings agree in the reference export — every `Deposit` row is positive and every
`Withdrawal` row negative, zero disagreements — so keying on the description costs nothing
today and is the stricter rule tomorrow. The sign says which way the money moved; it does not
say what kind of movement it was, so a sign test also sweeps in any *other* non-transfer
`MoneyMovement` sub-type that happens to point the same way (`AFT_IN` payroll, `E_TRFOUT`) the
moment one appears outside a chequing account.
[`isBankDeposit` / `isBankWithdrawal`](../src/lib/metrics.ts) implement this.

**Match the description template, never a substring.** `Direct deposit received` (the `AFT_IN`
payroll rows) contains the word "Deposit" but is *not* a bank deposit — an
`includes("Deposit")` test would silently misclassify payroll as a bank deposit. The app
compares against the whole template after stripping the optional `(executed at <date>)` suffix,
which Wealthsimple applies inconsistently: the same deposit reads `Deposit` on one row and
`Deposit (executed at <date>)` on the next.

**`TRANSFER` is overloaded.** Three distinct descriptions share the sub-type:

| Description | Meaning |
|---|---|
| `Money transfer out of the account (executed at …)` | Internal account-to-account |
| `Money transfer into the account (executed at …)` | Internal account-to-account |
| `Credit card payment` | **External** — paying the WS credit card |

The `Credit card payment` rows are real spending leaving the ecosystem, not cash moving between
the owner's own accounts. They are matched on description ahead of the generic transfer rule
and land under **Money out** — another case where the sub-type is not enough on its own.

**`BonusPayment` ≠ cashback.** Of the bonus-payment rows in the reference export, most are
actual card cash back (`CASHBACK`); the rest are a referral bonus and a promotional giveaway
(`REFER`, `GIVEAWAY`). `computeKpis` reports these as separate `cashback` and `promo` figures
so a promo-only period is not labelled "Cash back".

---

## 4. Currency and FX — the biggest trap in the file

**Every monetary value in this file is CAD. Never apply the FX rate.**

A meaningful fraction of rows — BUY, SELL, and Dividend rows on US-listed tickers — carry
`, FX Rate: 1.36xx` (or similar) at the end of `description`. It appears on exactly the
US-listed tickers held in the reference export and never on the TSX-listed ones.

The intuitive reading — "`unit_price` is USD, multiply by the FX rate to get CAD" — is
**wrong**, and acting on it would inflate every US-listed figure by roughly the size of the FX
rate itself.

Three independent proofs:

1. **The cash identity holds unmodified on FX rows.**
   `net_cash_amount == -(quantity × unit_price) - commission` is exact for every trade in the
   reference export, FX rows included. If `unit_price` were USD and `net_cash_amount` CAD,
   every FX row would miss by the FX rate.
2. **Prices are too high to be USD.** In the reference export, a widely-held S&P 500 ETF
   appears around 812.30 and a total-market ETF around 427.90 on their most recent trade dates.
   Divided by ~1.36 those become roughly 597 and 315 — plausible USD quotes. As USD figures
   they would be implausible.
3. **Crypto arithmetic closes exactly.** A recurring BTC-CAD buy in the reference export:
   `0.00050000 × 49,700.00 = 24.85`, plus `0.15` commission = `25.00`, matching
   `net_cash_amount = -25` — a round CAD recurring buy. `49,700.00 / 1.362 ≈ 36,490`, the USD
   price.

The FX rate is **informational only**: the rate Wealthsimple used at conversion time. It is
worth surfacing (it is the currency-conversion cost the user paid) but must never multiply a
value that is already converted.

### 4.1 The `currency` column describes the account, not the security

Constant `CAD` across almost every populated row, including every US-listed trade. It is the
settlement/account currency. It cannot be used to detect USD-denominated holdings — the FX
marker in `description` is the only such signal.

### 4.2 Description prices are truncated, not rounded

`description` quotes the price as `at $42.75 per share` while `unit_price` is `42.7592`. The
description value is `unit_price` **truncated** to 2 decimals, not rounded — verified against
several examples where the third decimal is 5 or higher (42.7592→42.75, not 42.76; 18.3971→
18.39, not 18.40; 9.2688→9.26, not 9.27). Always read `unit_price`; the description price loses
precision on low-priced securities, up to several tenths of a percent on a security trading
near a dollar or two.

---

## 5. Accounts

`account_type` is a **label, not a key**. Three distinct TFSAs in the reference export share
the type `TFSA`.

| `account_id` (synthetic) | `account_type` | Relative activity |
|---|---|---|
| `RRSP01CAD` | Group RRSP | Heaviest — the most rows by far, spans the full export window |
| `TFSA01CAD` | TFSA | Moderate, spans most of the window |
| `FHSA01CAD` | FHSA | Light-to-moderate, opened partway through |
| `CHQ01CAD` | Chequing | Moderate, spans most of the window |
| `TFSA02CAD` | TFSA | Light, opened well after the first TFSA |
| `CRYPTO01CAD` | Crypto | Light, opened recently |
| `TFSA03CAD` | TFSA | Very light, opened most recently of the three |
| `MARGIN01CAD` | Non-registered margin | Very light, opened recently, no margin drawn |

Any per-account grouping must key on `account_id`. Grouping by `account_type` is a valid
*roll-up* (and the TFSA roll-up is meaningful — the three TFSAs share one contribution room),
but it is not "an account".

The ID suffix encodes currency (`…CAD`). **Assumption:** a USD sub-account would appear as a
separate `account_id` ending `USD`. Not present in the reference export.

Account types observed: `Group RRSP`, `TFSA`, `FHSA`, `Chequing`, `Crypto`,
`Non-registered margin`. **Assumption:** other Wealthsimple products (`RRSP`, `RESP`, `Cash`,
`Save`, `LIRA`, `RRIF`, `Joint`) would use similar labels. The
`isCashAccount` keyword match in [metrics.ts:107](../src/lib/metrics.ts:107) covers
`cash`/`chequing`/`checking`/`save`/`spend`, which is the right shape of defence.

---

## 6. Invariants

Assertions that hold across the whole reference export. Worth encoding as tests — a break means
either a parsing bug or a change in Wealthsimple's export.

| # | Invariant | Status |
|---|---|---|
| I1 | `net_cash_amount == -(quantity × unit_price) - commission` on every `Trade`, ±2¢ | ✅ holds on every trade row |
| I2 | `quantity == net_cash_amount` on every non-`Trade`, non-`LegacyCorporateAction` row | ✅ holds on every applicable row |
| I3 | `Σ quantity` per `symbol` over `Trade`+`LegacyCorporateAction` is never negative | ✅ holds for every symbol |
| I4 | Fully-exited positions land on exactly `0.000000`, not a dust residual | ✅ holds for every closed symbol |
| I5 | `Σ net_cash_amount` per account is the cash balance — non-negative **except on margin** | ✅ holds for every account |
| I6 | `TRANSFER_TF` nets to exactly 0.00 across all accounts in the export | ✅ |
| I7 | `settlement_date` is set iff `activity_type == 'Trade'` | ✅ |
| I8 | `symbol` is set iff type ∈ {`Trade`, `Dividend`, `LegacyCorporateAction`} | ✅ |
| I9 | The `executed at` date in `description` always equals `transaction_date` | ✅ |
| I10 | The `received on` date on dividends always equals `transaction_date` | ✅ |

### 6.0 I5 does not apply to margin accounts

A margin account can hold a legitimately **negative** cash balance — borrowing against the
portfolio is what it is for, and the `InterestCharged` rows are the interest on exactly that.
The reference export happened to have no drawn margin, so the invariant looked universal; a
later export that draws margin would be wrongly reported as missing rows. `isMarginAccount` in
[metrics.ts](../src/lib/metrics.ts) exempts it in both `validateDataset` and the per-account
history check. The upper bound still applies.

### 6.1 I5 is the headline validation check

`Σ net_cash_amount` over an account equals its **uninvested cash balance** — because every
cash movement in or out of the account is a row, and buys/sells net against them. Every account
in the reference export lands in a small, plausible idle-cash range — a few dollars up to
roughly a hundred — which is exactly what an idle-cash residual looks like.

This makes the file self-validating: if the app's parse produces a per-account total that is
large, negative, or wildly off, rows have been dropped, duplicated, or sign-flipped. **This is
the single best regression test for the parser and the merge logic.**

### 6.2 I6 shows why transfers don't always net to zero

`TRANSFER_TF` nets to exactly 0.00 because all three TFSAs are in the export. `TRANSFER` does
**not** net to zero, because some of its counterparties (the WS credit card, and accounts
outside this export) are not present. A non-zero transfer total is expected, not a bug — but it
does mean "internal transfers cancel out" cannot be assumed.

---

## 7. Duplicate rows are real data

**The export has no per-row unique identifier**, and dozens of distinct row signatures appear
more than once in the reference export — mostly small TFSA `EFT` deposits.

These are genuine separate transactions (e.g. two identical small transfers on the same day,
two deposits of the same amount on another day), not export artifacts. Verified by the
account-balance invariant: they must be counted individually for I5 to hold.

**Never de-duplicate by row content.** Doing so would delete real activity and break every
total. [merge.ts:1](../src/lib/merge.ts:1) already documents this and merges by date-window
coverage per account instead, which is the correct approach for overlapping exports.

---

## 8. What the export does *not* contain

Important for scoping what the app can honestly claim:

- **No market values or prices as of the export date.** Only transaction prices.
- **No position or balance snapshot.** Share counts are derivable (`Σ quantity` per symbol),
  cash is derivable (I5), but current *value* is not.
- **No book cost / ACB, no realised or unrealised gain/loss.** Cost basis is reconstructible
  from the trade history — but only for accounts whose full history is in the export, and only
  if the ACB method is implemented deliberately.
- **No contribution-room, tax-year, or registered-account attribution.**
- **No security metadata** beyond ticker and name — no asset class, region, or sector.
- **No counterparty detail** on transfers: `Money transfer out of the account` doesn't say where.

Anything the app shows as portfolio value, total return, or performance requires an external
price source. From this file alone, the honest ceiling is **cash flow, contributions, income,
costs, trade activity, and share counts.**

---

## 9. Reference figures

The original version of this document included an exact totals table — row counts, dollar
sums, and open positions — computed from the author's real export, meant to be recomputed after
any change to parsing or metrics. That table is not reproduced here, because doing so
faithfully would mean publishing a real person's account balances, income, and holdings.

The regression protection that table was standing in for still exists: I1, I2 and I5 run
against the *real* file at parse time via `validateDataset` in
[wealthsimple.ts](../src/lib/wealthsimple.ts) — asserting them over hand-built fixtures would
only test the fixtures. The reference export produces zero violations. If you have your own
export, the same checks run automatically the moment you load it.

For a small, checked-in, fully synthetic dataset that exercises the same invariants and can be
diffed after a change, see [`src/lib/wealthsimple.test.ts`](../src/lib/wealthsimple.test.ts)
and the sibling `*.test.ts` files under `src/lib/`.

---

## 10. Findings

Discrepancies between this document and the implementation.

### Fixed

1. ~~**`Credit card payment` is misclassified as internal.**~~ The `TRANSFER` rows for credit
   card payments now match on description ahead of the generic transfer rule and land under
   **Money out** as their own line. (§3.1)
2. ~~**The `cashback` KPI is mislabelled.**~~ `computeKpis` now splits `cashback` (`CASHBACK`
   only) from `promo` (`REFER` + `GIVEAWAY`), matching how `flowBreakdown` already categorised
   the same rows. A promo-only period now reads "Bonus", not "Cash back". (§3.1)
3. ~~**No invariant tests exist.**~~ Vitest added. I1, I2 and I5 run against the *real* file at
   parse time via `validateDataset` in `wealthsimple.ts` — asserting them over hand-built
   fixtures would only test the fixtures. The reference export produces zero violations.

Fixed alongside these, found while verifying:

4. **The chart disagreed with the KPI tiles.** The "Deposits & transfers" measure summed every
   `MoneyMovement` row, while `moneyIn`/`moneyOut` exclude cash-account rows and internal
   transfers. Both now route through `isExternalMoneyMovement`; the measure is relabelled
   "Deposits & withdrawals" to match what it counts.
5. **Cash back sat outside the Income section.** `flowBreakdown` filed `CASHBACK` under the
   internal section while `computeKpis` counted it as income, so the two totals differed. Cash
   back is now in Income, and the section total equals `Kpis.income` exactly.
6. **`LegacyCorporateAction` tripped the unknown-type warning** on every real export despite
   being documented and carrying no cash. Added to `KNOWN_ACTIVITY_TYPES`.
7. **Deposits and withdrawals were split by sign, not by what the row says.** `moneyIn` /
   `moneyOut` took every non-transfer `MoneyMovement` in a non-cash account and sorted it on
   the sign of `net_cash_amount`, so the figures were defined by direction rather than by kind
   — any future positive sub-type in an investment account would have been reported as a bank
   deposit. Both now key on the description template (`isBankDeposit` / `isBankWithdrawal`),
   as does `flowBreakdown`'s EFT pair. Totals are unchanged on the reference export because
   sign and description agree on every row. (§3.1)

### Open

8. **The export timestamp is discarded.** The footer's "As of" time would let the UI show
   source freshness. (§1.1)
9. **`name` is used unnormalised.** Non-breaking spaces and trailing whitespace will bite any
   grouping or matching on that field. Currently latent — nothing groups by `name` today. (§2.5)
10. **Portfolio value is not derivable from this file.** If the UI implies a portfolio value or
    return anywhere, it is either wrong or is silently sourcing prices elsewhere. (§8)

---

## Appendix — description templates

Useful for parsing, and for spotting a format change.

```
Trade/BUY      <SYM> - <NAME>: Bought <qty> shares at $<price> per share (executed at <date>)
               <SYM> - <NAME>: Bought <qty> shares at $<price> per share (executed at <date>), FX Rate: <rate>
               Purchase of <qty> BTC (executed at <date>), FX Rate: <rate>          [crypto]
Trade/SELL     <SYM> - <NAME>: Sold <qty> shares at $<price> per share (executed at <date>)[, FX Rate: <rate>]
Dividend       <SYM> - <NAME>: Cash dividend distribution, received on <date>, record date of <date>[, FX Rate: <rate>]
MoneyMovement  Deposit | Deposit (executed at <date>) | Withdrawal | Withdrawal (executed at <date>)
               Money transfer into the account (executed at <date>)
               Money transfer out of the account (executed at <date>)
               Credit card payment | Direct deposit received | Pre-authorized Debit
               Interac e-Transfer® Out
Fee            Management fee (executed at <date>) | Fee (executed at <date>)
Interest       Interest received (executed at <date>)
InterestCharged Margin Interest Charges | Margin Interest Charges for <n>
Tax/NRT        Non-resident tax (executed at <date>)
AdminPayment   CAD credited (executed at <date>)
BonusPayment   Cash back - Credit card | Referral bonus (<date>) | Giveaway received
LegacyCorpAct  <SYM> - <NAME>: Corrected quantity of shares by <qty> (executed at <date>)
```

Note the `®` in `Interac e-Transfer® Out` — a non-ASCII character in a value that might
otherwise be matched literally.
