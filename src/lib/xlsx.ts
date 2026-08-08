import {
	type Cell,
	type CellStyle,
	colName,
	type SheetGrid,
	type SheetRegion,
} from "@/lib/google-sheet";

/**
 * A minimal `.xlsx` writer — just enough of the format to carry several named
 * sheets of text, numbers and formulas.
 *
 * This exists because a clipboard paste can only ever fill one tab, and TSV has
 * no concept of a workbook. An `.xlsx` is the only format that carries real
 * tabs *and* survives Google Sheets' importer with its formulas intact, so the
 * `=GOOGLEFINANCE(...)` cells stay live after the file is converted.
 *
 * Hand-rolled rather than pulling in a spreadsheet library: the subset needed
 * here is small, and a writer this size is easier to reason about than a
 * dependency whose defaults would have to be fought.
 *
 * Entries are stored uncompressed. That makes the file several times larger
 * than a compressed one, but it keeps this module synchronous and testable in
 * node without either a deflate dependency or the async `CompressionStream`
 * dance — and the export dialog shows the size, so nothing is hidden.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (let index = 0; index < bytes.length; index += 1) {
		crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
	name: string;
	data: Uint8Array;
}

/**
 * Writes a ZIP archive with every entry stored (compression method 0). An
 * `.xlsx` is exactly this: a ZIP of XML parts.
 */
export function zipStored(entries: ZipEntry[]): Uint8Array {
	const encoder = new TextEncoder();
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const crc = crc32(entry.data);
		const size = entry.data.length;

		const local = new Uint8Array(30 + name.length + size);
		const localView = new DataView(local.buffer);
		localView.setUint32(0, 0x04034b50, true);
		localView.setUint16(4, 20, true); // version needed
		localView.setUint16(6, 0x0800, true); // UTF-8 names
		localView.setUint16(8, 0, true); // stored
		localView.setUint16(10, 0, true); // mod time
		localView.setUint16(12, 0x21, true); // mod date — 1980-01-01
		localView.setUint32(14, crc, true);
		localView.setUint32(18, size, true);
		localView.setUint32(22, size, true);
		localView.setUint16(26, name.length, true);
		localView.setUint16(28, 0, true);
		local.set(name, 30);
		local.set(entry.data, 30 + name.length);
		locals.push(local);

		const central = new Uint8Array(46 + name.length);
		const centralView = new DataView(central.buffer);
		centralView.setUint32(0, 0x02014b50, true);
		centralView.setUint16(4, 20, true); // version made by
		centralView.setUint16(6, 20, true); // version needed
		centralView.setUint16(8, 0x0800, true);
		centralView.setUint16(10, 0, true);
		centralView.setUint16(12, 0, true);
		centralView.setUint16(14, 0x21, true);
		centralView.setUint32(16, crc, true);
		centralView.setUint32(20, size, true);
		centralView.setUint32(24, size, true);
		centralView.setUint16(28, name.length, true);
		centralView.setUint16(30, 0, true); // extra
		centralView.setUint16(32, 0, true); // comment
		centralView.setUint16(34, 0, true); // disk
		centralView.setUint16(36, 0, true); // internal attrs
		centralView.setUint32(38, 0, true); // external attrs
		centralView.setUint32(42, offset, true);
		central.set(name, 46);
		centrals.push(central);

		offset += local.length;
	}

	const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, 0x06054b50, true);
	endView.setUint16(4, 0, true);
	endView.setUint16(6, 0, true);
	endView.setUint16(8, entries.length, true);
	endView.setUint16(10, entries.length, true);
	endView.setUint32(12, centralSize, true);
	endView.setUint32(16, offset, true);
	endView.setUint16(20, 0, true);

	const parts = [...locals, ...centrals, end];
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let cursor = 0;
	for (const part of parts) {
		out.set(part, cursor);
		cursor += part.length;
	}
	return out;
}

function escapeXml(value: string): string {
	return (
		value
			// Control characters other than tab/newline are illegal in XML 1.0 and
			// would make the whole file unopenable, so drop them outright.
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
			.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
	);
}

/**
 * Every cell format the workbook uses, as a coordinate in three independent
 * axes. `cellXfs` is built from this at the end, and a cell's `s` attribute is
 * that entry's index — so a new combination costs one line here rather than a
 * hand-maintained table of magic numbers.
 */
interface CellFormat {
	/** Green above zero, red below, on the money or the percent variant. */
	numberFormat?: CellStyle;
	/** Ruled as part of a table body. */
	bordered?: boolean;
	/** A column heading. */
	header?: boolean;
	/** A totals line, ruled off from the body above it. */
	total?: boolean;
}

