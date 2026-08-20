# Live pricing with `yahoo-finance2` — proof of concept

**Status:** POC on `WSA-006`. Works end to end; not yet a decision to ship.
**What it adds:** a **Fetch live prices** button on `/investment` and
`/analytics` that values your holdings against Yahoo Finance in one click,
instead of the export-to-Sheets and import-the-CSV-back round trip — and, from
the same click, a year-by-year valuation that finally puts unrealised gain on
the analytics page (§7), a value line beside net deposits in every page's lead
chart (§5.1), and a sector/industry breakdown of what's actually held (§8).

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

                                                                                        ┌─ valueYears ─ /analytics
                  tickersFor ─ POST /api/prices/history ─ yahoo-finance2 ─ PriceHistory ─┤
                                                                                        └─ valueOverTime ─ CapitalChart
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
| Deposited, Withdrawn, Median/mo | Cash facts, straight from the activity rows | No — and they must not change |
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

One trap is worth writing down, because it cost a real bug. Yahoo stamps a
monthly bar at **midnight on the first, in the exchange's own timezone**, and
hands it over as an instant. `USDCAD=X` trades on `Europe/London`, so during
British Summer Time its bars arrive as `2022-09-30T23:00:00Z` — October, an
hour before UTC agrees. Reading the month off `toISOString()` filed October's
rate under September, September's under August, and so on for every BST month,
with only the last of the run going visibly missing. Nothing looked broken:
five months of rates were simply one month early. December is on GMT, which is
why the year-end conversions the page actually leans on came out right anyway.

[src/lib/market-month.ts](../src/lib/market-month.ts) reads the month in the
timezone the chart's own metadata reports, so there is nothing left to infer.

`valueYears` rebuilds positions once per year, which is a walk of the whole
activity history per year. At the reference dataset's 2,947 rows over five
years that is imperceptible; a twenty-year export would want the walk to emit
year-end snapshots as it goes instead.

## 5.1 The lead chart, month by month

`CapitalChart` — the top chart on the timeline, the dashboard, the investment
page and both account pages — has always drawn one line: capital deployed. Its
own comment explained why a value line would have been invented. With a history
loaded it isn't, so `valueOverTime` runs the same walk as `valueYears` at
monthly resolution and the chart draws **both lines in one frame**: what went
in, and what it came to. The gap between them is the gain, without a tab to
switch or a second chart to compare against.

The line that went in is **net deposits**, not capital deployed. Capital
deployed answers "how much is in positions" and moves every time you trade;
against a value that includes cash it would show a gap that changes when you
buy. Net deposits — every `MoneyMovement` row, so a transfer between two of
your own accounts cancels — only moves when money crosses the boundary of the
portfolio, which makes the gap exactly what the accounts earned.

**This argument later won everywhere.** The chart was the only surface using it;
every other one led with capital deployed under the label "Invested", so the app
disagreed with its own lead chart. `Kpis.netCapitalDeployed` and
`CapitalPoint.invested` have since been removed outright and net deposits is now
the single portfolio-level figure — the analytics page dropped its Invested and
Median-invested/mo columns rather than restate deposits a fourth way beside
Deposited, Withdrawn and Transfers. The one survivor of the name is
`Position.costBasis` (renamed from `invested`), which is per-holding gross buys
and answers a different question: what `realizedPnl` is a return on.

Three things it does deliberately:

- **Cash is in the value line.** It is the `value` figure `valueYears` already
  emits — holdings at that month's close, anything unpriced at book cost, plus
  the cash balance — so the chart and the analytics table cannot disagree.
- **The last point is today's quote**, not last month's close, valued through
  `valueWith` exactly as the investment page's Market value tile is. The line
  therefore ends on the number that tile shows.
- **Monthly values ride over daily capital points** via `connectNulls`. The
  deposits line keeps its per-activity-day fidelity; the value line has an
  anchor per month end and one for today.

Two edges worth knowing. Yahoo's first monthly bar starts *after* the requested
range opens, so the earliest month of any history has no close and that month
falls back to book cost — which is why the chart only names a symbol as
unpriced when the *latest* point still can't price it. And the walk now runs
per month rather than per year, so the note above about a twenty-year export
applies twelve times over; it is memoised per dataset and price history, and a
five-year export is still imperceptible.

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
3. ~~**A production build check.**~~ Done on `WSA-007`: `pnpm build` compiles
   and prerenders clean, with both API routes served on demand.
   `serverExternalPackages` is set for `yahoo-finance2` in `next.config.ts`
   because its dnt-generated entry point pulls a `createRequire` polyfill that
   bundlers dislike — that reasoning now holds up under a real build.
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
**Fetch live prices**. Three toasts follow: the quote lands in well under a
second, the monthly history a few seconds later, and the sector classification
last — skipped with no toast at all once every holding is already classified
and fresh. The first reports how many holdings priced, the USD→CAD rate if
anything needed converting, and any symbol Yahoo couldn't quote; the second
reports how many years it could value; the third names anything Yahoo couldn't
classify. The sector breakdown itself lives on the analytics page, below the
year-by-year table.

