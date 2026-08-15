# Plan 017: Load the PDF stack only when someone exports a PDF

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat d1d2640..HEAD -- src/lib/pdf.ts src/components/pdf-export-button.tsx src/components/dashboard.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `d1d2640`, 2026-08-15

## Why this matters

`jspdf` and `html2canvas-pro` are statically imported into the `/dashboard`
client bundle. On disk the two minified builds are roughly 590 KB combined, and
every visitor to that route downloads and parses them whether or not they ever
click **Export PDF** — which most people never will.

The seam here is unusually clean, which is why this is worth doing despite being
the only dynamic import in the codebase: `src/lib/pdf.ts` has a single export,
does no module-eval work, has exactly one consumer, and the click handler that
calls it is *already* `async` with a pending state and a `try`/`catch`/`finally`.
A chunk-load failure lands in the existing catch and produces the existing
toast, with no new error handling to write.

## Current state

### The static import chain

`src/lib/pdf.ts:1-8` — the module header explains the dependency choice and must
be preserved through any move:

```ts
// `html2canvas-pro` rather than `html2canvas`: the original's colour parser
// predates the CSS Color 4 functions and throws on the first one it meets
// ("unsupported color function"). Our theme tokens in `globals.css` are all
// `oklch()`, which Chrome hands back to the parser as `lab()`, so every export
// failed before it drew a pixel. The fork is API-compatible and understands
// `lab`/`lch`/`oklab`/`oklch`.
import html2canvas from "html2canvas-pro";
import { jsPDF } from "jspdf";
```

The chain is:

```
src/lib/pdf.ts            imports jspdf + html2canvas-pro at module top level
  ← src/components/pdf-export-button.tsx:8   (the only importer of @/lib/pdf)
    ← src/components/dashboard.tsx:14        (the only importer of PdfExportButton)
```

Verified: `@/lib/pdf` is imported by exactly one file, and `PdfExportButton` by
exactly one file (rendered once, at `src/components/dashboard.tsx:102`).
`jspdf` and `html2canvas-pro` appear nowhere else in `src/`.

### The single export, and it needs nothing at module-eval time

`src/lib/pdf.ts:10-13`:

```ts
export async function exportElementToPdf(
	element: HTMLElement,
	filename: string,
) {
```

Returns `Promise<void>`; it also owns the download, calling `pdf.save(filename)`
at the end. There are no module-level constants, no side effects, and no
type-only re-exports — so nothing needs the module until the click happens.

### The handler is already shaped for an await

Verified excerpt, `src/components/pdf-export-button.tsx:15-40`:

```tsx
export function PdfExportButton({ targetRef, filename }: PdfExportButtonProps) {
	const [isExporting, setIsExporting] = useState(false);

	async function handleExport() {
		if (!targetRef.current) return;

		setIsExporting(true);
		try {
			await exportElementToPdf(targetRef.current, filename);
		} catch (error) {
			// The toast can only say that it failed. Rendering the DOM to a canvas
			// fails in ways that are specific enough to be worth keeping (a colour
			// the parser can't read, a tainted canvas), so the reason goes to the
			// console rather than being swallowed with the stack trace.
			console.error("PDF export failed", error);
			toast.error("Could not generate the PDF report.");
		} finally {
			setIsExporting(false);
		}
	}

	return (
		<Button disabled={isExporting} onClick={handleExport} variant="outline">
			<FileDown className="size-4" />
			{isExporting ? "Generating…" : "Export PDF"}
		</Button>
	);
}
```

`setIsExporting(true)` already runs before the await, the button is already
disabled and relabelled while pending, and the catch already logs the real
reason to the console. An `await import(...)` inside the `try` is absorbed
completely.

### This would be the first dynamic import in the repo

Verified: `grep -rn "next/dynamic\|React\.lazy\|await import(" src/` returns
**no matches**. There is no existing convention to follow and no shared
chunk-load error handling to reuse — but `pdf-export-button.tsx` already
provides its own locally, which is why this is the right first place to do it.

### Why the other heavy-looking modules are NOT candidates

Do not extend this plan to them:

- `src/lib/xlsx.ts` (417 lines) imports only from `@/lib/google-sheet`. It is a
  hand-rolled zip/OOXML writer, deliberately built to avoid a spreadsheet
  dependency. Its only module-eval work is a 256-entry CRC table — microseconds.
