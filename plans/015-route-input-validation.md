# Plan 015: Bound and de-duplicate the API routes' input validation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat d1d2640..HEAD -- src/app/api/prices/route.ts src/app/api/prices/history/route.ts src/lib/live-prices.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none. If `plans/010` is queued, land it first — it also edits
  `src/app/api/prices/history/route.ts`, in a different function.
- **Category**: security
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

The two price routes are the only place in this app that accepts untrusted
input — the quote route's own comment says so. Three things are wrong with how
they handle it, and all three are cheap to fix.

**`symbol` is unbounded while `ticker` is tightly bounded.** `ticker` is
validated to 1–20 characters from a fixed alphabet, with a comment explaining
why. `symbol` — sitting immediately beside it in the same object — accepts any
non-empty string of any length and any charset. And `symbol` is what gets
**echoed back** in every quote, every miss, and every history series. The
asymmetry is invisible unless you read both validators side by side.

**Upstream error text is relayed verbatim to the client.** On a 502 the routes
return `` `Yahoo Finance didn't answer: ${error.message}` ``, and that `message`
is the raw upstream response body — whatever Yahoo returned, including
rate-limit notices, handshake failures and HTML error pages. On a deployed
instance that is an unauthenticated read of the deployment's upstream session
state.

**The two validators are copy-pasted.** Five checks are duplicated verbatim
between them, including the ticker regex. They will drift, and nothing catches
it — neither route has a single test, which is not a coincidence: they are the
only modules with no testable seam.

Extracting the shared validator into `src/lib/` fixes the third problem and
makes the first two testable in the same move.

## Current state

### The quote route's validator

Verified excerpt, `src/app/api/prices/route.ts:141-167`:

```ts
/** Parses the body defensively — this is the app's only untrusted input. */
function readSymbols(body: unknown): PriceRequestSymbol[] {
	const symbols = (body as LivePriceRequest | null)?.symbols;
	if (!Array.isArray(symbols)) {
		throw new Error("Expected a JSON body with a `symbols` array.");
	}
	if (symbols.length === 0) {
		throw new Error("No symbols to quote.");
	}
	if (symbols.length > MAX_SYMBOLS) {
		throw new Error(`At most ${MAX_SYMBOLS} symbols per request.`);
	}

	return symbols.map((entry) => {
		const symbol = stringOrNull(entry?.symbol)?.trim();
		const ticker = stringOrNull(entry?.ticker)?.trim();
		if (!symbol || !ticker) {
			throw new Error("Every entry needs a `symbol` and a `ticker`.");
		}
		// Tickers go into a query string; Yahoo's own alphabet is letters, digits
		// and `.-=^`, so anything else is a caller doing something else.
		if (!/^[A-Za-z0-9.=^-]{1,20}$/.test(ticker)) {
			throw new Error(`"${ticker}" isn't a ticker.`);
		}
		return { symbol, ticker };
	});
}
```

### The history route's validator — the same five checks again

Verified excerpt, `src/app/api/prices/history/route.ts:192-236`:

```ts
function readRequest(body: unknown): {
	symbols: PriceRequestSymbol[];
	from: string;
	to: string;
} {
	const input = body as PriceHistoryRequest | null;
	const symbols = input?.symbols;

	if (!Array.isArray(symbols)) {
		throw new Error("Expected a JSON body with a `symbols` array.");
	}
	if (symbols.length === 0) {
		throw new Error("No symbols to chart.");
	}
	if (symbols.length > MAX_SYMBOLS) {
		throw new Error(`At most ${MAX_SYMBOLS} symbols per request.`);
	}

	const from = isoDate(input?.from);
	const to = isoDate(input?.to);
	if (!from || !to) {
		throw new Error("`from` and `to` must be `YYYY-MM-DD` dates.");
	}
	if (from > to) {
		throw new Error("`from` is after `to`.");
	}

	return {
		from,
		to,
		symbols: symbols.map((entry) => {
			const symbol =
				typeof entry?.symbol === "string" ? entry.symbol.trim() : "";
			const ticker =
				typeof entry?.ticker === "string" ? entry.ticker.trim() : "";
			if (!symbol || !ticker) {
				throw new Error("Every entry needs a `symbol` and a `ticker`.");
			}
			if (!/^[A-Za-z0-9.=^-]{1,20}$/.test(ticker)) {
				throw new Error(`"${ticker}" isn't a ticker.`);
			}
			return { symbol, ticker };
		}),
	};
}
```

Duplicated verbatim: the array check, the empty check, the `MAX_SYMBOLS` check,
the per-entry presence check, and **the ticker regex itself**. The only genuine
differences are the error wording ("quote" vs "chart"), the `symbol` extraction
style (behaviourally identical), and the `from`/`to` validation the history route
adds.

### Where `symbol` is echoed back

The quote route spreads the caller's entry into every response object —
`route.ts:83-86`, `:93-99`, `:102-112`. The history route does the same at
`:76-82`, `:104-110`. So an unbounded `symbol` is retained through the whole
upstream fan-out and returned.

### The error relay

Verified excerpt, `src/app/api/prices/route.ts:126-138`:

```ts
	} catch (error) {
		// Yahoo being down, rate-limiting, or changing its handshake are all
		// normal operating conditions for an unofficial API. Say so plainly rather
		// than leaving the page with a spinner and a stale snapshot.
		console.warn("Yahoo Finance quote failed:", error);
		return fail(
			`Yahoo Finance didn't answer: ${
				error instanceof Error ? error.message : "unknown error"
			}`,
			502,
		);
	}
