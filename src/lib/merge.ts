import type { Activity, ActivityDataset } from "@/lib/wealthsimple";

/**
 * Exports carry no per-row identifier, and genuinely identical rows do occur
 * (e.g. two separate $25 transfers into the same account on the same day), so
 * de-duplicating by row content would silently delete real activity.
 *
 * Instead we merge by coverage: each file covers a date window per account, and
 * a file only contributes rows for the parts of that window no earlier file has
 * already claimed. Overlaps never double-count, and duplicates inside a single
 * file are preserved.
 */

export interface SourceFile {
	fileName: string;
	/** Kept so a later parser fix can re-derive instead of trusting cached rows. */
	rawText: string;
	activities: Activity[];
}

/** The window a source actually ended up owning for one account. */
export interface CoverageSegment {
	accountId: string;
	accountType: string;
	start: string;
	end: string;
	rows: number;
}

/**
 * How much the merge can be trusted for a given source:
 * - `high`   nothing overlapped, so nothing was dropped
 * - `medium` an overlap was dropped, but it matched the winning file exactly
 * - `low`    the overlapping period disagrees — one export is missing activity
 */
export type Confidence = "high" | "medium" | "low";

export interface SourceSummary {
	fileName: string;
	rowsUsed: number;
	rowsSkipped: number;
	dateRange: { start: string; end: string };
	segments: CoverageSegment[];
	confidence: Confidence;
	confidenceReason: string;
}

export interface MergedDataset extends ActivityDataset {
	sources: SourceSummary[];
}

/** Per-source detail for the merge review screen; skipped rows can be large. */
export interface MergeAnalysis {
	summaries: SourceSummary[];
	skippedBySource: Record<string, Activity[]>;
	dateRange: { start: string; end: string };
	totalRows: number;
}

interface Interval {
	start: string;
	end: string;
}

function covers(intervals: Interval[], date: string): boolean {
	for (const interval of intervals) {
		if (date >= interval.start && date <= interval.end) return true;
	}
	return false;
}

/** Insert `next` and coalesce any intervals that now touch or overlap. */
function claim(intervals: Interval[], next: Interval): Interval[] {
	const merged: Interval[] = [];
	let current = next;

	for (const interval of [...intervals].sort((a, b) =>
		a.start.localeCompare(b.start),
	)) {
		if (interval.end < current.start || interval.start > current.end) {
			merged.push(interval);
			continue;
		}
		current = {
			start: interval.start < current.start ? interval.start : current.start,
			end: interval.end > current.end ? interval.end : current.end,
		};
	}

	merged.push(current);
	return merged.sort((a, b) => a.start.localeCompare(b.start));
}

function windowOf(activities: Activity[]): Interval | null {
	if (activities.length === 0) return null;
	let start = activities[0].transactionDate;
	let end = start;
	for (const activity of activities) {
		if (activity.transactionDate < start) start = activity.transactionDate;
		if (activity.transactionDate > end) end = activity.transactionDate;
	}
	return { start, end };
}

interface MergeResult {
	activities: Activity[];
	summaries: SourceSummary[];
	skippedBySource: Record<string, Activity[]>;
}

/**
 * Merges sources in the order supplied — earlier files win any overlap.
 * `keepSkipped` retains the dropped rows so the merge review screen can show
 * exactly what each file lost; the dashboard path leaves them out.
 */
function totals(rows: Activity[]) {
	let net = 0;
	for (const row of rows) net += row.netCashAmount;
	return { count: rows.length, net };
}

