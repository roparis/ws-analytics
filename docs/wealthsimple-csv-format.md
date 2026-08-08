# Wealthsimple activities export — data dictionary

**Status:** source of truth for how this app interprets the CSV.
**Derived from:** `activities-export-2026-08-03-2.csv` — 2,902 activity rows, 8 accounts,
6 account types, 2022-03-31 → 2026-08-01 (54 consecutive months, no gaps).

Wealthsimple publishes no schema for this file. Everything below was derived empirically from
the export and stated with the evidence that supports it. Where a rule was verified against
every row in the dataset, the row count is given. Where a claim is an inference that a future
export could contradict, it is marked **assumption**.

---

## 1. File shape

| Property | Value |
|---|---|
| Encoding | UTF-8, `\n` line endings |
| Header | Row 1, 15 columns, `snake_case`, stable order |
| Data rows | One activity per row, 15 fields, all quoted-as-needed (RFC 4180) |
| Footer | A blank line, then a single-field row: `"As of 2026-08-03 17:08 GMT-04:00"` |
| Sort order | Grouped by `account_id`; within each block, ascending by `transaction_date` |

### 1.1 The footer is not data

The last two lines of the file are a blank line and an export-timestamp row. A naïve
`header: true` CSV parse yields a bogus final record whose `transaction_date` is
`As of 2026-08-03 17:08 GMT-04:00` and whose other 14 fields are empty.

[wealthsimple.ts:129](../src/lib/wealthsimple.ts:129) already drops it by requiring
`transaction_date` to match `^\d{4}-\d{2}-\d{2}$`. Keep that filter — it is the only thing
standing between the footer and a `NaN` in every total.

The timestamp is genuinely useful metadata (it is the "data is current as of" watermark) but
is currently discarded. Capturing it would let the UI say how stale a source is.

### 1.3 The date column was renamed, and gained a time

Exports from around August 2026 replace `transaction_date` with **`effective_at`**, and
change its type from a bare `YYYY-MM-DD` to a full ISO timestamp carrying the account's UTC
offset:

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

Rows within a single date are **not** in execution order. On 2025-10-06 the Group RRSP
rebalance lists five buys before the sells that funded them, driving a naïve running cash
balance to −$3,476.16 mid-day before it recovers.

**Consequence:** never compute or display a row-by-row running balance. Cumulative sums are
only meaningful at end-of-day or coarser boundaries.

---

## 2. Column reference

| # | Column | Type | Populated | Notes |
|---|---|---|---|---|
| 1 | `effective_at` | ISO timestamp | all | **Renamed, see §1.3.** Was `transaction_date` (`YYYY-MM-DD`). |
| 2 | `settlement_date` | `YYYY-MM-DD` | 1541/2902 | **Trade rows only.** Empty for everything else. |
| 3 | `account_id` | string | 2902/2902 | Opaque account key. 8 distinct. |
| 4 | `account_type` | string | 2902/2902 | Display label. **Not unique per account** — see §5. |
| 5 | `activity_type` | enum | 2902/2902 | 10 values. See §3. |
| 6 | `activity_sub_type` | enum | 2902/2902 | 15 values, incl. the literal `-` sentinel. |
| 7 | `description` | free text | 2902/2902 | Templated per sub-type; carries FX rate and record date. |
| 8 | `direction` | enum | 1543/2902 | Only ever `LONG`. Carries no information today. |
| 9 | `symbol` | string | 1941/2902 | Set on `Trade`, `Dividend`, `LegacyCorporateAction` only. |
| 10 | `name` | string | 1941/2902 | Security long name. **Dirty — see §2.5.** |
| 11 | `currency` | string | 2900/2902 | Always `CAD`. Account currency, *not* the security's. |
| 12 | `quantity` | decimal | 2902/2902 | **Dual-purpose — see §2.2.** |
| 13 | `unit_price` | decimal | 1541/2902 | Trade rows only. **In CAD — see §4.** |
| 14 | `commission` | decimal | 1541/2902 | Trade rows only. Non-zero on 20 rows, all crypto. |
| 15 | `net_cash_amount` | decimal | 2900/2902 | Signed cash impact in CAD. The money column. |

