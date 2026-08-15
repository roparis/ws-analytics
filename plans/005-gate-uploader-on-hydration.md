# Plan 005: Close the window where dropping a file mid-hydration deletes the saved ones

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat d1d2640..HEAD -- src/components/data-source-card.tsx src/stores/dataset.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. Land after 004 if both are queued — they touch adjacent
  lines in `src/stores/dataset.ts` and sequencing avoids a conflict.
- **Category**: bug
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

Every data-backed page in this app is correctly gated on hydration:
`RequireDataset` shows a skeleton until IndexedDB has been read. But the sidebar
card is not, and the sidebar is mounted on **every route**, outside that gate.
It renders a file uploader the moment `dataset` is falsy — which is exactly the
state the app is in *while it is still reading from IndexedDB*.

Drop a CSV into that uploader during the read (a realistic window for a
multi-megabyte export) and the following happens:

1. `addSources` runs against an in-memory `sources` array that is still `[]`,
   because hydration has not landed.
2. It calls `saveSources([theNewFile])`, and `saveSources` starts with
   `store.clear()` — **every previously saved export is deleted from
   IndexedDB.**
3. Hydration then resolves with the sources it read *before* the clear, and
   overwrites the store's state unconditionally.

The result is a session showing the old files, a database containing only the
new one, and no error anywhere. On the next reload the old exports are gone and
every dollar figure on screen changes.

The same window applies to the card's "Clear data" button: press it mid-read and
the database is wiped while hydration puts the sources back in memory.

## Current state

Files and their roles:

- `src/components/data-source-card.tsx` — the sidebar card. Renders the uploader
  and the clear button. **Does not read `hydrated`.**
- `src/components/app-shell.tsx` — mounts the card on every route.
- `src/stores/dataset.ts` — the Zustand store. `hydrate` overwrites state
  unconditionally.
- `src/components/require-dataset.tsx` — **the pattern to copy.** Gates page
  bodies correctly.

### The ungated render

Verified excerpt, `src/components/data-source-card.tsx:19-25`:

```tsx
export function DataSourceCard({ compact = false }: DataSourceCardProps) {
	const dataset = useDatasetStore((state) => state.dataset);
	const clear = useDatasetStore((state) => state.clear);

	// Nothing loaded yet: the page itself is the dropzone, so all this needs
	// to offer is the file picker.
	if (!dataset) return <CsvUploader compact />;
```

Mounted on every route — verified excerpt, `src/components/app-shell.tsx:107`
and `:118`:

```tsx
						<DataSourceCard />
```
```tsx
						<DataSourceCard compact />
```

### The gate that exists everywhere else

Verified excerpt, `src/components/require-dataset.tsx:8-31`:

```tsx
/**
 * Shared gate for every data-backed route: skeleton until IndexedDB has been
 * read, the uploader when nothing is loaded, the page otherwise. Hydration
 * itself runs once app-wide in `StoreHydrator`.
 */
export function RequireDataset({ children }: { children: ReactNode }) {
	const dataset = useDatasetStore((state) => state.dataset);
	const hydrated = useDatasetStore((state) => state.hydrated);

	if (!hydrated) {
		return (
			<div className="flex flex-1 flex-col gap-4 py-6">
				<Skeleton className="h-10 w-48 rounded-3xl" />
				<Skeleton className="h-40 w-full rounded-4xl" />
				<Skeleton className="h-40 w-full rounded-4xl" />
			</div>
		);
	}

	if (!dataset) {
		return (
			<div className="flex flex-1 flex-col py-6">
				<CsvUploader />
			</div>
		);
	}

	return <>{children}</>;
}
```

### The unconditional overwrite

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

The `set` on line 45 discards anything `addSources` wrote during the `await`.

### How `addSources` orders files — the semantics your fix must preserve

Verified excerpt, `src/stores/dataset.ts:55-72`:

```ts
	addSources: (incoming) =>
		set((state) => {
			// File name is the source identity, so collapse repeats within the batch
			// as well as against what is already loaded — re-adding a file replaces
			// it rather than double-counting, and never yields two sources with the
			// same name.
			const deduped = [
				...new Map(
					incoming.map((source) => [source.fileName, source]),
				).values(),
			];
			const names = new Set(deduped.map((source) => source.fileName));
			const kept = state.sources.filter(
				(source) => !names.has(source.fileName),
			);
			const next = [...kept, ...deduped];
			persist(saveSources(next));
			return withSources(next);
		}),
```

