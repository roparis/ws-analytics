import { describe, expect, it } from "vitest";
import {
	analyzeMerge,
	type MergedDataset,
	mergeSources,
	type SourceFile,
	type SourceSummary,
} from "@/lib/merge";
import type { Activity } from "@/lib/wealthsimple";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
	return {
		transactionDate: "2026-01-15",
		effectiveAt: null,
		settlementDate: null,
		accountId: "TEST0001CAD",
		accountType: "TFSA",
		activityType: "MoneyMovement",
		activitySubType: "EFT",
		description: "Deposit",
		symbol: null,
		name: null,
		currency: "CAD",
		quantity: 100,
		unitPrice: null,
		commission: null,
		netCashAmount: 100,
		...overrides,
	};
}

/** A simple cash-movement row on a given date, for merge tests where only the
 * date, account and amount matter. */
function moneyRow(
	date: string,
	amount: number,
	overrides: Partial<Activity> = {},
): Activity {
	return makeActivity({
		transactionDate: date,
		quantity: amount,
		netCashAmount: amount,
		...overrides,
	});
}

function makeSource(fileName: string, activities: Activity[]): SourceFile {
	return {
		fileName,
		// merge.ts never reads rawText — it works from the already-parsed rows,
		// so a placeholder here is correct and honest, not a shortcut.
		rawText: "not read by the merge logic",
		activities,
		problems: [],
		exportedOn: null,
	};
}

/** `mergeSources` only returns null for an empty input; every test here
 * passes at least one source, so this narrows the type without a non-null
 * assertion. */
function mustMerge(sources: SourceFile[]): MergedDataset {
	const merged = mergeSources(sources);
	if (!merged) throw new Error("expected mergeSources to return a dataset");
	return merged;
}

function summaryFor(merged: MergedDataset, fileName: string): SourceSummary {
	const summary = merged.sources.find((s) => s.fileName === fileName);
	if (!summary) throw new Error(`no summary for ${fileName}`);
	return summary;
}

describe("mergeSources — disjoint windows (baseline)", () => {
	it("keeps every row from both sources, sorted ascending by date", () => {
		const sourceA = makeSource("january.csv", [
			moneyRow("2026-01-05", 100),
			moneyRow("2026-01-20", 50),
		]);
		const sourceB = makeSource("february.csv", [
			moneyRow("2026-02-05", 75),
			moneyRow("2026-02-20", 25),
		]);

		const merged = mustMerge([sourceA, sourceB]);

		expect(merged.activities).toEqual([
			sourceA.activities[0],
			sourceA.activities[1],
			sourceB.activities[0],
			sourceB.activities[1],
		]);
		expect(merged.dateRange).toEqual({
			start: "2026-01-05",
			end: "2026-02-20",
		});

		for (const summary of merged.sources) {
			expect(summary.confidence).toBe("high");
			expect(summary.rowsSkipped).toBe(0);
		}
	});

	it("labels a single-source merge with the source's own file name", () => {
		const source = makeSource("january.csv", [moneyRow("2026-01-05", 100)]);

		expect(mustMerge([source]).fileName).toBe("january.csv");
	});

	it("labels a multi-source merge with a count", () => {
		const sourceA = makeSource("january.csv", [moneyRow("2026-01-05", 100)]);
		const sourceB = makeSource("february.csv", [moneyRow("2026-02-05", 75)]);

		expect(mustMerge([sourceA, sourceB]).fileName).toBe("2 files merged");
	});

	it("returns null for an empty source list", () => {
		expect(mergeSources([])).toBeNull();
	});
});

describe("mergeSources — duplicate rows inside one file", () => {
	it("keeps identical rows as separate transactions (§7) — de-duplicating would delete money", () => {
		// docs/wealthsimple-csv-format.md §7: the export has no per-row identifier
		// and genuinely identical rows recur (e.g. two separate $25 transfers into
		// the same account on the same day). Both are real. De-duplicating by row
		// content would silently drop one of them.
		const transfer = moneyRow("2026-05-10", 25, {
			description: "e-Transfer in",
		});
		const source = makeSource("may.csv", [
			transfer,
			{ ...transfer },
			moneyRow("2026-05-12", 60),
		]);

		const merged = mustMerge([source]);

		expect(merged.activities).toHaveLength(3);
		const inputTotal = source.activities.reduce(
			(sum, a) => sum + a.netCashAmount,
			0,
		);
		const outputTotal = merged.activities.reduce(
			(sum, a) => sum + a.netCashAmount,
			0,
		);
		expect(outputTotal).toBe(inputTotal);
	});
});