### 2.1 `net_cash_amount` is the only money column that generalises

Every row's effect on the account's cash is `net_cash_amount`, signed from the account's point
of view: **positive = cash in, negative = cash out**. This holds for all 2,900 rows that have
it. Any aggregate about money should be built from this column and nothing else.

Two rows have it empty (both `LegacyCorporateAction` / `NAME_CHANGE`, §3.10). The parser
coerces null → `0`, which is correct: a share-count correction moves no cash.

### 2.2 `quantity` means two different things

This is the single most dangerous column in the file.

| Rows | `activity_type` | `quantity` means |
|---|---|---|
| 1541 | `Trade` | **Share/unit count**, signed: `+` on BUY, `−` on SELL |
| 2 | `LegacyCorporateAction` | Share-count adjustment, signed |
| 1359 | everything else | **A dollar amount** — exactly equal to `net_cash_amount` |

Verified: for all 1,359 non-trade, non-corporate-action rows,
`quantity == net_cash_amount` to the cent (not merely equal in magnitude — same sign too).

So on a `MoneyMovement` row, `quantity` is `1910.4` *dollars*, not 1910.4 units of anything.
Summing `quantity` across mixed activity types produces a number with no meaning. Only ever
sum `quantity` within a single `symbol`, restricted to `Trade` + `LegacyCorporateAction`.

Sign convention on trades is uniform and was verified exhaustively: 0 BUY rows have negative
quantity, and all 76 SELL rows have negative quantity.

### 2.3 The trade cash identity

For all 1,541 trade rows, to within two cents:

```
net_cash_amount == -(quantity × unit_price) - commission
```

Two cents, not one: Wealthsimple rounds the cash total independently of the quantity and price
it reports, so a $25 recurring crypto buy books as exactly `-25.00` while
`quantity × unit_price + commission` works out to `-24.99`. Eleven rows sit at that one-cent
offset; none exceed it.

Because `quantity` is signed, this single formula covers both sides: a BUY (`quantity > 0`)
yields negative cash, a SELL (`quantity < 0`) yields positive cash. Commission is always
subtracted — it is a cost on both buys and sells.

This identity is the strongest integrity check available on the file, and it holds **including
on every FX row**, which is what proves `unit_price` is already CAD (§4).

Use it as a parse-time assertion. If it ever fails, either the export changed or the parse is
misaligned.

### 2.4 `settlement_date`

Present on 100% of `Trade` rows and 0% of everything else. Lag from `transaction_date`:

| Lag (days) | −1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|---|
| Rows | 2 | 22 | 805 | 100 | 101 | 402 | 106 | 3 |

The two negative lags are both crypto BTC buys where settlement is stamped one day *before*
the transaction — a timezone artifact of the crypto venue, not corrupt data. Don't assert
`settlement_date >= transaction_date`.

**Use `transaction_date` for all time bucketing.** It is the only date present on every row;
bucketing by settlement date would silently drop the 1,361 non-trade rows.

### 2.5 `name` needs normalisation before it is used as a key

Two dirt patterns confirmed in this export:

- **Non-breaking space (U+00A0):** `Goldman Sachs ActiveBeta World Low Vol Plus Equity ETF`.
  Splitting or matching on a regular space will not behave as expected.
- **Trailing whitespace:** `Palantir Technologies Inc (Class A) `.

There are 44 distinct `symbol` values but only 43 distinct `name` values — `TWOU` and `TWOUQ`
share the name `2U Inc.` across a ticker change. **Group by `symbol`, never by `name`.**

### 2.6 `activity_sub_type` uses `-` as its null

518 rows carry the literal string `-` meaning "this activity type has no sub-type". The parser
maps `-` → `null` ([wealthsimple.ts:70](../src/lib/wealthsimple.ts:70)), which is correct.
Anything reading the raw CSV must not treat `-` as a real category.

### 2.7 `direction` is dead weight

Only ever `LONG`, and only on the 1,543 rows that already have a `symbol`. It carries no
information in this dataset. **Assumption:** a `SHORT` value would appear for short positions
in a margin account — this export's margin account never shorted, so this is untested.