Two rules to preserve exactly:

1. **Order is priority.** `src/stores/dataset.ts:11` documents it: "Raw per-file
   activities, in the order added — earlier files win overlaps." Existing files
   come first; newly added ones go last.
2. **File name is identity.** A repeated name replaces rather than duplicates.

So if hydration had finished before the drop, the resulting order would have
been `[...storedFiles, ...droppedFiles]`. Your recovery in Step 2 must produce
that same order.

### Conventions

- **Tabs** for indentation.
- Comments are prose explaining *why*.
- `Skeleton` is imported from `@/components/ui/skeleton`.
- Tailwind classes are auto-sorted by Biome — run `pnpm check` and accept its
  ordering.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, all pass |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings) |
| Build | `pnpm build` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `src/components/data-source-card.tsx`
- `src/stores/dataset.ts`

**Out of scope** (do NOT touch, even though they look related):
- `src/components/require-dataset.tsx` — already correct; it is the model, not
  the subject.
- `src/components/csv-uploader.tsx` — the uploader itself is fine. The bug is
  *where it is rendered*, not what it does.
- `src/components/store-hydrator.tsx` — hydration is triggered correctly once,
  app-wide, from the root layout.
- `src/lib/storage.ts` — no storage change is needed for this fix. (Plan 004
  changes that file for a different reason; do not merge the two.)
- `src/components/app-shell.tsx` — the card is mounted in the right places; it
  just needs to render differently before hydration.
- Any change to the "earlier files win overlaps" priority rule.

## Git workflow

- Branch: `advisor/005-gate-uploader-on-hydration`
- Commit message, matching `git log` style (imperative, sentence-case, no
  conventional-commit prefix):
  `Wait for the saved files before offering to replace them`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Gate the card on `hydrated`

In `src/components/data-source-card.tsx`, read `hydrated` from the store and
return a placeholder before anything else renders:

```tsx
export function DataSourceCard({ compact = false }: DataSourceCardProps) {
	const dataset = useDatasetStore((state) => state.dataset);
	const hydrated = useDatasetStore((state) => state.hydrated);
	const clear = useDatasetStore((state) => state.clear);

	// The uploader and the clear button both write to the same store IndexedDB
	// is still being read into. Offering either before the read lands lets a
	// drop run against an empty source list, and `saveSources` clears the store
	// before writing — so the files already saved would be deleted. Every page
	// body waits for `hydrated` via `RequireDataset`; the sidebar is outside
	// that gate and has to wait for itself.
	if (!hydrated) {
		return compact ? (
			<Skeleton className="h-8 w-24 rounded-3xl" />
		) : (
			<Skeleton className="h-24 w-full rounded-3xl" />
		);
	}

	if (!dataset) return <CsvUploader compact />;
```

Import `Skeleton` from `@/components/ui/skeleton`. Match the corner radius the
card itself uses — the non-compact card's container is
`rounded-3xl border bg-muted/50 p-3` (`data-source-card.tsx:69`), so
`rounded-3xl` keeps the placeholder the same shape as what replaces it.

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `pnpm check` → exit 0.

**Verify**: `grep -n "hydrated" src/components/data-source-card.tsx` → shows the
selector and the guard.

### Step 2: Make `hydrate` recover instead of overwrite

Step 1 removes the trigger. This step makes the store safe even if another entry
point appears later — a second uploader, a keyboard shortcut, a deep link.

In `src/stores/dataset.ts`, change `hydrate` so the `set` merges rather than
replaces, and so it repairs the database when it detects that a write landed
during the read:

```ts
	hydrate: async () => {
		if (get().hydrated) return;
		try {
			const { sources, reparsed } = await loadSources();
			let raced = false;

			set((state) => {
				if (state.sources.length === 0) {
					return { ...withSources(sources), hydrated: true };
				}

				// Files were added while IndexedDB was being read. `addSources`
				// wrote them over a list it believed was empty, so the stored
				// copies of everything else have already been cleared. Put the
				// stored files back in front — the order `addSources` would have
				// produced had the read finished first — and re-persist the union
				// below.
				raced = true;
				const added = new Set(
					state.sources.map((source) => source.fileName),
				);
				const restored = sources.filter(
					(source) => !added.has(source.fileName),
				);
				return {
					...withSources([...restored, ...state.sources]),
					hydrated: true,
				};
			});

			// Rows re-derived under a newer parser are written back so the next
			// load is a straight read. A race has to be written back too, for a
			// different reason: the database is missing the restored files.
			if (reparsed > 0 || raced) persist(saveSources(get().sources));
		} catch (error) {
			console.warn("Could not read local storage:", error);
			set({ hydrated: true });
		}
	},
```

