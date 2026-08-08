/**
 * Clipboard and download helpers for the Google Sheets export. Touches the DOM,
 * so it lives beside `pdf.ts` rather than in a pure module.
 */

/**
 * Copies plain text, and *only* plain text.
 *
 * Deliberately not `ClipboardItem` with a `text/html` flavour: when both are on
 * the clipboard Google Sheets prefers the HTML one, and HTML-sourced cells
 * paste as values — which would land every `=GOOGLEFINANCE(...)` as inert text
 * and defeat the entire feature. The formatting HTML would buy is not worth
 * losing the formulas.
 *
 * `navigator.clipboard` is undefined outside a secure context, so a plain-HTTP
 * origin rejects here and the caller falls back to the file download.
 */
export async function copyText(value: string): Promise<void> {
	if (!navigator.clipboard?.writeText) {
		throw new Error("The clipboard isn't available in this browser context.");
	}
	await navigator.clipboard.writeText(value);
}

export function downloadTextFile(
	value: string,
	fileName: string,
	type = "text/tab-separated-values;charset=utf-8",
): void {
	// The BOM goes on the file only. On the clipboard it would paste as a stray
	// character in the first cell; in a downloaded file it is what stops Excel
	// from mangling the accents and the `®` in Wealthsimple's descriptions.
	downloadBlob(["﻿", value], fileName, type);
}

export function downloadBlob(
	parts: BlobPart[],
	fileName: string,
	type: string,
): void {
	const blob = new Blob(parts, { type });
	const url = URL.createObjectURL(blob);

	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	document.body.append(link);
	link.click();
	link.remove();

	// Safari cancels an in-flight download if the object URL is revoked in the
	// same tick as the click.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Today as `MM-DD-YY`, the default name for an export.
 *
 * Built from the local date rather than an ISO string: `toISOString` is UTC, so
 * anyone west of Greenwich exporting in the evening would get tomorrow's date
 * on their file.
 */
export function todayStamp(now = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return [
		pad(now.getMonth() + 1),
		pad(now.getDate()),
		String(now.getFullYear()).slice(-2),
	].join("-");
}

/**
 * Makes a user-typed name safe to hand to a download.
 *
 * Strips the separators and reserved characters no common filesystem accepts,
 * and drops a `.xlsx` the user may have typed so the extension isn't doubled.
 * Returns an empty string when nothing usable is left, which the caller reads
 * as "fall back to the default".
 */
export function safeFileName(value: string): string {
	return (
		value
			.replace(/\.xlsx$/i, "")
			// Path separators and the Windows reserved set. A leading dot would make
			// the file hidden on Unix, which is not what anyone typing one means.
			.replace(/[\\/:*?"<>|]/g, "-")
			.replace(/\s+/g, " ")
			.replace(/^\.+/, "")
			.trim()
	);
}

/** `612 KB` — for telling someone how big a clipboard payload they're about to take. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
