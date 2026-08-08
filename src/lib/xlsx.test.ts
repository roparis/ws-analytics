import { describe, expect, it } from "vitest";
import {
	BLANK,
	formula,
	gainLoss,
	gainLossPercent,
	num,
	type SheetGrid,
	text,
} from "@/lib/google-sheet";
import { buildXlsx, safeSheetName, zipStored } from "@/lib/xlsx";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function grid(name: string, rows: SheetGrid["rows"]): SheetGrid {
	return {
		name,
		rows,
		rowCount: rows.length,
		columnCount: rows.reduce((widest, row) => Math.max(widest, row.length), 0),
		regions: [{ headerRow: 1, lastRow: rows.length, columns: 3 }],
	};
}

/**
 * Reads a stored-entry ZIP back out. Deliberately a separate implementation
 * from the writer, walking the central directory rather than trusting the local
 * headers, so a wrong offset or size is caught rather than mirrored.
 */
function unzipStored(archive: Uint8Array): Map<string, string> {
	const view = new DataView(archive.buffer, archive.byteOffset, archive.length);

	let end = archive.length - 22;
	while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
	if (end < 0) throw new Error("no end-of-central-directory record");

	const count = view.getUint16(end + 10, true);
	let cursor = view.getUint32(end + 16, true);
	const files = new Map<string, string>();

	for (let index = 0; index < count; index += 1) {
		if (view.getUint32(cursor, true) !== 0x02014b50) {
			throw new Error("bad central directory signature");
		}
		const size = view.getUint32(cursor + 24, true);
		const nameLength = view.getUint16(cursor + 28, true);
		const extraLength = view.getUint16(cursor + 30, true);
		const commentLength = view.getUint16(cursor + 32, true);
		const offset = view.getUint32(cursor + 42, true);
		const name = decoder.decode(
			archive.subarray(cursor + 46, cursor + 46 + nameLength),
		);

		if (view.getUint32(offset, true) !== 0x04034b50) {
			throw new Error(`bad local header for ${name}`);
		}
		const localNameLength = view.getUint16(offset + 26, true);
		const localExtraLength = view.getUint16(offset + 28, true);
		const dataStart = offset + 30 + localNameLength + localExtraLength;
		files.set(
			name,
			decoder.decode(archive.subarray(dataStart, dataStart + size)),
		);

		cursor += 46 + nameLength + extraLength + commentLength;
	}

	return files;
}

/** Resolves a cell's `s` index through `cellXfs` to the format it points at. */
function formatOf(files: Map<string, string>, sheetPart: string, ref: string) {
	const sheet = files.get(sheetPart) ?? "";
	const cell = new RegExp(`<c r="${ref}"([^>]*)>`).exec(sheet);
	const styleIndex = Number(/ s="(\d+)"/.exec(cell?.[1] ?? "")?.[1] ?? 0);

	const xfs = [
		...(
			/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(
				files.get("xl/styles.xml") ?? "",
			)?.[1] ?? ""
		).matchAll(/<xf [^>]*\/>/g),
	].map((m) => m[0]);

	const xf = xfs[styleIndex] ?? "";
	const attr = (name: string) =>
		Number(new RegExp(`${name}="(\\d+)"`).exec(xf)?.[1] ?? 0);

	return {
		styleIndex,
		numFmtId: attr("numFmtId"),
		fontId: attr("fontId"),
		fillId: attr("fillId"),
		borderId: attr("borderId"),
	};
}

describe("zipStored", () => {
	it("produces an archive its own reader can walk back", () => {
		const archive = zipStored([
			{ name: "a.txt", data: encoder.encode("hello") },
			{ name: "nested/b.xml", data: encoder.encode("<x>é®</x>") },
		]);
		const files = unzipStored(archive);

		expect([...files.keys()]).toEqual(["a.txt", "nested/b.xml"]);
		expect(files.get("a.txt")).toBe("hello");
		// Multi-byte characters must be counted in bytes, not code units, or every
		// entry after this one starts at the wrong offset.
		expect(files.get("nested/b.xml")).toBe("<x>é®</x>");
	});
});

describe("safeSheetName", () => {
	it("strips the characters a workbook may not use in a tab name", () => {
		expect(safeSheetName("Closed positions")).toBe("Closed positions");
		expect(safeSheetName("A/B:C*D?E[F]")).toBe("A B C D E F ");
		expect(safeSheetName("x".repeat(40))).toHaveLength(31);
	});
});

