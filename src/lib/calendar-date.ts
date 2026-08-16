/**
 * The one place a `Date` becomes a `YYYY-MM-DD` calendar date.
 *
 * `date.toISOString().slice(0, 10)` reads the date in **UTC**. This app's
 * readers are in Canada, UTC−4 to UTC−8, so anything computed after roughly
 * 20:00 local already reads as tomorrow in UTC and lands on tomorrow's date.
 *
 * The failure is silent. Nothing throws — a banner fires a day early, an
 * exported file is stamped with tomorrow, a chart grows a phantom point. The
 * fix is to read the clock in local components (`getFullYear`, `getMonth`,
 * `getDate`) instead of asking for an ISO instant and truncating it.
 *
 * Once a value is a bare `YYYY-MM-DD` string, it carries no timezone at all,
 * so `addDays` and `addMonths` below reach for `Date.UTC` internally. That is
 * not a contradiction of the rule above: it is arithmetic on a timezone-free
 * calendar date, never a read of the local clock, so it stays exact and
 * DST-free.
 *
 * `src/lib/market-month.ts` looks like the same problem and is not: it reads
 * an instant in a *named exchange* timezone, not the reader's local zone.
 * Folding it into this module would reintroduce the bug its header describes.
 */

/** The `Date`'s local calendar date, as `YYYY-MM-DD`. No default — a bare
 * `toLocalIso()` at a call site reads as "today" but silently isn't. */
export function toLocalIso(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
	].join("-");
}

/** Today's local calendar date, as `YYYY-MM-DD`. `now` is an injectable seam
 * for tests — there are no fake timers in this repo. */
export function todayLocalIso(now = new Date()): string {
	return toLocalIso(now);
}

function parseIso(iso: string): { year: number; month: number; day: number } {
	const [year, month, day] = iso.split("-").map(Number);
	return { year, month, day };
}

/**
 * `iso` shifted by `days` (negative to go back). Preconditions are not
 * validated — this runs inside `useMemo` in a render path, where a throw
 * takes the page down.
 */
export function addDays(iso: string, days: number): string {
	const { year, month, day } = parseIso(iso);
	const shifted = new Date(Date.UTC(year, month - 1, day + days));
	return [
		shifted.getUTCFullYear(),
		String(shifted.getUTCMonth() + 1).padStart(2, "0"),
		String(shifted.getUTCDate()).padStart(2, "0"),
	].join("-");
}

/** The number of days in `year`-`month` (1-indexed month). */
function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * `iso` shifted by `months` (negative to go back), with the day **clamped**
 * to the target month's length rather than left to overflow.
 *
 * Handing an out-of-range month straight to `Date` and letting it normalize
 * (`new Date(2026, -1, 31)` silently becoming March 3rd instead of the
 * intended late February) is exactly the bug this function replaces, so the
 * month wrap is done first in integer arithmetic and the day is clamped
 * afterward.
 */
export function addMonths(iso: string, months: number): string {
	const { year, month, day } = parseIso(iso);
	const total = year * 12 + (month - 1) + months;
	const targetYear = Math.floor(total / 12);
	const targetMonth = ((total % 12) + 12) % 12; // 0-indexed
	const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth + 1));
	return [
		targetYear,
		String(targetMonth + 1).padStart(2, "0"),
		String(clampedDay).padStart(2, "0"),
	].join("-");
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative if `to` is
 * earlier. `Date.UTC` on both endpoints keeps the difference an exact
 * multiple of 86 400 000, so no rounding is needed. */
export function daysBetween(from: string, to: string): number {
	const a = parseIso(from);
	const b = parseIso(to);
	const fromMs = Date.UTC(a.year, a.month - 1, a.day);
	const toMs = Date.UTC(b.year, b.month - 1, b.day);
	return (toMs - fromMs) / 86_400_000;
}
