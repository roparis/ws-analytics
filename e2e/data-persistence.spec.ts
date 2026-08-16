import { expect, type Page, test } from "@playwright/test";
import { clearDatabase, readStoredSources } from "./db-helpers";
import { fileA, fileB } from "./fixtures";

/** Escapes a string for use inside a `RegExp` — file names carry a literal
 * `.` that would otherwise match any character. */
function escapeForRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every route mounts a `CsvUploader` for both the desktop sidebar and the
 * mobile header (only one is visually shown at a time, by CSS breakpoint —
 * see `src/components/app-shell.tsx` — but both stay in the DOM), plus a
 * third full-size one wherever `RequireDataset` has no data yet. All three
 * wire up to the same `addSources` call, so which one receives the file is
 * immaterial to the app's behaviour; `.first()` just avoids a Playwright
 * strict-mode "multiple elements matched" error from having three
 * `input[type="file"]` in the DOM at once.
 */
function fileInput(page: Page) {
	return page.locator('input[type="file"]').first();
}

/**
 * The round-trip cases: upload, reload, add a second file, clear. These are
 * the "provable" behaviours — nothing here was ever suspected of losing
 * data, but `src/lib/storage.ts` has zero unit tests (it can't; it needs
 * real IndexedDB), so nothing has ever actually exercised the round trip
 * either.
 *
 * All four cases run as steps of one test rather than four separate `test()`
 * blocks: they're a causal chain (upload, *then* reload, *then* add a second
 * file, *then* clear), and chaining them keeps that dependency explicit
 * instead of relying on Playwright's default test order. The test still
 * starts from a clean origin — Playwright gives every test a fresh browser
 * context by default, and `beforeEach` below deletes the database explicitly
 * on top of that, so a future change to context/storage-state reuse can't
 * quietly let this test inherit another one's data.
 */
test.describe("data persistence", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await clearDatabase(page);
		await page.reload();
	});

	test("round-trips uploaded data through IndexedDB", async ({ page }) => {
		const a = fileA();
		const b = fileB();

		await test.step("upload one file: figures render, sidebar names it", async () => {
			await expect(
				page.getByRole("button", { name: "Choose CSV files" }),
			).toBeVisible();

			await fileInput(page).setInputFiles({
				name: a.fileName,
				mimeType: "text/csv",
				buffer: Buffer.from(a.csv),
			});

			await expect(
				page.getByRole("heading", { name: "Timeline" }),
			).toBeVisible();
			// The sidebar link's accessible name is the dataset's fileName —
			// with one source that's just that file's own name.
			await expect(
				page.getByRole("link", {
					name: new RegExp(escapeForRegExp(a.fileName)),
				}),
			).toBeVisible();

			const stored = await readStoredSources(page);
			expect(stored.map((s) => s.fileName)).toEqual([a.fileName]);
		});

		await test.step("reload: data is still there (the IndexedDB round trip)", async () => {
			await page.reload();

			await expect(
				page.getByRole("heading", { name: "Timeline" }),
			).toBeVisible();
			await expect(
				page.getByRole("link", {
					name: new RegExp(escapeForRegExp(a.fileName)),
				}),
			).toBeVisible();

			const stored = await readStoredSources(page);
			expect(stored.map((s) => s.fileName)).toEqual([a.fileName]);
		});

		await test.step("upload a second file: both listed, totals reflect the merge", async () => {
			await fileInput(page).setInputFiles({
				name: b.fileName,
				mimeType: "text/csv",
				buffer: Buffer.from(b.csv),
			});

			// Two distinct accounts, no overlap — `mergeSources` names a
			// multi-source dataset "`N` files merged" (src/lib/merge.ts), and its
			// accessible name also carries the activity/account counts, hence a
			// substring match rather than an exact one.
			const mergedLink = page.getByRole("link", { name: /2 files merged/ });
			await expect(mergedLink).toBeVisible();
			// 2 activities per file, merged with nothing skipped. Scoped to the
			// sidebar link rather than a page-wide text search — "4 activities"
			// also legitimately appears in the toast and the chart caption.
			await expect(mergedLink).toContainText("4 activities");

			const stored = await readStoredSources(page);
			expect(new Set(stored.map((s) => s.fileName))).toEqual(
				new Set([a.fileName, b.fileName]),
			);
		});

		await test.step('"Clear data", then reload: gone, and stays gone', async () => {
			await page.getByRole("button", { name: "Clear data" }).click();

			await expect(
				page.getByRole("button", { name: "Choose CSV files" }),
			).toBeVisible();

			let stored = await readStoredSources(page);
			expect(stored).toEqual([]);

			await page.reload();

			await expect(
				page.getByRole("button", { name: "Choose CSV files" }),
			).toBeVisible();

			stored = await readStoredSources(page);
			expect(stored).toEqual([]);
		});
	});
});