describe("mergeSources — overlapping files", () => {
	it("4a: drops an exact-duplicate overlap without double-counting, and reports medium confidence", () => {
		const sourceA = makeSource("export-1.csv", [
			moneyRow("2026-01-15", 100),
			moneyRow("2026-02-15", 50),
			moneyRow("2026-03-15", 75),
		]);
		// export-2 re-covers Feb-Apr and repeats export-1's Feb/Mar rows exactly —
		// a redundant re-export — then adds one genuinely new April row.
		const sourceB = makeSource("export-2.csv", [
			moneyRow("2026-02-15", 50),
			moneyRow("2026-03-15", 75),
			moneyRow("2026-04-15", 20),
		]);

		const merged = mustMerge([sourceA, sourceB]);

		// True union: export-1's 3 rows plus export-2's one new April row.
		expect(merged.activities).toHaveLength(4);
		const totalNet = merged.activities.reduce(
			(sum, a) => sum + a.netCashAmount,
			0,
		);
		expect(totalNet).toBe(100 + 50 + 75 + 20);

		const summaryB = summaryFor(merged, "export-2.csv");
		expect(summaryB.rowsSkipped).toBe(2);
		expect(summaryB.confidence).toBe("medium");
	});

	it("4b: reports low confidence when the overlapping period disagrees with the winning file", () => {
		const sourceA = makeSource("export-1.csv", [
			moneyRow("2026-01-15", 100),
			moneyRow("2026-02-15", 50),
			moneyRow("2026-03-15", 75),
		]);
		// export-2 covers the same Jan-Mar span but is missing the February row —
		// its Jan and Mar rows still match export-1 exactly, but the winning file
		// (export-1) holds 3 rows over that span where export-2 only accounts for 2.
		const sourceB = makeSource("export-2.csv", [
			moneyRow("2026-01-15", 100),
			moneyRow("2026-03-15", 75),
		]);

		const merged = mustMerge([sourceA, sourceB]);
		const summaryB = summaryFor(merged, "export-2.csv");

		expect(summaryB.confidence).toBe("low");
		expect(summaryB.confidenceReason).toContain("TEST0001CAD");
		expect(summaryB.confidenceReason).toContain("2 rows");
		expect(summaryB.confidenceReason).toContain("winning file has 3");
	});

	it("4c: treats the covered window as inclusive on both ends (merge.ts:64-69)", () => {
		// `covers` is `date >= interval.start && date <= interval.end`, so a
		// second file's row on the exact boundary date of an earlier file's
		// window is skipped. This is intentional, not an off-by-one bug — noted
		// as a fragile spot in the plan's maintenance notes.
		const sourceA = makeSource("export-1.csv", [moneyRow("2026-06-15", 40)]);
		const sourceB = makeSource("export-2.csv", [moneyRow("2026-06-15", 40)]);

		const merged = mustMerge([sourceA, sourceB]);

		expect(merged.activities).toHaveLength(1);
		expect(merged.activities[0]).toEqual(sourceA.activities[0]);

		const summaryB = summaryFor(merged, "export-2.csv");
		expect(summaryB.rowsUsed).toBe(0);
		expect(summaryB.rowsSkipped).toBe(1);
	});
});

describe("mergeSources — per-account isolation", () => {
	it("5: keeps two accounts independent even though they share an accountType label (§5)", () => {
		// docs/wealthsimple-csv-format.md §5: account_type is a label, not a key —
		// three distinct TFSAs can share the type "TFSA". Claiming a date window
		// for one account must not suppress another account's rows on the same
		// dates.
		const sourceA = makeSource("account-1.csv", [
			moneyRow("2026-01-05", 10, { accountId: "TFSA0001CAD" }),
			moneyRow("2026-01-20", 20, { accountId: "TFSA0001CAD" }),
		]);
		const sourceB = makeSource("account-2.csv", [
			moneyRow("2026-01-05", 30, { accountId: "TFSA0002CAD" }),
			moneyRow("2026-01-20", 40, { accountId: "TFSA0002CAD" }),
		]);

		const merged = mustMerge([sourceA, sourceB]);

		expect(merged.activities).toHaveLength(4);
		for (const summary of merged.sources) {
			expect(summary.rowsSkipped).toBe(0);
			expect(summary.confidence).toBe("high");
		}
	});
});