---

## 3. Activity taxonomy

Every `activity_type` × `activity_sub_type` combination present, with its cash direction.

| `activity_type` | `activity_sub_type` | n | Σ net cash | Sign | Meaning |
|---|---|---:|---:|---|---|
| `Trade` | `BUY` | 1465 | −107,447.99 | always − | Security or crypto purchase |
| `Trade` | `SELL` | 76 | +55,975.96 | always + | Security or crypto sale |
| `MoneyMovement` | `EFT` | 661 | +44,427.90 | 639 +, 22 − | Bank ↔ Wealthsimple electronic transfer |
| `MoneyMovement` | `TRANSFER` | 73 | +1,560.80 | 21 +, 52 − | Between the owner's own accounts |
| `MoneyMovement` | `TRANSFER_TF` | 6 | −0.00 | 3 +, 3 − | Between registered accounts (TFSA→TFSA) |
| `MoneyMovement` | `E_TRFOUT` | 10 | −7,450.00 | always − | Interac e-Transfer sent out |
| `MoneyMovement` | `AFT_IN` | 5 | +9,552.00 | always + | Direct deposit (payroll) |
| `MoneyMovement` | `AFT_OUT` | 1 | −69.00 | always − | Pre-authorized debit |
| `Dividend` | `-` | 398 | +4,154.99 | always + | Cash distribution |
| `Fee` | `-` | 85 | −474.71 | always − | Management fee (83) / generic fee (2) |
| `AdministrativePayment` | `MANAGEMENT_FEE_REFUND` | 44 | **+25.31** | always + | **Fee rebate — income, not cost** |
| `Tax` | `NRT` | 36 | −88.61 | always − | Non-resident withholding tax |
| `Interest` | `-` | 31 | +49.25 | always + | Interest **earned** on cash |
| `InterestCharged` | `-` | 4 | −10.15 | always − | Margin interest **paid** |
| `BonusPayment` | `CASHBACK` | 3 | +53.01 | always + | Credit-card cash back |
| `BonusPayment` | `REFER` | 1 | +25.00 | always + | Referral bonus |
| `BonusPayment` | `GIVEAWAY` | 1 | +5.00 | always + | Promotional giveaway |
| `LegacyCorporateAction` | `NAME_CHANGE` | 2 | (empty) | n/a | Share-count correction, zero cash |

### 3.1 Traps in this taxonomy

**`Interest` vs `InterestCharged` are opposites.** Near-identical names, opposite sign,
opposite meaning. `Interest` is income earned on a cash balance (all 31 rows are in the
Chequing account). `InterestCharged` is margin interest paid (all 4 rows in the margin
account). [metrics.ts:35](../src/lib/metrics.ts:35) already calls this out.

**`AdministrativePayment` is money coming *in*.** All 44 rows are positive
(`MANAGEMENT_FEE_REFUND`, total +$25.31). It sits in `COST_TYPES` in
[metrics.ts:39](../src/lib/metrics.ts:39), which is *deliberate and correct* — costs are
computed as `-Σ net_cash` over that set, so a positive refund reduces reported costs. Net cost
is therefore $548.16, not the $573.47 gross. Just don't ever re-label the type itself as an
expense in the UI.

**`EFT` is bidirectional, `TRANSFER` is bidirectional, the rest are one-way.** Only `EFT`,
`TRANSFER` and `TRANSFER_TF` carry both signs, so the sub-type alone never tells you which way
an `EFT` went — but the **description does**, and that is what the app keys on:

| Description | n | Direction |
|---|---:|---|
| `Deposit` / `Deposit (executed at …)` | 639 | in |
| `Withdrawal` / `Withdrawal (executed at …)` | 22 | out |

Both readings agree on this export — all 639 `Deposit` rows are positive and all 22
`Withdrawal` rows negative, **zero disagreements** — so keying on the description costs
nothing today and is the stricter rule tomorrow. The sign says which way the money moved; it
does not say what kind of movement it was, so a sign test also sweeps in any *other*
non-transfer `MoneyMovement` sub-type that happens to point the same way (`AFT_IN` payroll,
`E_TRFOUT`) the moment one appears outside a chequing account.
[`isBankDeposit` / `isBankWithdrawal`](../src/lib/metrics.ts) implement this.