function formatKey(format: CellFormat): string {
	return [
		format.numberFormat ?? "-",
		format.bordered ? "b" : "-",
		format.header ? "h" : "-",
		format.total ? "t" : "-",
	].join("");
}

const NUMBER_FORMAT_ID: Record<CellStyle, number> = {
	gainLoss: 164,
	gainLossPercent: 165,
};

/** Collects the distinct formats a workbook needs and hands back their indices. */
class FormatTable {
	private readonly byKey = new Map<string, number>();
	readonly formats: CellFormat[] = [];

	constructor() {
		// Index 0 is the default, so an unformatted cell needs no `s` attribute.
		this.indexOf({});
	}

	indexOf(format: CellFormat): number {
		const key = formatKey(format);
		const existing = this.byKey.get(key);
		if (existing !== undefined) return existing;
		const index = this.formats.length;
		this.byKey.set(key, index);
		this.formats.push(format);
		return index;
	}
}

/** Where a cell sits relative to the tables declared on its sheet. */
function formatFor(
	cell: Cell,
	row: number,
	column: number,
	regions: SheetRegion[],
): CellFormat {
	const numberFormat =
		cell.kind === "number" || cell.kind === "formula" ? cell.style : undefined;

	for (const region of regions) {
		const last = Math.max(region.lastRow, region.totalRow ?? region.lastRow);
		if (row < region.headerRow || row > last) continue;
		if (column >= region.columns) continue;
		return {
			numberFormat,
			bordered: true,
			header: row === region.headerRow,
			total: row === region.totalRow,
		};
	}

	return numberFormat ? { numberFormat } : {};
}

function cellXml(cell: Cell, reference: string, styleIndex: number): string {
	const style = styleIndex > 0 ? ` s="${styleIndex}"` : "";
	switch (cell.kind) {
		case "blank":
			// A blank inside a table still needs its borders drawn.
			return style === "" ? "" : `<c r="${reference}"${style}/>`;
		case "number":
			return `<c r="${reference}"${style}><v>${renderXlsxNumber(cell.value, cell.decimals)}</v></c>`;
		case "formula":
			// `<f>` holds the expression without its leading `=`.
			return `<c r="${reference}"${style}><f>${escapeXml(cell.value.replace(/^=/, ""))}</f></c>`;
		case "text":
			// An inline string is unambiguously a string, so the leading-apostrophe
			// guard the TSV path needs would show up as a literal character here.
			return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
	}
}

function renderXlsxNumber(value: number, decimals: number): string {
	const fixed = value.toFixed(decimals);
	return Number(fixed) === 0 ? "0" : fixed;
}