- `src/lib/google-sheet.ts` (1366 lines) imports only `@/lib/metrics`,
  `@/lib/positions` and `@/lib/wealthsimple`. Large, but every byte is
  first-party app code, not vendor.
- `src/components/investment/export-sheet-dialog.tsx` **already** gates its
  expensive work on the dialog being open, with a comment explaining that
  expensive work must not precede `navigator.clipboard.writeText` or the browser
  treats the write as untrusted. That is an argument *against* adding an await
  to that path.

So `jspdf` + `html2canvas-pro` are the only genuinely heavy, action-gated vendor
imports in the app.

### Repo conventions

- **Tabs** for indentation; Biome auto-sorts imports.
- Comments are prose explaining *why*.
- Commit style: imperative, sentence case, no conventional-commit prefix.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | exit 0, 227 pass |
| Lint | `pnpm check` | exit 0 (5 pre-existing warnings, or 0 if `plans/016` landed) |
| Build | `pnpm build` | exit 0 |
| Dev server | `pnpm dev` | serves on :3000 |

## Scope

**In scope**:
- `src/components/pdf-export-button.tsx`

**Out of scope** (do NOT touch):
- `src/lib/pdf.ts`. Its contents, its single export's signature, and especially
  its six-line header comment about `html2canvas-pro` all stay exactly as they
  are. The module is fine; only *when* it loads changes.
- `src/lib/xlsx.ts`, `src/lib/google-sheet.ts`,
  `src/components/investment/export-sheet-dialog.tsx` — see above for why none
  is a candidate. In particular **do not** add an await to the clipboard path.
- `src/components/dashboard.tsx`. It imports `PdfExportButton`, which is a small
  client component and should stay statically imported — the heavy dependency is
  a level below.
- `recharts` and `@base-ui/react`. Heavy, but they render on page load rather
  than on an action; splitting them would put a loading state in front of the
  primary content.
- `next.config.ts`, and any webpack/turbopack chunk configuration.
- Adding a loading spinner, skeleton, or any new UI. The existing
  `isExporting` state already covers the wait.

## Git workflow

- Branch: `advisor/017-pdf-code-splitting`
- Commit message in repo style (imperative, sentence-case, no
  conventional-commit prefix):
  `Fetch the PDF machinery when it's asked for, not on every dashboard`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Record the baseline

**Verify**: `pnpm typecheck && pnpm test && pnpm check` → exit 0, with
`Tests 227 passed (227)`.

**Verify**: `pnpm build` → exit 0. Note the build output — the route sizes it
prints are your before-measurement for Step 4.

If any of these differs from the plan's stated baseline, the tree has drifted —
STOP.

### Step 2: Move the import into the handler

In `src/components/pdf-export-button.tsx`:

- Delete the static `import { exportElementToPdf } from "@/lib/pdf";` at line 8.
- Inside `handleExport`, within the existing `try`, load the module and call it:

```tsx
		try {
			// Imported here rather than at the top of the file: `@/lib/pdf` pulls in
			// jspdf and html2canvas-pro, which are large and are only ever needed by
			// this click. A failed chunk load lands in the same catch as a failed
			// render, and the button is already disabled while we wait.
			const { exportElementToPdf } = await import("@/lib/pdf");
			await exportElementToPdf(targetRef.current, filename);
		} catch (error) {
```

Everything else in the component stays exactly as it is — the `isExporting`
state, the `catch` body, the `finally`, the button markup.

Note that `targetRef.current` is already null-checked at the top of the handler,
before the await. TypeScript may narrow differently now that another await sits
between the check and the use; if it complains, capture the element into a local
`const` immediately after the guard rather than weakening the check with a
non-null assertion.

**Verify**: `pnpm typecheck` → exit 0.

**Verify**: `grep -c "from \"@/lib/pdf\"" src/components/pdf-export-button.tsx`
→ `0`.

**Verify**: `grep -c "await import(\"@/lib/pdf\")" src/components/pdf-export-button.tsx`
→ `1`.

**Verify**: `pnpm check` → exit 0, with no new warnings.

### Step 3: Build and confirm the split happened

**Verify**: `pnpm build` → exit 0.

Compare the `/dashboard` route's First Load JS against the Step 1 figure. It
should drop noticeably. **Record both numbers in your report** — this is the
only real evidence the change did anything, and a dynamic import that the
bundler inlines anyway would be a silent no-op.

