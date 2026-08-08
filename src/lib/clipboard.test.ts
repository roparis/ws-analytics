import { describe, expect, it } from "vitest";
import { formatBytes, safeFileName, todayStamp } from "@/lib/clipboard";

describe("todayStamp", () => {
	it("formats the date as MM-DD-YY", () => {
		expect(todayStamp(new Date(2026, 7, 7))).toBe("08-07-26");
		expect(todayStamp(new Date(2026, 11, 25))).toBe("12-25-26");
	});

	it("reads the local date, not the UTC one", () => {
		// `toISOString().slice(0, 10)` on this moment gives 2026-08-08 anywhere
		// west of Greenwich, which would put tomorrow's date on tonight's export.
		const evening = new Date(2026, 7, 7, 22, 30);
		expect(todayStamp(evening)).toBe("08-07-26");
	});
});

describe("safeFileName", () => {
	it("keeps an ordinary name intact", () => {
		expect(safeFileName("08-07-26")).toBe("08-07-26");
		expect(safeFileName("Q3 holdings (final)")).toBe("Q3 holdings (final)");
	});

	it("replaces path separators and reserved characters", () => {
		expect(safeFileName("2026/08:holdings")).toBe("2026-08-holdings");
		expect(safeFileName('a\\b*c?d"e<f>g|h')).toBe("a-b-c-d-e-f-g-h");
	});

	it("drops an extension the user typed so it isn't doubled", () => {
		expect(safeFileName("holdings.xlsx")).toBe("holdings");
		expect(safeFileName("holdings.XLSX")).toBe("holdings");
		// Only the trailing one — a dot mid-name is a legitimate character.
		expect(safeFileName("2026.08.holdings")).toBe("2026.08.holdings");
	});

	it("won't produce a hidden file or an empty name", () => {
		expect(safeFileName("...secret")).toBe("secret");
		expect(safeFileName("   ")).toBe("");
		expect(safeFileName(".xlsx")).toBe("");
	});
});

describe("formatBytes", () => {
	it("scales to a readable unit", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(612_000)).toBe("598 KB");
		expect(formatBytes(2_400_000)).toBe("2.3 MB");
	});
});