Note `persist(saveSources(get().sources))` — read the merged list back out of
the store rather than passing the local `sources` variable, which holds only
what was on disk.

> **If plan 004 has landed**, that plan changed this line to
> `persist(updateSources(sources))` and added a `failed` return value. Reconcile
> rather than reverting: keep `failed` handling, and use `updateSources(...)` for
> the `reparsed` case. For the `raced` case use **`saveSources(get().sources)`** —
> the store genuinely owns the complete set after merging, and a wholesale
> replace is what repairs the cleared database. Preserve 004's comment
> explaining the difference.

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `pnpm test` → exit 0.

### Step 3: Full verification

**Verify**: `pnpm check` → exit 0, still exactly 5 warnings, all in
`src/lib/google-sheet.ts`.

**Verify**: `pnpm build` → exit 0.

**Verify**: `git status --short` → only `src/components/data-source-card.tsx`
and `src/stores/dataset.ts` modified.

## Test plan

The store is testable outside React — Zustand exposes
`useDatasetStore.getState()` — but `hydrate` calls `loadSources`, which needs
IndexedDB. `vitest.config.mts` sets `environment: "node"`, and adding
`fake-indexeddb` or jsdom is **out of scope**: the node-only environment is a
deliberate, documented choice and this plan is not the place to change it.

So verification here is structural, and the done criteria are written for
`grep`.

Manual verification, if the operator can run the app — report the outcome, do
not treat it as a gate:

1. `pnpm dev`, load two CSV exports, reload, confirm both are listed.
2. Throttle IndexedDB reads or use a large export so hydration is visibly slow.
3. On reload, confirm the sidebar shows a skeleton rather than an uploader
   during the read — **there should now be no way to drop a file into that
   window.**
4. Confirm the card renders normally once hydration lands, and that both files
   are still present after a further reload.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; every pre-existing test still passes
- [ ] `pnpm check` exits 0 with no new warnings (still exactly 5, all in
      `src/lib/google-sheet.ts`)
- [ ] `pnpm build` exits 0
- [ ] `grep -n "hydrated" src/components/data-source-card.tsx` shows both the
      store selector and a guard returning before `<CsvUploader />`
- [ ] `grep -n "Skeleton" src/components/data-source-card.tsx` shows the import
      and at least one use
- [ ] `grep -n "set((state)" src/stores/dataset.ts` shows `hydrate` using the
      functional form (not `set({ ... })`)
- [ ] `git status --short` lists only the two in-scope files
- [ ] `plans/README.md` status row for 005 updated

## STOP conditions

Stop and report back (do not improvise) if:

- You find a third component that renders `CsvUploader` outside a `hydrated`
  check. Report it — the gate may need to move into `CsvUploader` itself, which
  is a design decision, not an improvisation.
  (`grep -rn "CsvUploader" src/` finds every site.)
- Any existing test fails.
- You conclude the fix requires changing `src/lib/storage.ts`, `saveSources`, or
  the object-store schema.
- You conclude the "earlier files win overlaps" ordering should change. It must
  not — every merge result depends on it.
- `pnpm build` fails.

## Maintenance notes

For whoever owns this next:

- **The invariant to hold onto**: nothing may call `addSources`, `removeSource`,
  `moveSource`, or `clear` before `hydrated` is true. Step 1 enforces it at the
  only current entry point; Step 2 makes the store survive a future one. A
  belt-and-braces alternative — refusing those mutations in the store until
  hydrated — was deliberately not taken, because silently dropping a user's drop
  is its own bug.
- **`clear` shares the same window** and is fixed by the same gate: the button
  lives inside `DataSourceCard`, which now waits.
- **Interaction with plan 004**: both edit `hydrate`. 004 makes the *re-parse*
  write-back non-destructive; 005 makes the *state merge* non-destructive. They
  are complementary and both should survive. If you are landing the second of
  the two, re-read the other's version of `hydrate` before editing.
- **What a reviewer should scrutinise**: that the skeleton appears in both the
  compact and full branches; that the merged order is
  `[...restored, ...state.sources]` and not the reverse; and that the race path
  re-persists using the *merged* list rather than the list read from disk.