function runMerge(sources: SourceFile[], keepSkipped: boolean): MergeResult {
	const claimedByAccount = new Map<string, Interval[]>();
	const acceptedByAccount = new Map<string, Activity[]>();
	const activities: Activity[] = [];
	const summaries: SourceSummary[] = [];
	const skippedBySource: Record<string, Activity[]> = {};

	for (const source of sources) {
		// Rows accepted before this source ran — what its skipped rows are up against.
		const priorCounts = new Map<string, number>();
		for (const [accountId, rows] of acceptedByAccount) {
			priorCounts.set(accountId, rows.length);
		}
		const disagreements: string[] = [];
		// Group this file's rows by account so each account's window is claimed
		// only after every row in it has been tested against earlier files.
		const byAccount = new Map<string, Activity[]>();
		for (const activity of source.activities) {
			const bucket = byAccount.get(activity.accountId);
			if (bucket) bucket.push(activity);
			else byAccount.set(activity.accountId, [activity]);
		}

		let used = 0;
		let skipped = 0;
		const segments: CoverageSegment[] = [];
		const dropped: Activity[] = [];

		for (const [accountId, rows] of byAccount) {
			const claimed = claimedByAccount.get(accountId) ?? [];
			const contributed: Activity[] = [];
			const lost: Activity[] = [];

			for (const activity of rows) {
				if (covers(claimed, activity.transactionDate)) {
					skipped++;
					lost.push(activity);
					if (keepSkipped) dropped.push(activity);
					continue;
				}
				activities.push(activity);
				contributed.push(activity);
				used++;
			}

			// Compare what was dropped against what the winning file holds for the
			// same account over the same dates. Equal counts and totals mean the
			// overlap was pure redundancy; a difference means one export is short.
			if (lost.length > 0) {
				const span = windowOf(lost);
				const prior = (acceptedByAccount.get(accountId) ?? []).slice(
					0,
					priorCounts.get(accountId) ?? 0,
				);
				const rival = span
					? prior.filter(
							(activity) =>
								activity.transactionDate >= span.start &&
								activity.transactionDate <= span.end,
						)
					: [];
				const mine = totals(lost);
				const theirs = totals(rival);

				if (
					mine.count !== theirs.count ||
					Math.abs(mine.net - theirs.net) > 0.005
				) {
					disagreements.push(
						`${rows[0].accountType} ${accountId}: this file has ${mine.count} rows / ${mine.net.toFixed(2)} where the winning file has ${theirs.count} / ${theirs.net.toFixed(2)}`,
					);
				}
			}

			const accepted = acceptedByAccount.get(accountId);
			if (accepted) accepted.push(...contributed);
			else acceptedByAccount.set(accountId, [...contributed]);

			// What this source actually owns is the span of what it contributed.
			const owned = windowOf(contributed);
			if (owned) {
				segments.push({
					accountId,
					accountType: rows[0].accountType,
					start: owned.start,
					end: owned.end,
					rows: contributed.length,
				});
			}

			const window = windowOf(rows);
			if (window) claimedByAccount.set(accountId, claim(claimed, window));
		}

		segments.sort(
			(a, b) =>
				a.accountType.localeCompare(b.accountType) ||
				a.accountId.localeCompare(b.accountId),
		);

		let confidence: Confidence = "high";
		let confidenceReason = "No overlap with other files — nothing was dropped.";
		if (disagreements.length > 0) {
			confidence = "low";
			confidenceReason = `The shared period doesn't match. ${disagreements.join("; ")}.`;
		} else if (skipped > 0) {
			confidence = "medium";
			confidenceReason = `${skipped.toLocaleString()} overlapping rows were dropped, and they match the winning file exactly — redundant re-export, totals unaffected.`;
		}

		summaries.push({
			fileName: source.fileName,
			rowsUsed: used,
			rowsSkipped: skipped,
			dateRange: windowOf(source.activities) ?? { start: "", end: "" },
			segments,
			confidence,
			confidenceReason,
		});

		if (keepSkipped) skippedBySource[source.fileName] = dropped;
	}

	activities.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

	return { activities, summaries, skippedBySource };
}

/** Detailed merge breakdown for the review screen. */
export function analyzeMerge(sources: SourceFile[]): MergeAnalysis {
	const { activities, summaries, skippedBySource } = runMerge(sources, true);
	const dates = activities.map((activity) => activity.transactionDate);
	return {
		summaries,
		skippedBySource,
		dateRange: { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "" },
		totalRows: activities.length,
	};
}

export function mergeSources(sources: SourceFile[]): MergedDataset | null {
	if (sources.length === 0) return null;

	const { activities, summaries } = runMerge(sources, false);

	const accounts = new Map<string, string>();
	for (const activity of activities) {
		accounts.set(activity.accountId, activity.accountType);
	}

	const dates = activities.map((activity) => activity.transactionDate);

	return {
		fileName:
			sources.length === 1
				? sources[0].fileName
				: `${sources.length} files merged`,
		activities,
		accountTypes: [
			...new Set(activities.map((activity) => activity.accountType)),
		].sort(),
		accounts: [...accounts.entries()]
			.map(([id, accountType]) => ({ id, accountType }))
			.sort(
				(a, b) =>
					a.accountType.localeCompare(b.accountType) ||
					a.id.localeCompare(b.id),
			),
		activityTypes: [
			...new Set(activities.map((activity) => activity.activityType)),
		].sort(),
		dateRange: { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "" },
		currencies: [
			...new Set(activities.map((activity) => activity.currency)),
		].sort(),
		sources: summaries,
	};
}