describe("buildXlsx", () => {
	const sheets = [
		grid("Holdings", [
			[text("Symbol"), text("Shares"), text("Price")],
			[
				text("VTI"),
				num(30.9015, 8),
				formula('=IFERROR(GOOGLEFINANCE($E2,"price"),"")'),
			],
			[text("Total"), BLANK, formula("='Cash'!$C$5")],
		]),
		grid("Cash", [[text("Account"), text("Balance")]]),
	];

	it("writes every part a reader needs to open the file", () => {
		const files = unzipStored(buildXlsx(sheets));
		expect([...files.keys()]).toEqual([
			"[Content_Types].xml",
			"_rels/.rels",
			"xl/workbook.xml",
			"xl/_rels/workbook.xml.rels",
			"xl/styles.xml",
			"xl/worksheets/sheet1.xml",
			"xl/worksheets/sheet2.xml",
		]);
	});

	it("names each tab and wires it to the matching worksheet part", () => {
		const files = unzipStored(buildXlsx(sheets));
		const workbook = files.get("xl/workbook.xml") ?? "";
		expect(workbook).toContain('name="Holdings" sheetId="1" r:id="rId1"');
		expect(workbook).toContain('name="Cash" sheetId="2" r:id="rId2"');

		const rels = files.get("xl/_rels/workbook.xml.rels") ?? "";
		expect(rels).toContain('Id="rId1"');
		expect(rels).toContain('Target="worksheets/sheet1.xml"');
		expect(rels).toContain('Target="worksheets/sheet2.xml"');
	});

	it("writes formulas without their leading = so they stay live", () => {
		// An `<f>` element holds the expression itself. Leaving the `=` on turns
		// it into a parse error, which is the whole feature failing quietly.
		const sheet = unzipStored(buildXlsx(sheets)).get(
			"xl/worksheets/sheet1.xml",
		);
		expect(sheet).toContain(
			"<f>IFERROR(GOOGLEFINANCE($E2,&quot;price&quot;),&quot;&quot;)</f>",
		);
		expect(sheet).not.toContain("<f>=");
		// Cross-sheet references survive intact.
		expect(sheet).toContain("<f>'Cash'!$C$5</f>");
	});

	it("writes text as an inline string and numbers as bare values", () => {
		const sheet = unzipStored(buildXlsx(sheets)).get(
			"xl/worksheets/sheet1.xml",
		);
		expect(sheet).toContain('<is><t xml:space="preserve">VTI</t></is>');
		expect(sheet).toContain("<v>30.90150000</v>");
	});

	it("colours gains and losses through a number format, not a font", () => {
		// These cells are GOOGLEFINANCE formulas whose sign flips with the market,
		// so the colour has to live in the format and re-evaluate — a font colour
		// fixed at export time would be a snapshot that quietly goes wrong.
		const files = unzipStored(
			buildXlsx([
				grid("S", [
					[text("Symbol"), text("Gain"), text("Return")],
					[
						text("VTI"),
						gainLoss(num(-24.98)),
						gainLossPercent(formula("=TO_PERCENT(B2/C2)")),
					],
				]),
			]),
		);
		const styles = files.get("xl/styles.xml") ?? "";

		// [Color10] is #008000. The named [Green] is #00FF00, which is
		// near-invisible on a white sheet.
		expect(styles).toContain(
			'<numFmt numFmtId="164" formatCode="[Color10]#,##0.00;[Red]-#,##0.00;#,##0.00"/>',
		);
		// General, not 0.0% — TO_PERCENT already carries the percentage
		// formatting, and stacking one on top would render 8.34% as 834%.
		expect(styles).toContain(
			'<numFmt numFmtId="165" formatCode="[Color10]General;[Red]General;General"/>',
		);
		expect(styles).not.toContain("[Green]");

		expect(formatOf(files, "xl/worksheets/sheet1.xml", "B2").numFmtId).toBe(
			164,
		);
		expect(formatOf(files, "xl/worksheets/sheet1.xml", "C2").numFmtId).toBe(
			165,
		);
		// A plain cell keeps the default number format.
		expect(formatOf(files, "xl/worksheets/sheet1.xml", "A2").numFmtId).toBe(0);
	});

	it("rules every declared table, and heads and totals differently", () => {
		const files = unzipStored(
			buildXlsx([
				{
					name: "S",
					rows: [
						[text("Loose title")],
						[text("Symbol"), text("Book cost")],
						[text("VTI"), num(100)],
						[text("Total"), formula("=SUM(B3:B3)")],
					],
					rowCount: 4,
					columnCount: 2,
					regions: [{ headerRow: 2, lastRow: 3, columns: 2, totalRow: 4 }],
				},
			]),
		);
		const at = (ref: string) =>
			formatOf(files, "xl/worksheets/sheet1.xml", ref);

		// Header: bold, tinted, boxed.
		expect(at("A2").fontId).toBe(1);
		expect(at("A2").fillId).toBe(2);
		expect(at("A2").borderId).toBe(1);

		// Body: boxed, not bold.
		expect(at("A3").borderId).toBe(1);
		expect(at("A3").fontId).toBe(0);

		// Total: bold with the heavier top rule that separates it from the body.
		expect(at("A4").fontId).toBe(1);
		expect(at("A4").borderId).toBe(2);

		// Outside every region, nothing is ruled at all.
		expect(at("A1").styleIndex).toBe(0);

		const styles = files.get("xl/styles.xml") ?? "";
		expect(styles).toContain('<borders count="3">');
		expect(styles).toContain('<top style="medium">');
	});

	it("still draws the borders of a blank cell inside a table", () => {
		// Short rows are common — a totals line only fills a few columns — and a
		// gap in the ruling would look like a broken table.
		const files = unzipStored(
			buildXlsx([
				{
					name: "S",
					rows: [[text("A"), text("B")], [text("only one")]],
					rowCount: 2,
					columnCount: 2,
					regions: [{ headerRow: 1, lastRow: 2, columns: 2 }],
				},
			]),
		);
		const sheet = files.get("xl/worksheets/sheet1.xml") ?? "";
		expect(sheet).toMatch(/<c r="B2" s="\d+"\/>/);
	});

	it("escapes XML metacharacters in cell text", () => {
		const files = unzipStored(
			buildXlsx([grid("S", [[text('Bought <10> & "sold"')]])]),
		);
		const sheet = files.get("xl/worksheets/sheet1.xml") ?? "";
		expect(sheet).toContain("Bought &lt;10&gt; &amp; &quot;sold&quot;");
	});
});
