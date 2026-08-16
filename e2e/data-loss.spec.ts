import { expect, test } from "@playwright/test";
import {
	CURRENT_PARSER_VERSION,
	clearDatabase,
	gotoWithoutHydrating,
	installIndexedDbOpenDelay,
	readStoredSources,
	releaseIndexedDbOpen,
	type SeedActivity,
	seedSources,
	unblockAndReload,
} from "./db-helpers";
import { fileA, fileB, fileC, unparseableCsv } from "./fixtures";

/**
 * The two ways a saved export used to disappear (plans 004 and 005). Both
 * bugs were invisible on screen while IndexedDB itself was wrong — that is
 * exactly how they went unnoticed — so every assertion here reads the
 * database back via `page.evaluate`, not just the UI.
 */
test.describe("data loss", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await clearDatabase(page);
	});

	test("a file that fails to re-parse survives (plan 004)", async ({
		page,
	}) => {
		const valid = fileC();
		// Hand-written rather than parsed: with `parserVersion` equal to the
		// current one, `loadSources` trusts these rows as-is and never re-parses
		// `rawText`, so this is exactly what a real load would have produced from
		// `valid.csv`. Mirrors `toActivity` in src/lib/wealthsimple.ts.
		const validActivities: SeedActivity[] = [
			{
				transactionDate: "2026-03-02",
				effectiveAt: "2026-03-02T09:00:00-05:00",
				settlementDate: null,
				accountId: "E2E0003RRSP",
				accountType: "RRSP",
				activityType: "MoneyMovement",
				activitySubType: "EFT",
				description: "Deposit",
				symbol: null,
				name: null,
				currency: "CAD",
				quantity: 120,
				unitPrice: null,
				commission: null,
				netCashAmount: 120,
			},
			{
				transactionDate: "2026-03-03",
				effectiveAt: "2026-03-03T13:45:00-05:00",
				settlementDate: null,
				accountId: "E2E0003RRSP",
				accountType: "RRSP",
				activityType: "Trade",
				activitySubType: "BUY",
				description: "CCC: Bought 1 shares at $80.00 per share",
				symbol: "CCC",
				name: "Gamma Test Inc",
				currency: "CAD",
				quantity: 1,
				unitPrice: 80,
				commission: 0,
				netCashAmount: -80,
			},
		];

		// The only copy of this "file" is its raw text — deliberately not a
		// Wealthsimple export, so re-parsing it under any parser version fails.
		// `parserVersion: 1` (stale relative to `CURRENT_PARSER_VERSION`) is what
		// forces `loadSources` down the re-parse path instead of trusting stored
		// rows, which is the only way to reach the failure this spec covers —
		// bumping the real `PARSER_VERSION` is out of scope for this plan, so
		// seeding a stale record is the only way to construct this precondition
		// without shipping two builds.
		const brokenFileName = "e2e-unreadable.csv";
		const brokenRawText = unparseableCsv();

		await gotoWithoutHydrating(page);
		await seedSources(
			page,
			[
				{
					fileName: valid.fileName,
					rawText: valid.csv,
					activities: validActivities,
					parserVersion: CURRENT_PARSER_VERSION,
				},
				{
					fileName: brokenFileName,
					rawText: brokenRawText,
					activities: [],
					parserVersion: 1,
				},
			],
			[valid.fileName, brokenFileName],
		);
		await unblockAndReload(page);

		// The valid file's figures render.
		await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
		await expect(
			page.getByRole("link", {
				name: new RegExp(valid.fileName.replace(".", "\\.")),
			}),
		).toBeVisible();

		// A toast names the unreadable file (reportFailedSources in
		// src/stores/dataset.ts). Sonner renders each toast's text in two DOM
		// nodes (a duplicate used for its own height measurement), hence
		// `.first()` rather than a plain visibility check on the text.
		await expect(
			page.getByText("Couldn't read 1 saved file.").first(),
		).toBeVisible();
		await expect(
			page.getByText(new RegExp(brokenFileName.replace(".", "\\."))).first(),
		).toBeVisible();

		// This is the assertion the whole plan exists for: before 004, a file
		// that failed to re-parse was silently dropped from IndexedDB. Read the
		// database back directly rather than trusting what's on screen.
		let stored = await readStoredSources(page);
		let broken = stored.find((s) => s.fileName === brokenFileName);
		expect(broken).toBeDefined();
		expect(broken?.rawText).toBe(brokenRawText);
		expect(broken?.parserVersion).toBe(1);

		// And it survives a further reload, not just the first load.
		await page.reload();
		await expect(
			page.getByText("Couldn't read 1 saved file.").first(),
		).toBeVisible();

		stored = await readStoredSources(page);
		broken = stored.find((s) => s.fileName === brokenFileName);
		expect(broken).toBeDefined();
		expect(broken?.rawText).toBe(brokenRawText);
	});

	/**
	 * The mid-hydration race (plan 005) has two halves. The guard — nothing is
	 * offered to interact with while IndexedDB is still being read — is
	 * deterministically testable and is what this spec covers.
	 *
	 * The recovery half described in the plan (drop a file *while* the read is
	 * still in flight, then confirm both the seeded files and the dropped one
	 * survive) turned out not to be constructible as a black-box test against
	 * the fixed app, and is deliberately not shipped here. Reasoning, so the
	 * next person doesn't have to re-derive it:
	 *
	 * `addSources` — the only function that can trigger the race
	 * `hydrate()` guards against in src/stores/dataset.ts (the `raced` branch,
	 * reached when `get().sources.length !== 0` by the time `loadSources()`
	 * resolves) — is only ever called from `CsvUploader`'s `onChange`/`onDrop`
	 * handlers. Every mounted instance of `CsvUploader` in this app
	 * (`src/components/data-source-card.tsx`,
	 * `src/components/require-dataset.tsx` — confirmed by grepping the whole
	 * `src/` tree for both names) is gated behind `hydrated`, which is exactly
	 * what 005 added. The guard test below proves this empirically too: while
	 * the read is delayed, `input[type="file"]` has a count of zero — there is
	 * no file input anywhere in the DOM to drop a file onto, whether via
	 * `setInputFiles` or a simulated drag.
	 *
	 * Reaching the race would require calling the zustand store's `addSources`
	 * directly from `page.evaluate`, bypassing the UI entirely — but the store
	 * isn't exposed on `window` (checked; no devtools middleware, nothing
	 * attached globally), and exposing it would mean modifying `src/`, which is
	 * out of scope with no exceptions. The plan itself only sanctions
	 * instrumenting the *environment* (delaying `indexedDB.open`) — not the
	 * app's internals — and there is no environment-only way to reach a call
	 * that the fix deliberately made unreachable. In other words: 005 didn't
	 * just make the race hard to hit, it made it impossible to hit through any
	 * surface a real user (or a black-box test standing in for one) has access
	 * to. The guard test is what's left to check, and it's worth having on its
	 * own.
	 */
	test("nothing is offered to interact with mid-hydration (plan 005, guard half)", async ({
		page,
	}) => {
		const a = fileA();
		const b = fileB();
		const aActivities: SeedActivity[] = [
			{
				transactionDate: "2026-01-05",
				effectiveAt: "2026-01-05T09:00:00-05:00",
				settlementDate: null,
				accountId: "E2E0001CAD",
				accountType: "TFSA",
				activityType: "MoneyMovement",
				activitySubType: "EFT",
				description: "Deposit",
				symbol: null,
				name: null,
				currency: "CAD",
				quantity: 250,
				unitPrice: null,
				commission: null,
				netCashAmount: 250,
			},
			{
				transactionDate: "2026-01-06",
				effectiveAt: "2026-01-06T10:15:00-05:00",
				settlementDate: null,
				accountId: "E2E0001CAD",
				accountType: "TFSA",
				activityType: "Trade",
				activitySubType: "BUY",
				description: "AAA: Bought 2 shares at $100.00 per share",
				symbol: "AAA",
				name: "Alpha Test Corp",
				currency: "CAD",
				quantity: 2,
				unitPrice: 100,
				commission: 0,
				netCashAmount: -200,
			},
		];
		const bActivities: SeedActivity[] = [
			{
				transactionDate: "2026-02-03",
				effectiveAt: "2026-02-03T09:00:00-05:00",
				settlementDate: null,
				accountId: "E2E0002RRSP",
				accountType: "RRSP",
				activityType: "MoneyMovement",
				activitySubType: "EFT",
				description: "Deposit",
				symbol: null,
				name: null,
				currency: "CAD",
				quantity: 300,
				unitPrice: null,
				commission: null,
				netCashAmount: 300,
			},
			{
				transactionDate: "2026-02-04",
				effectiveAt: "2026-02-04T11:30:00-05:00",
				settlementDate: null,
				accountId: "E2E0002RRSP",
				accountType: "RRSP",
				activityType: "Trade",
				activitySubType: "BUY",
				description: "BBB: Bought 3 shares at $50.00 per share",
				symbol: "BBB",
				name: "Beta Test Fund",
				currency: "CAD",
				quantity: 3,
				unitPrice: 50,
				commission: 0,
				netCashAmount: -150,
			},
		];

		await gotoWithoutHydrating(page);
		await seedSources(
			page,
			[
				{
					fileName: a.fileName,
					rawText: a.csv,
					activities: aActivities,
					parserVersion: CURRENT_PARSER_VERSION,
				},
				{
					fileName: b.fileName,
					rawText: b.csv,
					activities: bActivities,
					parserVersion: CURRENT_PARSER_VERSION,
				},
			],
			[a.fileName, b.fileName],
		);

		// Installed before the next navigation, so it's active for the reload
		// below — see the comment on `installIndexedDbOpenDelay` for the
		// trade-off of instrumenting the environment this way.
		await installIndexedDbOpenDelay(page);
		await unblockAndReload(page);

		// While the read is held open: a skeleton, and nothing to interact with.
		await expect(page.locator('[data-slot="skeleton"]').first()).toBeVisible();
		await expect(page.locator('input[type="file"]')).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Clear data" })).toHaveCount(
			0,
		);

		await releaseIndexedDbOpen(page);

		// Hydration lands: both seeded files show up merged, skeleton gone.
		await expect(
			page.getByRole("link", { name: /2 files merged/ }),
		).toBeVisible();
		await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);

		const stored = await readStoredSources(page);
		expect(new Set(stored.map((s) => s.fileName))).toEqual(
			new Set([a.fileName, b.fileName]),
		);
	});
});
