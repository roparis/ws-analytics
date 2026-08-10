# Live pricing with `yahoo-finance2` — proof of concept

**Status:** POC on `WSA-006`. Works end to end; not yet a decision to ship.
**What it adds:** a **Fetch live prices** button on `/investment` and
`/analytics` that values your holdings against Yahoo Finance in one click,
instead of the export-to-Sheets and import-the-CSV-back round trip — and, from
the same click, a year-by-year valuation that finally puts unrealised gain on
the analytics page (§7).

---

## 1. Why this needs a server, and what that costs

Yahoo has no public API. `yahoo-finance2` drives the endpoints the website uses,
and those cannot be called from a page: they send no CORS headers, and they want
a consent cookie and a crumb before the first quote. The package says so itself —
*"It's not possible to run this in the browser."*

So this POC introduces the first server-side code in the app:
[src/app/api/prices/route.ts](../src/app/api/prices/route.ts).

That is a real change to the project's shape, and the README's claim of "no
backend, no data leaving your machine" needs revisiting before this merges.
Precisely:

| | Before | With this POC |
|---|---|---|
| Activity CSV | Parsed in the tab, never uploaded | Unchanged — never uploaded |
| Share counts, book cost, accounts | Derived in the tab | Unchanged — never sent |
| Prices | Google Sheets, via a file you download and re-upload | Yahoo, via this app's own server process |
| What crosses the wire | Nothing | **Ticker symbols only**, e.g. `["VFV.TO", "VTI"]` |

Run locally with `pnpm dev`, that server process is on the same machine as the
browser, and the only outbound request is the app asking Yahoo about tickers.
Deployed somewhere shared, it isn't: whoever runs the deployment can see which
symbols were looked up, though never how many shares or in what account.

The request body carries symbols and nothing else, and it is a POST so tickers
stay out of URLs and access logs.

## 2. How it fits the existing pricing code

Both paths write the same `PriceSnapshot`, so nothing downstream had to change:

```
buildPositions ─┬─ tickersFor ─ POST /api/prices ─ yahoo-finance2 ─┐
                │                                                  ├─ PriceSnapshot ─ valueWith ─ the page
                └─ export .xlsx ─ Sheets ─ download .csv ─ parsePriceCsv ─┘

                  tickersFor ─ POST /api/prices/history ─ yahoo-finance2 ─ PriceHistory ─ valueYears ─ /analytics
```

`PriceSnapshot` gained three optional fields — `source`, `quotedAt`, and a
`fileName` that is now optional because a live fetch has no file. Snapshots
already in IndexedDB from before this branch have no `source` and read as
`"sheet"`, which is what they are.

The sheet round trip stays, and should: it needs no server, it survives Yahoo
changing its mind, and its ticker column is editable when a guess is wrong.

| | Sheets | Yahoo |
|---|---|---|
| Clicks | ~6, across two apps | 1 |
| Needs a server | No | Yes |
| Fix a bad ticker | Edit the cell | Not yet — see §5 |
| Breaks when | Google changes `GOOGLEFINANCE` | Yahoo changes an endpoint |

## 3. Ticker mapping

Wealthsimple's export gives a bare symbol and no exchange, so the ticker is a
guess — the same guess `googleTickerGuess` makes, in Yahoo's dialect
([src/lib/yahoo-ticker.ts](../src/lib/yahoo-ticker.ts)):

| Listing | Export | Google | Yahoo |
|---|---|---|---|
| Canadian | `VFV` | `TSE:VFV` | `VFV.TO` |
| Canadian, class share | `CTC.A` | `TSE:CTC.A` | `CTC-A.TO` |
| US | `VTI` | `VTI` | `VTI` |
| US, class share | `BRK.B` | `BRK.B` | `BRK-B` |
| Crypto | `BTC` | `CURRENCY:BTCCAD` | `BTC-CAD` |

Listing comes from `detectListing`, which reads the `FX Rate:` marker that
Wealthsimple puts on US-listed rows and nowhere else.

A ticker Yahoo doesn't know comes back as a **miss**, not a zero: the holding
falls through to book cost and the UI names the symbol, exactly as an
unresolvable `GOOGLEFINANCE` row does today.

## 4. Currency

Yahoo quotes each instrument in its own currency. `USDCAD=X` rides along in the
same request, and US-quoted prices are multiplied by it. Crypto is asked for as a
CAD pair directly, which avoids converting twice. Anything quoted in a third
currency — a London or Frankfurt listing — is refused as a miss rather than
guessed at.

## 5. The analytics page, year by year