```

The comment's intent — say plainly that Yahoo failed — is right. Relaying
`error.message` is how it is achieved, and that is the part to change: the
message is the upstream response body, not a description of the failure.

The history route has the identical pattern at `:126-132`, plus a per-symbol
variant at `:183-188` that writes `error.message` into a `misses[].reason` which
ships in a 200 response.

Note the client already degrades gracefully — `src/lib/live-prices.ts` reads
`parsed.error` when `!response.ok` and falls back to a status-code message
otherwise. And `historyFromResponse` (`src/lib/price-history.ts:56`) discards
`reason` entirely and keeps only `miss.symbol`, so nothing downstream parses
these strings.

### What the app's own client sends

Verified excerpt, `src/lib/live-prices.ts:195-208` (via the private `post`):

```ts
	response = await fetch(endpoint, {
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
```

Endpoints are relative same-origin paths (`PRICES_ENDPOINT = "/api/prices"` at
`:109`, `HISTORY_ENDPOINT = "/api/prices/history"` at `:112`). Both public
functions call `guard(symbols)` first, which enforces `MAX_SYMBOLS` client-side.

`tickersFor` (`src/lib/yahoo-ticker.ts:59-73`) is the only producer of these
entries, and it only ever emits ticker-shaped values for both fields — so
bounding `symbol` to the same alphabet rejects nothing the app itself sends.

### `MAX_SYMBOLS` and why it exists

Verified excerpt, `src/lib/live-prices.ts:99-107`:

```ts
/**
 * The most symbols one request may carry.
 *
 * Yahoo takes a comma-separated list and answers in one round trip, so the cap
 * isn't about batching — it's a ceiling on what a public deployment of this
 * route can be asked to do on someone else's behalf. Portfolios this app is
 * built for hold tens of positions.
 */
export const MAX_SYMBOLS = 100;
```

`src/lib/live-prices.ts` already owns the request types and this constant, which
is what makes it the right home for the shared validator.

### Repo conventions

- **Tabs** for indentation; Biome auto-sorts imports.
- Comments are prose explaining *why*.
- Tests colocated as `src/lib/*.test.ts`, `environment: "node"`, **no mocks
  anywhere** in the suite.
- `src/lib/live-prices.test.ts` already exists — extend it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, 228 baseline + new |
| One file | `pnpm test live-prices` | all pass |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings) |
| Build | `pnpm build` | exit 0 |

## Scope

**In scope**:
- `src/lib/live-prices.ts` — new shared validator
- `src/lib/live-prices.test.ts` — its tests
- `src/app/api/prices/route.ts`
- `src/app/api/prices/history/route.ts`

**Also in scope — added after the app was found to be in production:**
- An `Origin` / `Sec-Fetch-Site` check on both routes (Step 7)
- A lower symbol ceiling on the **history** route specifically (Step 8)

> **Why these moved in.** An earlier revision of this plan excluded both,
> reasoning that they were near-worthless "for a local-first single-user run"
> and that rate limiting "needs the unresolved hosting decision first". That
> premise was wrong: `https://ws-analytics.vercel.app` has been serving
> production since 2026-08-11, running this exact build. So
> `docs/yahoo-pricing-poc.md` §6 item 2 — *"Deployed publicly they are an open
> Yahoo proxy — and the history route is the expensive one"* — is describing
> production, not a hypothetical.

**Out of scope** (do NOT do these):
- **A shared-store rate limiter** (Upstash, Redis, Vercel KV). It is the robust
  answer and it introduces an infrastructure dependency this app has never had.
  That is the maintainer's call, not an executor's. Steps 7 and 8 are the
  no-new-infrastructure mitigations; if they are judged insufficient, the
  follow-up is its own plan.
- **Vercel WAF / firewall rules.** Platform configuration, not code, and not in
  this repository.
- **The `yahoo-finance2` library's own logging.** It calls `console.error(url)`
  on any non-OK response, with the ticker list in the query string. That is
  **not** suppressible by passing a custom logger — the call is not routed
  through the configurable one. It needs a different approach and its own change.
- `queue: { concurrency: 4 }` and `MAX_SYMBOLS`. Both deliberate.
- A request body size limit. Reasonable, but it needs a measured ceiling from a
  real worst-case payload; bounding `symbol` removes most of the exposure for
  none of that work.
- The FX-failure handling in `history/route.ts:58-73` — that is `plans/010`'s.
- Adding jsdom or an HTTP test harness. The extraction is what creates the
  testable seam; use it.

## Git workflow

- Branch: `advisor/015-route-input-validation`
- Three commits, one per concern. Messages in repo style (imperative,
  sentence-case, no conventional-commit prefix):
  - `Validate a symbol as tightly as the ticker beside it`
  - `Say that Yahoo failed without repeating what it said`
  - `Share one validator between the two routes that copy it`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Record the baseline

**Verify**: `pnpm typecheck && pnpm test && pnpm check` → exit 0, with
`Tests 228 passed (228)`. If the count differs, the tree has drifted — STOP.

### Step 2: Extract the shared validator into `src/lib/live-prices.ts`

Add an exported function that performs the five duplicated checks and returns
the validated symbol list, throwing an `Error` with a clear message on failure —
matching the current contract, since both routes already catch and turn the
message into a 400.

Suggested shape (adapt to fit the existing types in that file):

```ts
/**
 * Validates the `symbols` array both routes take.
 *
 * Extracted rather than duplicated: the two routes carried byte-identical
 * copies of these checks, including the ticker pattern, which is exactly the
 * kind of thing that drifts silently. `noun` only varies the error wording
 * ("quote" vs "chart"), which is the sole difference the copies actually had.
 */
export function readRequestSymbols(
	symbols: unknown,
	noun: string,
): PriceRequestSymbol[]
```

Keep the existing error wording so no behaviour changes yet — the "No symbols to
quote." / "No symbols to chart." difference is what `noun` is for.

Preserve the comment explaining the ticker alphabet; it is the reason the regex
looks the way it does.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Bound `symbol` the same way `ticker` is bounded

In the extracted validator, apply the same length and charset constraint to
`symbol` that `ticker` already gets.

This is safe: `tickersFor` (`src/lib/yahoo-ticker.ts:59-73`) is the only
producer of these entries in the app, and every value it emits for `symbol`
comes from `Position.symbol` — a Wealthsimple ticker. Confirm this by reading
that function before you change anything.

Add a comment explaining why both fields are bounded: `symbol` is echoed back in
every response and retained across the whole upstream fan-out, so an unbounded
one is retained memory and reflected output for no benefit.

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `pnpm build` → exit 0.

### Step 4: Point both routes at the shared validator

- `src/app/api/prices/route.ts` — replace the body of `readSymbols` with a call
  to the shared function, or delete `readSymbols` and call the shared function
  directly at the call site (`:51`). Prefer whichever leaves less indirection.
- `src/app/api/prices/history/route.ts` — same for the `symbols` half of
  `readRequest`. **Keep `isoDate` and the `from`/`to` ordering check where they
  are** — they are genuinely history-specific and are not duplicated.

**Verify**: `grep -c "A-Za-z0-9.=\^-" src/app/api/prices/route.ts src/app/api/prices/history/route.ts`
→ **0 in both**. The regex now lives in exactly one place.

**Verify**: `pnpm typecheck && pnpm build` → exit 0.

### Step 5: Stop relaying upstream error text

Replace the interpolated `error.message` in the client-facing responses with a
fixed message per failure class. Three sites:

- `src/app/api/prices/route.ts:132-137` (502)
- `src/app/api/prices/history/route.ts:127-132` (502)
- `src/app/api/prices/history/route.ts:183-188` (the per-symbol
  `misses[].reason`, which ships in a 200)

Keep the *server-side* `console.warn` so the detail stays diagnosable — but log
the error's class and a symbol **count**, not the symbols themselves.

For the per-symbol miss reason, the route already knows the ticker it asked
about; a message naming the ticker and saying Yahoo could not chart it is both
more useful and carries no upstream text. `historyFromResponse` discards
`reason` anyway, so nothing downstream breaks.

Preserve the intent of the existing comment at `route.ts:127-129`: the user
should still be told plainly that Yahoo did not answer.

**Verify**: `grep -n "error.message" src/app/api/prices/route.ts src/app/api/prices/history/route.ts`
→ no matches in any response body. (Matches inside a `console.warn` are
acceptable only if they do not include the URL — see STOP conditions.)

**Verify**: `pnpm build` → exit 0.

### Step 6: Test the extracted validator

Add a `describe` block to `src/lib/live-prices.test.ts`. Cases in the Test plan
below. This is the first test coverage either route's validation has ever had.

**Verify**: `pnpm test live-prices` → all pass.

### Step 7: Reject cross-site requests

The only legitimate caller is this app's own browser code. Verified — the entire
client side of both routes is `post` in `src/lib/live-prices.ts`:

```ts
	response = await fetch(endpoint, {
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
```

with relative same-origin endpoints (`/api/prices`, `/api/prices/history`). A
browser attaches `Origin` and `Sec-Fetch-Site` automatically to that request, so
a check costs the real client nothing.

Add to both handlers, before `request.json()`: reject when `Sec-Fetch-Site` is
present and is not `same-origin`, and reject when `Content-Type` is not JSON.
Return 403 with the same `{ error }` body shape the routes already use — the
client degrades gracefully on any non-OK status
(`src/lib/live-prices.ts` reads `parsed.error`, falling back to a status-code
message).

Note the content-type half matters on its own: `Request.json()` parses the body
regardless of declared type, so a cross-site form-style POST never triggers a
CORS preflight today.

**This is the cheapest meaningful mitigation for a public deployment** — it
closes the path where a third-party page makes its visitors' browsers drive your
Yahoo quota, without the attacker needing to know the deployment URL from their
own server.

**Trade-off to state in your report**: it breaks non-browser callers, including
the `curl` examples in `docs/yahoo-pricing-poc.md` §7. Those examples send
`content-type: application/json` so they pass that half, but they send no
`Sec-Fetch-Site`, so the "present and not same-origin" wording matters — an
absent header must be **allowed**, or you break every `curl`. Get that condition
right and say in your report which requests you confirmed still pass.

**Verify**: `pnpm typecheck && pnpm build` → exit 0.

### Step 8: Cut the history route's amplification

The history route issues **one upstream Yahoo request per symbol**, plus one for
FX. At the shared `MAX_SYMBOLS = 100` that is up to 101 upstream requests for a
single inbound request — a 100× amplification, and the concrete reason the POC
doc calls this route "the expensive one".

`MAX_SYMBOLS` is shared by both routes today. The quote route genuinely answers
100 symbols in **one** upstream round trip, so its cap is fine. Introduce a
separate, lower ceiling for the history route only.

Pick the number from the app's real usage, not from thin air: `tickersFor`
produces one entry per distinct held symbol, and the POC doc's worked example is
a 44-holding portfolio. A ceiling around **60** leaves real portfolios untouched
while halving the worst case. State the number you chose and why in your report.

Keep `MAX_SYMBOLS` itself unchanged — the quote route and the client-side
`guard` both use it, and lowering it would reject legitimate quote requests.

**Verify**: `pnpm test` → exit 0, and the new ceiling is unit-tested alongside
the shared validator from Step 2.

### Step 9: Full verification

**Verify**: `pnpm typecheck && pnpm test && pnpm check && pnpm build` → exit 0.

**Verify**: `pnpm check` prints exactly 5 warnings, all in
`src/lib/google-sheet.ts`.

**Verify**: `git status --short` lists only the four in-scope files.

## Test plan

New cases in `src/lib/live-prices.test.ts`, against the extracted validator — no
mocks needed, which is the point of extracting it:

| # | Input | Expected |
|---|---|---|
| 1 | A valid two-entry list | Returns both, trimmed |
| 2 | Not an array | Throws, message mentions `symbols` |
| 3 | Empty array | Throws, message contains the `noun` |
| 4 | `MAX_SYMBOLS + 1` entries | Throws, message names the cap |
| 5 | Exactly `MAX_SYMBOLS` entries | Accepted — the boundary is inclusive |
| 6 | Entry missing `ticker` | Throws |
| 7 | Entry missing `symbol` | Throws |
| 8 | `ticker` with a disallowed character | Throws |
| 9 | `ticker` longer than 20 chars | Throws |
| 10 | **`symbol` longer than 20 chars** | Throws — the new bound |
| 11 | **`symbol` with a disallowed character** | Throws — the new bound |
| 12 | Entries with surrounding whitespace | Trimmed on both fields |
| 13 | Real shapes from `tickersFor` — `VFV.TO`, `CTC-A.TO`, `BRK-B`, `BTC-CAD`, `USDCAD=X` | All accepted |

Case 13 is the regression guard that matters: it proves the new `symbol` bound
rejects nothing the app itself produces. Derive the values by reading
`src/lib/yahoo-ticker.ts` rather than copying them from this table.

Cases 10 and 11 should be written **before** Step 3 and observed failing, so you
know they test the new constraint rather than a pre-existing one.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; all 228 pre-existing tests pass, plus at least 13 new
      cases
- [ ] `pnpm check` exits 0 with exactly 5 warnings, all in
      `src/lib/google-sheet.ts`
- [ ] `pnpm build` exits 0
- [ ] `grep -c "A-Za-z0-9.=\^-" src/app/api/prices/route.ts` returns 0
- [ ] `grep -c "A-Za-z0-9.=\^-" src/app/api/prices/history/route.ts` returns 0
- [ ] `grep -c "A-Za-z0-9.=\^-" src/lib/live-prices.ts` returns 1
- [ ] No `error.message` from an upstream call appears in any response body in
      either route file
- [ ] `grep -n "concurrency" src/app/api/prices/history/route.ts` still shows `4`
- [ ] `grep -n "MAX_SYMBOLS = " src/lib/live-prices.ts` still shows `100`
      (unchanged — the quote route and the client guard both use it)
- [ ] Both routes reject a request whose `Sec-Fetch-Site` is `cross-site`
- [ ] Both routes still accept a request with **no** `Sec-Fetch-Site` header
      (the `curl` examples in `docs/yahoo-pricing-poc.md` §7 must keep working)
- [ ] The history route enforces its own lower symbol ceiling, unit-tested
- [ ] `git status --short` lists only the four in-scope files
- [ ] `plans/README.md` status row for 015 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Bounding `symbol` rejects a value that `tickersFor` actually produces. Report
  the value — it means the bound is wrong, not the producer.
- You find a caller of these routes other than `src/lib/live-prices.ts`. The
  `curl` examples in `docs/yahoo-pricing-poc.md` §7 do not count; they send
  ticker-shaped values.
- Cases 10 and 11 pass before Step 3 lands. They should fail — passing means
  they are not testing the new bound.
- An origin check would reject the app's own client. Report what header the real
  request actually carries rather than loosening the check until it passes.
- You conclude the mitigations in Steps 7 and 8 are insufficient and a shared
  store (Redis/Upstash/Vercel KV) is required. Say so and stop — adding an
  infrastructure dependency is the maintainer's decision.
- You find yourself trying to suppress `yahoo-finance2`'s internal
  `console.error(url)`. It is not routed through the configurable logger and
  cannot be suppressed that way — report it rather than attempting a workaround.
- Any of the 228 pre-existing tests fails.

## Maintenance notes

For whoever owns this next:

- **The rule this establishes**: every field that crosses the route boundary is
  bounded, and every field that is echoed back is bounded *especially*. If a
  third field is added to `PriceRequestSymbol`, it needs the same treatment.
- **The extraction is what makes this testable.** Route handlers under
  `src/app/` are not reachable by the test suite's `src/**/*.test.ts` glob, so
  logic that needs testing belongs in `src/lib/`. That is the seam to reach for
  next time.
- **Still open after this lands**, all recorded in `plans/README.md` and
  `docs/yahoo-pricing-poc.md` §6: rate limiting, the request-size ceiling, and
  the `yahoo-finance2` URL logging. This plan deliberately takes the three that
  are cheap and self-contained.
- **The client tolerates a terser error.** `src/lib/live-prices.ts` falls back to
  a status-code message when a response has no `error` body, and
  `historyFromResponse` discards `reason` entirely — so shortening these messages
  costs the UI nothing.
- **What a reviewer should scrutinise**: that the ticker regex exists in exactly
  one place afterwards; that no upstream string reaches a response body; that
  the server-side log kept a symbol *count* rather than the symbols; and that
  case 13 covers every ticker shape `yahoo-ticker.ts` can emit.