**Match the description template, never a substring.** `Direct deposit received` (the 5
`AFT_IN` payroll rows) contains the word "Deposit" but is *not* a bank deposit — an
`includes("Deposit")` test would silently add $9,552.00 to money in. The app compares against
the whole template after stripping the optional `(executed at <date>)` suffix, which
Wealthsimple applies inconsistently: the same deposit reads `Deposit` on one row and
`Deposit (executed at 2026-06-04)` on the next (383 bare vs 256 suffixed).

**`TRANSFER` is overloaded.** Three distinct descriptions share the sub-type:

| Description | n | Meaning |
|---|---:|---|
| `Money transfer out of the account (executed at …)` | 43 | Internal account-to-account |
| `Money transfer into the account (executed at …)` | 21 | Internal account-to-account |
| `Credit card payment` | 9 | **External** — paying the WS credit card |

The nine `Credit card payment` rows (−$2,579.11 total, all from Chequing) are real spending
leaving the ecosystem, not cash moving between the owner's own accounts. They are matched on
description ahead of the generic transfer rule and land under **Money out** — another case
where the sub-type is not enough on its own.

**`BonusPayment` ≠ cashback.** The five rows total $83.01, of which only $53.01 is actual
card cash back (`CASHBACK`); the rest is a $25 referral bonus and a $5 giveaway (`REFER`,
`GIVEAWAY`). `computeKpis` reports these as separate `cashback` and `promo` figures so a
promo-only period is not labelled "Cash back".

---

## 4. Currency and FX — the biggest trap in the file

**Every monetary value in this file is CAD. Never apply the FX rate.**

746 rows carry `, FX Rate: 1.3601` (or similar) at the end of `description`: 656 BUY, 34 SELL,
56 Dividend. It appears on exactly the US-listed tickers (`VTI`, `VOO`, `IEFA`, `EEMV`,
`GLDM`, `BITO`, `ARKK`, `VNQ`, `MOAT`, `ASTS`, `RDW`, `PLTR`, `BWXT`, `SMR`, `UAE`, `IAU`,
`GSWO`, `SPCX`, `TWOU`, `BTC`) and never on the TSX-listed ones.

The intuitive reading — "`unit_price` is USD, multiply by the FX rate to get CAD" — is
**wrong**, and acting on it would inflate every US-listed figure by ~38%.

Three independent proofs:

1. **The cash identity holds unmodified on FX rows.**
   `net_cash_amount == -(quantity × unit_price) - commission` is exact for all 1,541 trades,
   FX rows included. If `unit_price` were USD and `net_cash_amount` CAD, every FX row would
   miss by the FX rate.
2. **Prices are too high to be USD.** `VOO` appears at 964.00 and `VTI` at 513.45 on
   2026-07-30/31. Divided by ~1.38 those are ~700 and ~372 — plausible USD quotes. As USD
   figures they would be implausible.
3. **Crypto arithmetic closes exactly.** The 2025-12-04 BTC buy: `0.00019052 × 128,638.82 =
   24.51`, plus `0.4879945` commission = `25.00`, matching `net_cash_amount = -25` — a round
   CAD recurring buy. `128,638.82 / 1.3942 ≈ 92,266`, the USD price.

The FX rate is **informational only**: the rate Wealthsimple used at conversion time. It is
worth surfacing (it is the currency-conversion cost the user paid) but must never multiply a
value that is already converted.

### 4.1 The `currency` column describes the account, not the security

Constant `CAD` across all 2,900 populated rows, including every US-listed trade. It is the
settlement/account currency. It cannot be used to detect USD-denominated holdings — the FX
marker in `description` is the only such signal.

### 4.2 Description prices are truncated, not rounded