describe("mergeSources — per-account net cash total (§6.1 invariant)", () => {
	it("6: the sum of netCashAmount per account equals the true union total", () => {
		// docs/wealthsimple-csv-format.md §6.1: a per-account total that's off
		// means rows were dropped, duplicated, or sign-flipped. This is the merge
		// half of "the single best regression test for the parser and the merge
		// logic" — it would catch a dropped or double-counted row regardless of
		// which code path caused it.
		const acc1 = "TFSA0001CAD";
		const acc2 = "RRSP0002CAD";

		const sourceA = makeSource("export-1.csv", [
			moneyRow("2026-03-01", 100, { accountId: acc1 }),
			moneyRow("2026-03-15", 50, { accountId: acc1 }),
			moneyRow("2026-03-05", 200, { accountId: acc2, accountType: "RRSP" }),
		]);
		// export-2 redundantly re-covers acc1's mid-March row (dropped, matches
		// exactly) and adds one genuinely new acc1 row; it never touches acc2.
		const sourceB = makeSource("export-2.csv", [
			moneyRow("2026-03-15", 50, { accountId: acc1 }),
			moneyRow("2026-04-01", -20, { accountId: acc1 }),
		]);

		const merged = mustMerge([sourceA, sourceB]);

		const expectedTotals = new Map<string, number>([
			[acc1, 100 + 50 - 20],
			[acc2, 200],
		]);

		for (const [accountId, expectedTotal] of expectedTotals) {
			const actualTotal = merged.activities
				.filter((a) => a.accountId === accountId)
				.reduce((sum, a) => sum + a.netCashAmount, 0);
			expect(Math.abs(actualTotal - expectedTotal)).toBeLessThanOrEqual(0.005);
		}
	});
});

describe("analyzeMerge", () => {
	it("7: agrees with mergeSources on what was kept, and skippedBySource holds exactly what was dropped", () => {
		const sourceA = makeSource("export-1.csv", [
			moneyRow("2026-01-15", 100),
			moneyRow("2026-02-15", 50),
			moneyRow("2026-03-15", 75),
		]);
		const sourceB = makeSource("export-2.csv", [
			moneyRow("2026-02-15", 50),
			moneyRow("2026-03-15", 75),
			moneyRow("2026-04-15", 20),
		]);

		const merged = mustMerge([sourceA, sourceB]);
		const analysis = analyzeMerge([sourceA, sourceB]);

		expect(analysis.totalRows).toBe(merged.activities.length);
		expect(analysis.skippedBySource["export-2.csv"]).toEqual([
			sourceB.activities[0],
			sourceB.activities[1],
		]);
		expect(analysis.skippedBySource["export-1.csv"]).toEqual([]);
	});
});

describe("mergeSources — problems pass through unchanged", () => {
	it("carries each source's problems onto its summary, including a source whose rows were partly skipped", () => {
		const sourceA: SourceFile = {
			...makeSource("export-1.csv", [moneyRow("2026-01-15", 100)]),
			problems: [
				"TFSA TEST0001CAD: net cash sums to 9999.00 — not a plausible balance",
			],
		};
		const sourceB: SourceFile = {
			...makeSource("export-2.csv", [
				moneyRow("2026-01-15", 100), // overlaps sourceA's row — skipped
				moneyRow("2026-01-20", 50), // no overlap — kept
			]),
			problems: [],
		};

		const merged = mustMerge([sourceA, sourceB]);

		expect(merged.sources[0].problems).toBe(sourceA.problems);
		expect(merged.sources[1].problems).toBe(sourceB.problems);
		// sourceB is the case that matters: it lost a row to the overlap and its
		// (empty) problems list still carries through untouched.
		expect(merged.sources[1].rowsSkipped).toBe(1);
		expect(merged.sources[1].rowsUsed).toBe(1);
	});
});

describe("mergeSources — exportedOn passes through unchanged", () => {
	it("carries each source's export date onto its summary, and null when there was no footer", () => {
		const dated: SourceFile = {
			...makeSource("export-1.csv", [moneyRow("2026-01-15", 100)]),
			exportedOn: "2026-08-03",
		};
		const undated = makeSource("export-2.csv", [moneyRow("2026-01-20", 50)]);

		const merged = mustMerge([dated, undated]);

		expect(merged.sources[0].exportedOn).toBe("2026-08-03");
		// A file with no footer is normal, not an error.
		expect(merged.sources[1].exportedOn).toBeNull();
	});
});
