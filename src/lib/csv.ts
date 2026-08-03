import Papa from "papaparse";

export type ColumnType = "number" | "date" | "string";

export interface ParsedColumn {
	name: string;
	type: ColumnType;
}

export interface ParsedDataset {
	fileName: string;
	columns: ParsedColumn[];
	rows: Record<string, string>[];
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;

function inferColumnType(values: string[]): ColumnType {
	const nonEmpty = values.map((value) => value.trim()).filter(Boolean);
	if (nonEmpty.length === 0) return "string";

	if (nonEmpty.every((value) => value !== "" && !Number.isNaN(Number(value)))) {
		return "number";
	}

	if (
		nonEmpty.every(
			(value) => DATE_REGEX.test(value) && !Number.isNaN(Date.parse(value)),
		)
	) {
		return "date";
	}

	return "string";
}

export function parseCsvFile(file: File): Promise<ParsedDataset> {
	return new Promise((resolve, reject) => {
		Papa.parse<Record<string, string>>(file, {
			header: true,
			skipEmptyLines: true,
			complete: (results) => {
				const fields = results.meta.fields ?? [];
				if (fields.length === 0) {
					reject(new Error("The CSV file has no columns."));
					return;
				}

				const rows = results.data;
				const columns: ParsedColumn[] = fields.map((name) => ({
					name,
					type: inferColumnType(rows.map((row) => row[name] ?? "")),
				}));

				resolve({ fileName: file.name, columns, rows });
			},
			error: (error: Error) => reject(error),
		});
	});
}