`description` quotes the price as `at $59.50 per share` while `unit_price` is
`59.5081375`. The description value is `unit_price` **truncated** to 2 decimals (verified:
59.5081→59.50, 73.6790→73.67, 76.2663→76.26). Always read `unit_price`; the description price
loses up to 0.6% on low-priced securities such as `ETHY` at ~$1.20.

---

## 5. Accounts

`account_type` is a **label, not a key**. Three distinct TFSAs share the type `TFSA`.

| `account_id` | `account_type` | Rows | Date range | Σ net cash |
|---|---|---:|---|---:|
| `WK0VW3J44CAD` | Group RRSP | 1317 | 2022-03-31 → 2026-07-30 | 149.13 |
| `HQ43J17K2CAD` | TFSA | 938 | 2023-04-03 → 2026-07-31 | 0.13 |
| `WK2HMGJ60CAD` | FHSA | 263 | 2024-01-15 → 2026-07-06 | 1.12 |
| `WK2H60634CAD` | Chequing | 171 | 2024-01-09 → 2026-08-01 | 130.96 |
| `WZ0H7S9K0CAD` | TFSA | 105 | 2026-03-23 → 2026-07-31 | 5.14 |
| `HQ4VK9515CAD` | Crypto | 48 | 2025-12-04 → 2026-07-29 | 0.00 |
| `WZ0P1PZK5CAD` | TFSA | 38 | 2026-06-29 → 2026-07-31 | 2.28 |
| `HQB5TG204CAD` | Non-registered margin | 22 | 2026-03-23 → 2026-07-02 | −0.00 |

Any per-account grouping must key on `account_id`. Grouping by `account_type` is a valid
*roll-up* (and the TFSA roll-up is meaningful — the three TFSAs share one contribution room),
but it is not "an account".

The ID suffix encodes currency (`…CAD`). **Assumption:** a USD sub-account would appear as a
separate `account_id` ending `USD`. Not present here.

Account types observed: `Group RRSP`, `TFSA`, `FHSA`, `Chequing`, `Crypto`,
`Non-registered margin`. **Assumption:** other Wealthsimple products (`RRSP`, `RESP`, `Cash`,
`Save`, `LIRA`, `RRIF`, `Joint`) would use similar labels. The
`isCashAccount` keyword match in [metrics.ts:85](../src/lib/metrics.ts:85) covers
`cash`/`chequing`/`checking`/`save`/`spend`, which is the right shape of defence.

---

## 6. Invariants

Assertions that hold across all 2,902 rows. Worth encoding as tests — a break means either a
parsing bug or a change in Wealthsimple's export.

| # | Invariant | Status |
|---|---|---|
| I1 | `net_cash_amount == -(quantity × unit_price) - commission` on every `Trade`, ±2¢ | 1541/1541 ✅ |
| I2 | `quantity == net_cash_amount` on every non-`Trade`, non-`LegacyCorporateAction` row | 1359/1359 ✅ |
| I3 | `Σ quantity` per `symbol` over `Trade`+`LegacyCorporateAction` is never negative | 44/44 symbols ✅ |
| I4 | Fully-exited positions land on exactly `0.000000`, not a dust residual | 19/19 closed ✅ |
| I5 | `Σ net_cash_amount` per account is the cash balance — non-negative **except on margin** | 8/8 ✅ |
| I6 | `TRANSFER_TF` nets to exactly 0.00 across all accounts in the export | ✅ |
| I7 | `settlement_date` is set iff `activity_type == 'Trade'` | ✅ |
| I8 | `symbol` is set iff type ∈ {`Trade`, `Dividend`, `LegacyCorporateAction`} | ✅ |
| I9 | The `executed at` date in `description` always equals `transaction_date` | 2071/2071 ✅ |
| I10 | The `received on` date on dividends always equals `transaction_date` | 398/398 ✅ |

### 6.0 I5 does not apply to margin accounts

A margin account can hold a legitimately **negative** cash balance — borrowing against the
portfolio is what it is for, and the `InterestCharged` rows are the interest on exactly that.
The reference export happened to have no drawn margin, so the invariant looked universal; a
later export draws $500 and would be wrongly reported as missing rows. `isMarginAccount` in
[metrics.ts](../src/lib/metrics.ts) exempts it in both `validateDataset` and the per-account
history check. The upper bound still applies.