function sheetXml(grid: SheetGrid, formats: FormatTable): string {
	const rows: string[] = [];
	grid.rows.forEach((row, rowIndex) => {
		const rowNumber = rowIndex + 1;
		// A table's rows can be shorter than the block is wide, so walk the full
		// width — the missing cells still need their borders.
		const width = Math.max(
			row.length,
			...grid.regions.map((region) =>
				rowNumber >= region.headerRow &&
				rowNumber <= Math.max(region.lastRow, region.totalRow ?? 0)
					? region.columns
					: 0,
			),
		);

		const cells = Array.from({ length: width }, (_, columnIndex) => {
			const cell = row[columnIndex] ?? { kind: "blank" as const };
			const index = formats.indexOf(
				formatFor(cell, rowNumber, columnIndex, grid.regions),
			);
			return cellXml(cell, `${colName(columnIndex)}${rowNumber}`, index);
		}).join("");

		if (cells === "") return;
		rows.push(`<row r="${rowNumber}">${cells}</row>`);
	});

	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

/**
 * Excel caps sheet names at 31 characters and forbids `: \ / ? * [ ]`. Google
 * Sheets is more forgiving, but a file that breaks the rule may not open at all
 * in Excel — and these names are referenced from formulas, so they have to be
 * stable.
 */
export function safeSheetName(name: string): string {
	return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet";
}

export function buildXlsx(sheets: SheetGrid[]): Uint8Array {
	const encoder = new TextEncoder();
	const utf8 = (value: string) => encoder.encode(value);

	// Render the sheets first: that is what discovers which format combinations
	// the workbook actually uses, and `cellXfs` has to list exactly those.
	const formats = new FormatTable();
	const rendered = sheets.map((sheet) => sheetXml(sheet, formats));

	const overrides = sheets
		.map(
			(_, index) =>
				`<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
		)
		.join("");

	const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

	const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

	const sheetEntries = sheets
		.map(
			(sheet, index) =>
				`<sheet name="${escapeXml(safeSheetName(sheet.name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
		)
		.join("");

	const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`;

	const sheetRels = sheets
		.map(
			(_, index) =>
				`<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
		)
		.join("");

	const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

	/**
	 * Gains and losses are coloured through a *number format*, not a font
	 * colour, and that distinction is the whole point: these cells are
	 * `GOOGLEFINANCE`-driven formulas whose sign changes with the market, so a
	 * colour fixed at export time would be a snapshot that quietly goes stale.
	 * A format's `positive;negative;zero` sections re-evaluate with the value.
	 *
	 * `[Color10]` rather than `[Green]`: the named colour is #00FF00, which is
	 * near-invisible on a white sheet. Colour 10 in the indexed palette is
	 * #008000, a dark green that reads properly — and the only way to choose a
	 * specific shade here, since number formats accept the eight named colours
	 * and the 56 indexed ones but no arbitrary hex.
	 *
	 * The percent variant deliberately says `General` rather than `0.0%`:
	 * `TO_PERCENT` already carries the percentage formatting, and stacking an
	 * explicit percent format on top risks rendering 8.34% as 834%.
	 *
	 * Custom format ids have to start at 164 — everything below is reserved.
	 */
	const numberFormats = [
		'<numFmt numFmtId="164" formatCode="[Color10]#,##0.00;[Red]-#,##0.00;#,##0.00"/>',
		'<numFmt numFmtId="165" formatCode="[Color10]General;[Red]General;General"/>',
	].join("");

	// Font 0 plain, font 1 bold — headers and totals.
	const fonts =
		'<fonts count="2">' +
		'<font><sz val="11"/><name val="Calibri"/></font>' +
		'<font><b/><sz val="11"/><name val="Calibri"/></font>' +
		"</fonts>";

	// Fills 0 and 1 are reserved by the format and must be exactly these two;
	// fill 2 is the header tint.
	const fills =
		'<fills count="3">' +
		'<fill><patternFill patternType="none"/></fill>' +
		'<fill><patternFill patternType="gray125"/></fill>' +
		'<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill>' +
		"</fills>";

	const thin =
		'<left style="thin"><color rgb="FFBFBFBF"/></left>' +
		'<right style="thin"><color rgb="FFBFBFBF"/></right>' +
		'<top style="thin"><color rgb="FFBFBFBF"/></top>' +
		'<bottom style="thin"><color rgb="FFBFBFBF"/></bottom>';

	// Border 0 none, 1 a thin box, 2 the same box with a heavier rule on top so
	// a totals line reads as separated from the body above it.
	const borders =
		'<borders count="3">' +
		"<border/>" +
		`<border>${thin}</border>` +
		'<border><left style="thin"><color rgb="FFBFBFBF"/></left>' +
		'<right style="thin"><color rgb="FFBFBFBF"/></right>' +
		'<top style="medium"><color rgb="FF7F7F7F"/></top>' +
		'<bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border>' +
		"</borders>";

	const cellXfs = formats.formats
		.map((format) => {
			const numFmtId = format.numberFormat
				? NUMBER_FORMAT_ID[format.numberFormat]
				: 0;
			const fontId = format.header || format.total ? 1 : 0;
			const fillId = format.header ? 2 : 0;
			const borderId = format.bordered ? (format.total ? 2 : 1) : 0;
			const applies = [
				numFmtId ? 'applyNumberFormat="1"' : "",
				fontId ? 'applyFont="1"' : "",
				fillId ? 'applyFill="1"' : "",
				borderId ? 'applyBorder="1"' : "",
			]
				.filter(Boolean)
				.join(" ");
			return `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${applies ? ` ${applies}` : ""}/>`;
		})
		.join("");

	const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2">${numberFormats}</numFmts>${fonts}${fills}${borders}<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${formats.formats.length}">${cellXfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

	return zipStored([
		{ name: "[Content_Types].xml", data: utf8(contentTypes) },
		{ name: "_rels/.rels", data: utf8(rootRels) },
		{ name: "xl/workbook.xml", data: utf8(workbook) },
		{ name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels) },
		{ name: "xl/styles.xml", data: utf8(styles) },
		...rendered.map((xml, index) => ({
			name: `xl/worksheets/sheet${index + 1}.xml`,
			data: utf8(xml),
		})),
	]);
}
