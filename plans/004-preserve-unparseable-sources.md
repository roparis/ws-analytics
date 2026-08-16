# Plan 004: Stop deleting a source file's raw text when it fails to re-parse

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat d1d2640..HEAD -- src/lib/storage.ts src/stores/dataset.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. If plan 003 has landed, see the note in Step 2 about the
  `problems` field.
- **Category**: bug
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

This app stores each loaded CSV's raw text in IndexedDB, on purpose — the field
is documented as "Kept so a later parser fix can re-derive instead of trusting
cached rows." For a user who loaded an export months ago and no longer has the
file, that stored copy is **the only copy**.

Today, if `PARSER_VERSION` is bumped and a stored file fails to re-parse under
the new parser, three things happen in sequence:

1. `loadSources` catches the error with an empty block and silently omits that
   file from the returned list.
2. Because at least one *other* file re-parsed successfully, `reparsed > 0`, so
   the store writes the survivors back.
3. `saveSources` begins with `store.clear()` — so the failed file's row, raw
   text included, is deleted from the database.

The user is told nothing. Their totals change. The file is gone.

This is the only swallowed exception in the codebase on a data-loss path, and
the trigger is not exotic: bumping `PARSER_VERSION` is the normal response to a
Wealthsimple format change, and a format change is exactly the thing that makes
an old file fail to parse.

## Current state

Files and their roles:

- `src/lib/storage.ts` — IndexedDB access. `loadSources` re-parses stale
  entries; `saveSources` rewrites the whole store.
- `src/stores/dataset.ts` — the Zustand store; decides when to write back.

### The swallowed failure

Verified excerpt, `src/lib/storage.ts:166-185`:

```ts
		let reparsed = 0;
		const sources: SourceFile[] = [];
		for (const entry of ordered) {
			if (entry.parserVersion === PARSER_VERSION) {
				sources.push({
					fileName: entry.fileName,
					rawText: entry.rawText,
					activities: entry.activities,
				});
				continue;
			}
			try {
				sources.push(await parseActivities(entry.rawText, entry.fileName));
				reparsed++;
			} catch {
				// A file that no longer parses is dropped rather than blocking startup.
			}
		}

		return { sources, reparsed };
```

The comment states a real and correct intent — a bad file must not block
startup. The bug is not the dropping; it is that dropping from the *in-memory
list* silently becomes deletion from the *database*.

### The destructive write-back

Verified excerpt, `src/stores/dataset.ts:41-53`:

```ts
	hydrate: async () => {
		if (get().hydrated) return;
		try {
			const { sources, reparsed } = await loadSources();
			set({ ...withSources(sources), hydrated: true });
			// Rows re-derived under a newer parser are written back so the next
			// load is a straight read.
			if (reparsed > 0) persist(saveSources(sources));
		} catch (error) {
			console.warn("Could not read local storage:", error);
			set({ hydrated: true });
		}
	},
```

Verified excerpt, `src/lib/storage.ts:191-213`:

```ts
export async function saveSources(sources: SourceFile[]): Promise<void> {
	const db = await openDb();
	try {
		const tx = db.transaction([SOURCES, META], "readwrite");
		const store = tx.objectStore(SOURCES);
		store.clear();
		for (const source of sources) {
			store.put({
				fileName: source.fileName,
				rawText: source.rawText,
				activities: source.activities,
				parserVersion: PARSER_VERSION,
			} satisfies StoredSource);
		}
		tx.objectStore(META).put({
			key: ORDER_KEY,
			fileNames: sources.map((source) => source.fileName),
		});
		await done(tx);
	} finally {
		db.close();
	}
}
```

`store.clear()` on line 196 is what turns "omitted from a list" into "deleted
from disk".

Note the precondition: if the *only* stored file fails, `reparsed` is `0`, no
write-back happens, and the data survives. The loss requires at least one
sibling to succeed — which is the common case for anyone who loaded more than
one export.

### Existing conventions to match

Verified excerpt, `src/stores/dataset.ts:30-36` — persistence failures are
reported, never silent:

```ts
// Persistence is best-effort: private browsing and quota limits shouldn't take
// the app down, so failures are logged and the in-memory session continues.
function persist(promise: Promise<unknown>) {
	promise.catch((error) => {
		console.warn("Could not save to local storage:", error);
	});
}
```

And `src/stores/prices.ts` shows the house position on silent failure —
`setSnapshot` sets a `persistFailed` flag with this comment:

> "The write is best-effort, as it is in `dataset.ts` — the session keeps
> working either way. But it is *reported*: swallowing the error would leave
> someone believing their prices are saved when they will be gone on reload,
> which is worse than losing them loudly."

That reasoning is exactly this plan's argument, applied to a worse case.

Other conventions:

- **Tabs** for indentation.
- Comments are prose explaining *why*.
- `@/` path alias for cross-module imports.
- Toasts use `sonner`: `import { toast } from "sonner";`. See
  `src/components/investment/live-prices-button.tsx` for call-site examples
  (`toast.error(message, { description })`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, all pass |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings) |
| Build | `pnpm build` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `src/lib/storage.ts`
- `src/stores/dataset.ts`

**Out of scope** (do NOT touch, even though they look related):
- `src/lib/merge.ts` and the `SourceFile` type. A file that failed to parse has
  no activities and must never reach the merge — it is tracked separately, not
  as a degenerate `SourceFile`.
- `PARSER_VERSION` in `src/lib/wealthsimple.ts`. Do not bump it, for any reason.
- The IndexedDB schema (`STORES`, `StoredSource`, `openAt`, `ensureSchema`). The
  fix needs no schema change — see Step 2.
- `src/lib/wealthsimple.ts`'s `parseActivities`. Making it more tolerant is a
  different plan; here it is allowed to fail, and failing safely is the point.
- The write-ordering hazard between concurrent `saveSources` calls. It is real
  and it was noted during the audit, but it is a separate change with a
  different fix. Do not attempt it here.

## Git workflow

- Branch: `advisor/004-preserve-unparseable-sources`
- Commit message, matching `git log` style (imperative, sentence-case, no
  conventional-commit prefix):
  `Keep a file that stopped parsing instead of deleting it`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Report which files failed to re-parse

In `src/lib/storage.ts`, widen `loadSources`'s return type to name the failures:

```ts
export async function loadSources(): Promise<{
	sources: SourceFile[];
	reparsed: number;
	/**
	 * Files whose stored raw text no longer parses under the current parser.
	 * They are kept in the database — their rows are simply unavailable this
	 * session, so the caller can say so rather than the file vanishing.
	 */
	failed: string[];
}> {
```

Update the loop to collect names instead of discarding them:

```ts
		let reparsed = 0;
		const sources: SourceFile[] = [];
		const failed: string[] = [];
		for (const entry of ordered) {
			if (entry.parserVersion === PARSER_VERSION) {
				sources.push({
					fileName: entry.fileName,
					rawText: entry.rawText,
					activities: entry.activities,
				});
				continue;
			}
			try {
				sources.push(await parseActivities(entry.rawText, entry.fileName));
				reparsed++;
			} catch {
				// The raw text stays in the database: it is the only copy, and a
				// parser fix later may well read it. Dropping it from this session's
				// list keeps startup working; deleting it would not be recoverable.
				failed.push(entry.fileName);
			}
		}

		return { sources, reparsed, failed };
```

Also update the early return above the loop, `src/lib/storage.ts:156`, which
currently reads `if (stored.length === 0) return { sources: [], reparsed: 0 };`
— add `failed: []`.

**Verify**: `pnpm typecheck` → **exit 0**. Widening a return type is not a
breaking change for callers: `dataset.ts` destructures `{ sources, reparsed }`
and TypeScript permits destructuring a subset of a wider object, so it keeps
compiling until Step 3 adds `failed`. (An earlier revision of this plan
predicted a failure here — it was wrong, and the executor who found that was
right to say so.) Any error naming a file other than the two in scope is a STOP
condition.

### Step 2: Make the write-back non-destructive