### 6.1 I5 is the headline validation check

`Σ net_cash_amount` over an account equals its **uninvested cash balance** — because every
cash movement in or out of the account is a row, and buys/sells net against them. All eight
accounts land between −$0.00 and $149.13, which is exactly what an idle-cash residual looks
like.

This makes the file self-validating: if the app's parse produces a per-account total that is
large, negative, or wildly off, rows have been dropped, duplicated, or sign-flipped. **This is
the single best regression test for the parser and the merge logic.**

### 6.2 I6 shows why transfers don't always net to zero

`TRANSFER_TF` nets to exactly 0.00 because all three TFSAs are in the export. `TRANSFER` nets
to **+$1,560.80**, not zero, because its counterparties (the WS credit card, and accounts
outside this export) are not present. A non-zero transfer total is expected, not a bug — but
it does mean "internal transfers cancel out" cannot be assumed.

---

## 7. Duplicate rows are real data

**The export has no per-row unique identifier**, and 68 distinct row signatures appear more
than once — 104 extra copies in total, 99 of them TFSA `EFT` deposits.

These are genuine separate transactions (two identical $25 transfers on the same day, two $50
deposits on 2025-11-21), not export artifacts. Verified by the account-balance invariant: they
must be counted individually for I5 to hold.

**Never de-duplicate by row content.** Doing so would delete $-thousands of real activity and
break every total. [merge.ts:1](../src/lib/merge.ts:1) already documents this and merges by
date-window coverage per account instead, which is the correct approach for overlapping
exports.

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

## 9. Reference figures — `activities-export-2026-08-03-2.csv`

Recompute these after any change to parsing or metrics. They are exact.

**Rows:** 2,902 · **Accounts:** 8 · **Range:** 2022-03-31 → 2026-08-01 · **Σ net cash:** $288.76

| Line | n | Amount |
|---|---:|---:|
| EFT in | 639 | +72,369.54 |
| EFT out | 22 | −27,941.64 |
| Direct deposit (`AFT_IN`) | 5 | +9,552.00 |
| Pre-authorized debit (`AFT_OUT`) | 1 | −69.00 |
| Interac e-Transfer out | 10 | −7,450.00 |
| Account transfer (`TRANSFER`) | 73 | +1,560.80 |
| Registered transfer (`TRANSFER_TF`) | 6 | −0.00 |
| Buys | 1465 | −107,447.99 |
| Sells | 76 | +55,975.96 |
| Dividends | 398 | +4,154.99 |
| Interest earned | 31 | +49.25 |
| Bonus payments | 5 | +83.01 |
| Fees | 85 | −474.71 |
| Margin interest charged | 4 | −10.15 |
| Non-resident tax | 36 | −88.61 |
| Management fee refunds | 44 | +25.31 |
| Corporate actions | 2 | 0.00 |

**Derived:** net capital deployed (buys + sells) = **$51,472.03** · gross costs = $573.47,
net of refunds = **$548.16** · total income (dividends + interest + bonus) = **$4,287.25**.

**Rows by year:** 2022: 239 · 2023: 589 · 2024: 686 · 2025: 699 · 2026: 689 (to Aug 1).

**Per account type:**

| Type | Accounts | Rows | Σ net cash |
|---|---:|---:|---:|
| Group RRSP | 1 | 1317 | 149.13 |
| TFSA | 3 | 1081 | 7.55 |
| FHSA | 1 | 263 | 1.12 |
| Chequing | 1 | 171 | 130.96 |
| Crypto | 1 | 48 | 0.00 |
| Non-registered margin | 1 | 22 | −0.00 |