A quote answers "what is this worth now". The analytics page asks a different
question — "what was this worth at the end of 2023" — and no quote can answer
it. `POST /api/prices/history` pulls **monthly closes** for the whole period
the export covers, and [src/lib/price-history.ts](../src/lib/price-history.ts)
turns them into a valuation per year and account type.

The share count is the half that isn't Yahoo's. It comes from re-walking the
activity history up to each year end with the same `buildPositions` the rest of
the app uses — so a year you added to counts what the new shares did, and a
year you sold in counts only what you still held. Applying today's share count
to a past year's price would have been simpler and wrong.

That unlocks the figure the page has never had:

| Column | What it is | Needs prices |
|---|---|---|
| Deposited, Withdrawn, Invested, Median/mo | Cash facts, straight from the activity rows | No — and they must not change |
| Dividends, Fees & tax, **Earned** | What the year paid out, in cash | No |
| **Value at year end** | Holdings at that December's close, plus cash | Yes |
| **Unrealised change** | How the paper gain on unsold holdings moved | Yes |
| **Total return** | `Earned + Unrealised change` | Yes |

Only the last three are new, and that is the point: deposits and withdrawals
are records of money moving, and a price has nothing to say about them.
Connecting them to a market feed would not make them more accurate, only less
true. Every priced column reads `—` rather than `$0.00` where the history has
no answer, and the measures don't appear at all until a history is loaded.

Three things to know about the numbers:

- **The current year is valued at the last day your files cover**, not at a 31
  December that hasn't happened. The tooltip on each cell says which date it
  used.
- **Each month converts at its own USD→CAD**, not today's rate. Restating 2022
  at this morning's dollar would move every past figure for a reason that has
  nothing to do with the portfolio.
- **A holding Yahoo can't chart is held at book cost** for those years and
  named in the tooltip — the same rule the live snapshot follows.

`valueYears` rebuilds positions once per year, which is a walk of the whole
activity history per year. At the reference dataset's 2,947 rows over five
years that is imperceptible; a twenty-year export would want the walk to emit
year-end snapshots as it goes instead.

## 6. What a shippable version still needs

1. **An editable ticker.** The sheet's best feature is that a wrong guess is a
   cell you can fix. Here a miss is a dead end. A per-symbol override, stored
   beside the snapshot, is the obvious next piece.
2. **Rate limiting and abuse control.** Both routes cap a request at
   `MAX_SYMBOLS` (100) and validate ticker shape, and that is all. Deployed
   publicly they are an open Yahoo proxy — and the history route is the
   expensive one, since Yahoo's chart endpoint takes a single symbol per
   request. A 44-holding portfolio is 45 requests, which the client queue runs
   four at a time in about ten seconds.
3. **A production build check.** `pnpm build` was *not* run — it writes to
   `.next`, which the running dev server owns. `serverExternalPackages` is set
   for `yahoo-finance2` in `next.config.ts` because its dnt-generated entry
   point pulls a `createRequire` polyfill that bundlers dislike, but that
   reasoning is untested until someone builds it.
4. **A decision about the README.** See §1.
5. **Terms of use.** `yahoo-finance2` is unofficial and unaffiliated with Yahoo;
   its own README disclaims any guarantee of availability or consistency. That
   is a fine footing for a self-hosted tool and a poor one for a hosted service.
6. **Caching.** Every click is a fresh call. Quotes go stale in minutes, but a
   closed month never changes — last December's close is settled forever. The
   history route is the one that should be cached, and isn't.

## 7. Trying it

```bash
pnpm dev
```

Load an activities CSV, open **Investments** or **Analytics**, and click
**Fetch live prices**. Two toasts follow: the quote lands in well under a
second, and the monthly history a few seconds later. The first reports how many
holdings priced, the USD→CAD rate if anything needed converting, and any symbol
Yahoo couldn't quote; the second reports how many years it could value.

If the history fails the snapshot stands — the investment page is already
correct, and the analytics page falls back to book cost.

Either route can be exercised on its own:

```bash
curl -s -X POST http://localhost:3000/api/prices -H 'content-type: application/json' -d '{"symbols":[{"symbol":"VFV","ticker":"VFV.TO"},{"symbol":"VTI","ticker":"VTI"},{"symbol":"BTC","ticker":"BTC-CAD"}]}'
```

```bash
curl -s -X POST http://localhost:3000/api/prices/history -H 'content-type: application/json' -d '{"from":"2022-03-31","to":"2026-08-10","symbols":[{"symbol":"VFV","ticker":"VFV.TO"},{"symbol":"VTI","ticker":"VTI"}]}'
```