This is the load-bearing step. `saveSources` must stop being the only writer
that can erase an entry it was never given.

Add a new exported function to `src/lib/storage.ts` that writes only the entries
it is handed, without clearing:

```ts
/**
 * Writes these sources without clearing the store.
 *
 * `saveSources` is a wholesale replace, which is right when the caller owns the
 * complete set. It is wrong after a partial re-parse: a file that failed to
 * parse is absent from the list but still present — and still the only copy of
 * its raw text — in the database.
 */
export async function updateSources(sources: SourceFile[]): Promise<void> {
```

Its body mirrors `saveSources` but:

- **omits `store.clear()`**, and
- **does not rewrite the `ORDER_KEY` meta entry** — the order is unchanged by a
  re-parse, and rewriting it from a partial list would drop the failed file from
  the ordering.

Everything else (the transaction over `[SOURCES]`, the `satisfies StoredSource`
put, the `done(tx)` await, the `finally { db.close(); }`) matches `saveSources`
exactly.

Note the transaction only needs `SOURCES`, not `META`.

> **If plan 003 has landed**, `SourceFile` also carries a `problems` field.
> `StoredSource` does not store it and must not start — 003 recomputes it at
> load. Your `put` should write the same four fields `saveSources` writes:
> `fileName`, `rawText`, `activities`, `parserVersion`.

**Verify**: `pnpm typecheck` → still only the `dataset.ts` error from Step 1.

**Verify**: `grep -n "store.clear()" src/lib/storage.ts` → matches inside
`saveSources` only, not inside `updateSources`.

### Step 3: Switch the hydrate path to the non-destructive write

In `src/stores/dataset.ts`, import `updateSources` alongside the existing
storage imports, and change `hydrate`:

```ts
	hydrate: async () => {
		if (get().hydrated) return;
		try {
			const { sources, reparsed, failed } = await loadSources();
			set({ ...withSources(sources), hydrated: true });
			// Rows re-derived under a newer parser are written back so the next
			// load is a straight read. `updateSources`, not `saveSources`: a file
			// that failed to re-parse is missing from `sources` but must stay in
			// the database, and a wholesale replace would delete it.
			if (reparsed > 0) persist(updateSources(sources));
			if (failed.length > 0) reportFailedSources(failed);
		} catch (error) {
			console.warn("Could not read local storage:", error);
			set({ hydrated: true });
		}
	},
```

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `grep -n "saveSources" src/stores/dataset.ts` → `saveSources` no
longer appears inside `hydrate`. It must still appear in `addSources` and
`removeSource`, which genuinely do own the complete set and where a wholesale
replace is correct.

### Step 4: Tell the user

Add a `reportFailedSources` helper in `src/stores/dataset.ts`, above the store
definition, next to `persist`:

```ts
// A file whose stored text no longer parses is still in the database, but this
// session cannot show its rows — so every total on screen is missing it. That
// has to be said out loud; the alternative is a dashboard that is quietly
// wrong.
function reportFailedSources(fileNames: string[]) {
	toast.error(
		`Couldn't read ${fileNames.length} saved file${fileNames.length === 1 ? "" : "s"}.`,
		{
			description: `${fileNames.join(", ")} — still saved, but not counted in these figures. Re-add the file, or report this.`,
		},
	);
}
```

Import `toast` from `sonner` at the top of the file.

Confirm `<Toaster />` is already mounted before relying on this: check
`src/app/layout.tsx` or `src/components/app-shell.tsx` for the `sonner` toaster
component. It is used by `live-prices-button.tsx` and `pdf-export-button.tsx`,
so it should be present — but verify rather than assume.

**Verify**: `grep -rn "Toaster" src/app/ src/components/` → at least one mount
site. **If there is none, STOP and report** — the toast would be invisible and a
different surface is needed.

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `pnpm check` → exit 0.

### Step 5: Full verification

**Verify**: `pnpm test` → exit 0, all tests pass.

**Verify**: `pnpm build` → exit 0.

**Verify**: `git status --short` → only `src/lib/storage.ts` and
`src/stores/dataset.ts` modified.

## Test plan

`src/lib/storage.ts` talks to IndexedDB, which does not exist under
`vitest.config.mts`'s `environment: "node"`. Adding `fake-indexeddb` or jsdom to
test this is **out of scope** — the suite's node-only environment is a
deliberate, documented choice and this plan is not the place to relitigate it.

So the verification here is structural rather than behavioural, and the done
criteria below are written to be checkable by `grep` for exactly that reason.

Manual verification, if the operator can run the app — describe the outcome in
your report rather than treating it as a gate:

1. `pnpm dev`, load two CSV exports, confirm both appear in the sidebar card.
2. Temporarily bump `PARSER_VERSION` in `src/lib/wealthsimple.ts` to force a
   re-parse on next load, and make one stored file fail (e.g. by loading a file
   that the current parser rejects).
3. Reload. Expect: a toast naming the failed file; the other file's figures
   present and correct.
4. Restore `PARSER_VERSION` and reload. Expect: **the failed file is back**,
   with its rows, because its raw text was never deleted.

Step 4 is the whole plan. **Revert the `PARSER_VERSION` change before
committing** — `git diff src/lib/wealthsimple.ts` must be empty.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; every pre-existing test still passes
- [ ] `pnpm check` exits 0 with no new warnings (still exactly 5, all in
      `src/lib/google-sheet.ts`)
- [ ] `pnpm build` exits 0
- [ ] `grep -n "updateSources" src/lib/storage.ts` shows the new exported
      function
- [ ] `grep -A20 "export async function updateSources" src/lib/storage.ts | grep -c "store.clear()"`
      returns 0
- [ ] `grep -n "saveSources" src/stores/dataset.ts` shows it used in
      `addSources` and `removeSource` but **not** in `hydrate`
- [ ] `grep -c "catch {$" src/lib/storage.ts` shows no bare empty catch remains
      in `loadSources`
- [ ] `git diff --stat d1d2640..HEAD -- src/lib/wealthsimple.ts` shows no
      changes (`PARSER_VERSION` untouched)
- [ ] `git status --short` lists only `src/lib/storage.ts` and
      `src/stores/dataset.ts`
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's typecheck reports an error naming any file other than the two in
  scope. (Note: on a fresh worktree, `PageProps`/`LayoutProps` errors are the
  missing Next.js generated types, cleared by `pnpm exec next typegen` — that is
  environment setup, not a STOP condition.)
- No `<Toaster />` is mounted anywhere (Step 4). The user-facing report needs a
  surface, and choosing a different one is a design decision, not an
  improvisation.
- You conclude the fix requires changing `StoredSource`, the object-store
  schema, or `PARSER_VERSION`. It does not — if you believe otherwise, report
  why.
- You find another caller of `saveSources` that has the same partial-list
  problem. Report it; do not fix it here.
- Any existing test fails.

## Maintenance notes

For whoever owns this next:

- **The rule this establishes**: `saveSources` is a wholesale replace and is
  only safe when the caller owns the complete set. Anything working from a
  filtered or partial list must use `updateSources`. Anyone adding a third
  writer should decide which of the two they are.
- **Failed files accumulate silently in the database.** After this change a file
  that never parses again stays stored forever, counting against the origin's
  storage quota. The "Clear data" button still removes it (`clearStorage` clears
  the whole store), and `removeSource` will not — it filters the in-memory list
  and calls `saveSources`, which *will* drop the failed entry as a side effect.
  That is acceptable today; if a "remove this broken file" affordance is ever
  added, it should target the entry by name rather than rely on that.
- **Deferred deliberately**: the write-ordering hazard where two overlapping
  `saveSources` calls can commit out of order, letting a stale snapshot win.
  Real, separate, and needs a queue or a revision counter rather than a
  non-destructive write.
- **What a reviewer should scrutinise**: that `updateSources` really has no
  `store.clear()` and does not touch `ORDER_KEY`; that `hydrate` no longer calls
  `saveSources`; and that `PARSER_VERSION` is unchanged in the diff.