**Open positions (Σ quantity), 25 of 44 symbols:** `BTCC.B` 539.2812 · `ETHY` 502.2687 ·
`ETHH.B` 213.3222 · `ZAG` 119.9363 · `IEFA` 62.5465 · `GSWO` 62.0225 · `QCN` 51.9155 ·
`ZCB` 48.0469 · `ZHY` 45.8658 · `ZUAG.F` 34.6516 · `VTI` 30.9015 · `EEMV` 25.1605 ·
`RDW` 14.5819 · `SMR` 8.6771 · `GLDM` 8.1851 · `ZGLD` 4.3248 · `ASTS` 4.2987 · `ZEA` 2.2374 ·
`INFQ` 2.0000 · `VOO` 0.8242 · `SPCX` 0.5645 · `QUU` 0.4537 · `BWXT` 0.2281 · `KILO.B` 0.1101 ·
`BTC` 0.006782. The other 19 are closed at exactly 0.

**Commission:** non-zero on 20 rows, all `BTC` in the Crypto account. $9.15 on $466.64 gross
= **1.961%** — the crypto spread. Equity and ETF trades are commission-free ($0 on 1,521 rows).

---

## 10. Findings

Discrepancies between this document and the implementation.

### Fixed

1. ~~**`Credit card payment` is misclassified as internal.**~~ The nine `TRANSFER` rows
   totalling −$2,579.11 now match on description ahead of the generic transfer rule and land
   under **Money out** as their own line. (§3.1)
2. ~~**The `cashback` KPI is mislabelled.**~~ `computeKpis` now splits `cashback` ($53.01,
   `CASHBACK` only) from `promo` ($30.00, `REFER` + `GIVEAWAY`), matching how `flowBreakdown`
   already categorised the same rows. A promo-only period now reads "Bonus", not "Cash back".
   (§3.1)
3. ~~**No invariant tests exist.**~~ Vitest added. I1, I2 and I5 run against the *real* file at
   parse time via `validateDataset` in `wealthsimple.ts` — asserting them over hand-built
   fixtures would only test the fixtures. The reference export produces zero violations.

Fixed alongside these, found while verifying:

4. **The chart disagreed with the KPI tiles.** The "Deposits & transfers" measure summed every
   `MoneyMovement` row, while `moneyIn`/`moneyOut` exclude cash-account rows and internal
   transfers. Both now route through `isExternalMoneyMovement`; the measure is relabelled
   "Deposits & withdrawals" to match what it counts ($46,058.84).
5. **Cash back sat outside the Income section.** `flowBreakdown` filed `CASHBACK` under the
   internal section while `computeKpis` counted it as income, so the two totals differed by
   $53.01. Cash back is now in Income, and the section total equals `Kpis.income` exactly
   ($4,287.25).
6. **`LegacyCorporateAction` tripped the unknown-type warning** on every real export despite
   being documented and carrying no cash. Added to `KNOWN_ACTIVITY_TYPES`.
7. **Deposits and withdrawals were split by sign, not by what the row says.** `moneyIn` /
   `moneyOut` took every non-transfer `MoneyMovement` in a non-cash account and sorted it on
   the sign of `net_cash_amount`, so the figures were defined by direction rather than by kind
   — any future positive sub-type in an investment account would have been reported as a bank
   deposit. Both now key on the description template (`isBankDeposit` / `isBankWithdrawal`),
   as does `flowBreakdown`'s EFT pair. Totals are unchanged on this export (639 / 22 rows,
   +72,369.54 / −27,941.64) because sign and description agree on every row. (§3.1)

### Open

7. **The export timestamp is discarded.** The footer's "As of" time would let the UI show
   source freshness. (§1.1)
8. **`name` is used unnormalised.** Non-breaking spaces and trailing whitespace will bite any
   grouping or matching on that field. Currently latent — nothing groups by `name` today. (§2.5)
9. **Portfolio value is not derivable from this file.** If the UI implies a portfolio value or
   return anywhere, it is either wrong or is silently sourcing prices elsewhere. (§8)

---

## Appendix — description templates

Useful for parsing, and for spotting a format change.

```
Trade/BUY      <SYM> - <NAME>: Bought <qty> shares at $<price> per share (executed at <date>)
               <SYM> - <NAME>: Bought <qty> shares at $<price> per share (executed at <date>), FX Rate: <rate>
               Purchase of <qty> BTC (executed at <date>), FX Rate: <rate>          [crypto, 24 rows]
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