**If the size does not drop**, do not assume it worked. Report the before and
after figures and stop — it means the bundler is not splitting at this boundary
and the change is not earning its keep.

### Step 4: Verify the export still works end to end

This is the step that matters most: a broken export fails inside a `catch` that
shows a generic toast, so a regression here is quiet.

Start the dev server and exercise the real path:

1. `pnpm dev`
2. Load a CSV export and navigate to `/dashboard`
3. Open the browser devtools **Network** tab, then click **Export PDF**
4. Confirm: a new chunk is requested at click time (not on page load), the
   button shows "Generating…" and is disabled while it works, and a PDF
   downloads
5. Confirm the browser console shows no error

Report what you observed. If you cannot run the app, say so explicitly rather
than marking this step done.

### Step 5: Full verification

**Verify**: `pnpm typecheck && pnpm test && pnpm check && pnpm build` → all exit
0.

**Verify**: `git status --short` lists only
`src/components/pdf-export-button.tsx`.

**Verify**: `git diff --stat d1d2640..HEAD -- src/lib/pdf.ts` shows **no
changes**.

## Test plan

No new automated tests. `src/components/pdf-export-button.tsx` is a `.tsx`
component and `vitest.config.mts` includes only `src/**/*.test.ts` under
`environment: "node"` — adding jsdom to test a dynamic import is far more
machinery than the change warrants, and the node-only environment is a
deliberate documented choice.

Verification is therefore Step 3 (the bundle actually split) and Step 4 (the
export actually still works). Both must be reported with what you observed, not
merely ticked.

The 227 existing tests must keep passing — they do not touch this component, so
any movement means something unexpected happened.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; all 227 pre-existing tests pass
- [ ] `pnpm check` exits 0 with no new warnings
- [ ] `pnpm build` exits 0
- [ ] `grep -c "from \"@/lib/pdf\"" src/components/pdf-export-button.tsx`
      returns 0
- [ ] `grep -c "await import(\"@/lib/pdf\")" src/components/pdf-export-button.tsx`
      returns 1
- [ ] `git diff --stat d1d2640..HEAD -- src/lib/pdf.ts` shows no changes
- [ ] `git status --short` lists only `src/components/pdf-export-button.tsx`
- [ ] The report records the `/dashboard` First Load JS **before and after**
- [ ] The report records the outcome of the Step 4 manual export check, or says
      explicitly that it could not be run
- [ ] `plans/README.md` status row for 017 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `/dashboard` bundle size does not drop after the change. Report both
  figures — a dynamic import the bundler inlines is a no-op, and shipping it
  would add indirection for nothing.
- `pnpm build` fails.
- The PDF export stops working in Step 4. Report the console error verbatim.
  Do **not** revert to a static import and call it done — the failure is
  information.
- TypeScript cannot narrow `targetRef.current` after the added await and the only
  way through appears to be a non-null assertion. Report it; weakening a null
  check to enable a perf tweak is a bad trade.
- You find yourself editing `src/lib/pdf.ts`, or extending the change to
  `xlsx.ts` / `google-sheet.ts` / the export dialog.

## Maintenance notes

For whoever owns this next:

- **This is the codebase's first dynamic import**, so it sets the pattern.
  The shape worth copying: split at a module that has one export, no
  module-eval work, and a caller that already has a pending state and a catch.
  Splitting anywhere lacking those three costs more than it saves.
- **`src/lib/pdf.ts` stays statically importable.** Nothing about the module
  changes; if a second caller appears it can import it either way.
- **Do not extend this to the sheet export.**
  `export-sheet-dialog.tsx` documents that expensive work must not precede
  `navigator.clipboard.writeText`, or the browser treats the write as
  untrusted. An await on that path would break the copy button in a way that is
  hard to diagnose.
- **A chunk-load failure now shows "Could not generate the PDF report."** — the
  same toast as a render failure, with the real reason in the console. That is
  acceptable and matches the existing comment's reasoning, but it is worth
  knowing when triaging a report of a failed export: check the console for a
  network error before assuming a canvas problem.
- **What a reviewer should scrutinise**: that `src/lib/pdf.ts` is untouched;
  that no null check was weakened into an assertion; and that the executor
  reported real before/after bundle numbers rather than asserting the split
  happened.