If the history or the classification fails, the snapshot stands — the
investment page is already correct, and each later leg falls back to what it
did before this existed, independently of the others.

Any route can be exercised on its own:

```bash
curl -s -X POST http://localhost:3000/api/prices -H 'content-type: application/json' -d '{"symbols":[{"symbol":"VFV","ticker":"VFV.TO"},{"symbol":"VTI","ticker":"VTI"},{"symbol":"BTC","ticker":"BTC-CAD"}]}'
```

```bash
curl -s -X POST http://localhost:3000/api/prices/history -H 'content-type: application/json' -d '{"from":"2022-03-31","to":"2026-08-10","symbols":[{"symbol":"VFV","ticker":"VFV.TO"},{"symbol":"VTI","ticker":"VTI"}]}'
```

## 8. Sector and industry, the third route

A quote says what a holding is worth; the history says what it was worth. Neither
says what it *is* — a `VFV.TO` and a `SHOP.TO` quote exactly the same way, but
one is 500 companies and the other is one. The export has no security metadata
beyond ticker and name (§8 of the CSV format doc) to tell them apart, so this is
entirely Yahoo's answer, fetched the same way the other two are:
[src/app/api/profiles/route.ts](../src/app/api/profiles/route.ts), via
`yahooFinance.quoteSummary(ticker, { modules: ["quoteType", "assetProfile",
"fundProfile", "topHoldings"] })`.

Two things about what Yahoo actually returns are easy to get wrong, and both
determine how `src/lib/sectors.ts` reads the response:

- **A fund reports no sector of its own.** `assetProfile.sector` is `null` for
  every ETF checked — `VFV.TO`, `XEQT.TO`, `VTI`. What a fund carries instead is
  `topHoldings.sectorWeightings`, the look-through mix of what it holds. There is
  no equivalent for industry: `topHoldings` has no `industryWeightings` field,
  and its `holdings` list is a top-holdings summary (for `VFV.TO`, one entry —
  `VOO: 100%`), not a security-by-security breakdown. A fund can be attributed
  to a sector; it cannot, from this API, be attributed to an industry. The UI
  says so rather than inventing one.
- **The weights are normalised to the equity sleeve, not to the fund.**
  `VFV.TO`'s `sectorWeightings` sum to exactly `1.0000` while its
  `stockPosition` is `0.9957` — the rest sits in cash (`0.0022`) and "other"
  (`0.0020`). A weight applied to a holding's full value without first scaling
  by `stockPosition` hands that remainder to the sectors for free, and the
  breakdown stops reconciling with what the fund is actually worth.
  `sectors.ts` scales every sector weight by `stockPosition` and gives the
  `bondPosition`/`cashPosition`/`otherPosition` sleeves their own slices, plus a
  residual for whatever those four don't cover — a fund with a preferred or
  convertible allocation this app doesn't ask Yahoo for still has its full value
  land somewhere.

Two smaller findings, both handled as misses rather than guesses: `quoteType`
gives the instrument kind (`EQUITY`, `ETF`, `MUTUALFUND`, `CRYPTOCURRENCY`), and
a `CRYPTOCURRENCY` quote carries no sector, category, or weights at all —
`BTC-CAD`'s profile is classified from the export's own `listing` instead, the
same way its ticker is guessed rather than looked up. And Yahoo speaks two
dialects of its own sector vocabulary: `assetProfile.sectorKey` is hyphenated
(`real-estate`), `topHoldings.sectorWeightings` keys are snake_case with no
separator at all for real estate (`realestate`) — the route normalises the
former to the latter so an equity and a fund's look-through land in the same
bucket rather than two.

The route amplifies exactly as the history route does — one Yahoo request per
symbol — and inherits the same `queue: { concurrency: 4 }` for the same reason.
It is, however, the one of the three most worth caching: a company's sector
essentially never changes, and a fund's weights drift quarterly at most.
`usePriceStore` persists every profile it fetches, keyed by symbol with the
instant it was fetched, and `symbolsNeedingProfiles` narrows a request to
symbols never profiled or profiled over 30 days ago — so a repeat click on an
already-classified portfolio sends nothing at all. Client-side narrowing against
the app's own stored copy, in other words, not a server-side cache — the same
choice §6.6 makes for history, for the same reason: a shared cache on a
deployed instance would make the operator retain which symbols were looked up
for longer than a single request needs to.

```bash
curl -s -X POST http://localhost:3000/api/profiles -H 'content-type: application/json' -d '{"symbols":[{"symbol":"VFV","ticker":"VFV.TO"},{"symbol":"AAPL","ticker":"AAPL"},{"symbol":"BTC","ticker":"BTC-CAD"}]}'
```
