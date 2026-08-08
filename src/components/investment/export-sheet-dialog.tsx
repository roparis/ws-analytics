"use client";

import {
	AlertTriangle,
	Check,
	Copy,
	FileDown,
	Info,
	Table2,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	copyText,
	downloadBlob,
	formatBytes,
	safeFileName,
	todayStamp,
} from "@/lib/clipboard";
import {
	buildWorkbook,
	GOOGLE_SHEETS_NEW_URL,
	gridToTsv,
	SHEET_NAMES,
	summarizeWorkbook,
} from "@/lib/google-sheet";
import type { PositionsReport } from "@/lib/positions";
import type { Activity } from "@/lib/wealthsimple";
import { buildXlsx } from "@/lib/xlsx";

/**
 * Per-tab caveats worth surfacing before someone copies that tab on its own.
 * Only tabs with something genuinely surprising about them appear here — a note
 * on every row would be noise, and the ones that are self-contained need none.
 */
const SHEET_NOTES: Record<string, string> = {
	[SHEET_NAMES.summary]: `Every figure on ${SHEET_NAMES.summary} is a reference to another tab, so on its own it shows #REF! errors. Paste it last, once ${SHEET_NAMES.holdings}, ${SHEET_NAMES.cash}, ${SHEET_NAMES.closed} and ${SHEET_NAMES.income} exist and are named exactly that. The .xlsx download avoids this entirely.`,
	[SHEET_NAMES.holdings]:
		"The only tab that fetches prices from Google. Every other tab's market value reads from here, so paste this one first.",
	[SHEET_NAMES.accountTypes]: `Reads book cost and market value from ${SHEET_NAMES.holdings}, so it needs that tab in place first.`,
	[SHEET_NAMES.years]:
		"Self-contained cash-flow history — no prices are involved, so it works on its own.",
	[SHEET_NAMES.transactions]:
		"Quantity is shares on trades and dollars on everything else, so never sum that column across activity types.",
};

interface ExportSheetDialogProps {
	report: PositionsReport;
	activities: Activity[];
	fileName: string;
	dataThrough: string;
	variant?: "default" | "outline";
}

export function ExportSheetDialog({
	report,
	activities,
	fileName,
	dataThrough,
	variant = "outline",
}: ExportSheetDialogProps) {
	const [open, setOpen] = useState(false);
	const [includeLog, setIncludeLog] = useState(true);
	const [copiedSheet, setCopiedSheet] = useState<string | null>(null);
	// Lazily evaluated so the date is read once on mount rather than every render.
	const [exportName, setExportName] = useState(() => todayStamp());
	const logCheckboxId = useId();
	const nameInputId = useId();

	// Built when the dialog opens, never in a click handler: `writeText` spends
	// the click's user activation, so anything slow in front of it risks the
	// browser treating the write as untrusted. Gated on `open` so a page view
	// that never exports doesn't pay for a few MB of string building, and
	// memoised so the dialog can quote real sizes before the user commits.
	const workbook = useMemo(() => {
		if (!open) return null;

		const sheets = buildWorkbook(report, {
			activities,
			dataThrough,
			fileName,
			generatedOn: new Date().toISOString().slice(0, 10),
			includeTransactionLog: includeLog,
		});
		const tsvBySheet = new Map(
			sheets.map((sheet) => [sheet.name, gridToTsv(sheet)]),
		);
		const xlsx = buildXlsx(sheets);

		return {
			sheets,
			tsvBySheet,
			xlsx,
			summary: summarizeWorkbook(report, sheets, activities, xlsx.length),
		};
	}, [open, report, activities, fileName, dataThrough, includeLog]);

	// An empty or fully-stripped field falls back to the default rather than
	// producing a file called ".xlsx".
	const downloadName = `${safeFileName(exportName) || todayStamp()}.xlsx`;

	function handleDownloadXlsx() {
		if (!workbook) return;
		try {
			downloadBlob(
				[workbook.xlsx as BlobPart],
				downloadName,
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			);
		} catch {
			toast.error("Could not build the spreadsheet file.");
		}
	}

	function copySheet(name: string) {
		const tsv = workbook?.tsvBySheet.get(name);
		if (!tsv) return;
		copyText(tsv)
			.then(() => setCopiedSheet(name))
			.catch(() => {
				toast.error("Couldn't copy to your clipboard.", {
					action: { label: "Download instead", onClick: handleDownloadXlsx },
				});
			});
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setCopiedSheet(null);
			}}
			open={open}
		>
			<DialogTrigger
				render={
					<Button variant={variant}>
						<Table2 className="size-4" />
						Export to Google Sheets
					</Button>
				}
			/>

			{/* Eight tab rows plus the stats and caveats run past the fold on a
			laptop, and the dialog is centred by translation — without a cap it
			overflows off both edges and the buttons become unreachable. */}
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Export to Google Sheets</DialogTitle>
					<DialogDescription>
						Your export has no prices in it, so the sheet fetches them from
						Google Finance instead. Market value, unrealised gain and allocation
						are calculated live in the sheet.
					</DialogDescription>
				</DialogHeader>

				{workbook && (
					<>
						<div className="flex flex-col gap-4 text-sm">
							<dl className="grid grid-cols-2 gap-x-6 gap-y-2">
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Open holdings</dt>
									<dd className="tabular-nums">{workbook.summary.openCount}</dd>
								</div>
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Closed positions</dt>
									<dd className="tabular-nums">
										{workbook.summary.closedCount}
									</dd>
								</div>
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Tabs</dt>
									<dd className="tabular-nums">
										{workbook.summary.sheetCount}
									</dd>
								</div>
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Rows</dt>
									<dd className="tabular-nums">
										{workbook.summary.rowCount.toLocaleString()}
									</dd>
								</div>
							</dl>

							<label
								className="flex items-start gap-2.5 text-sm"
								htmlFor={logCheckboxId}
							>
								<input
									checked={includeLog}
									className="mt-0.5 size-4 accent-primary"
									id={logCheckboxId}
									onChange={(event) => setIncludeLog(event.target.checked)}
									type="checkbox"
								/>
								<span>
									Include the full transaction log
									<span className="block text-muted-foreground text-xs">
										All {workbook.summary.transactionCount.toLocaleString()}{" "}
										rows on their own tab, so every figure can be rebuilt in the
										sheet.
									</span>
								</span>
							</label>

							<div className="flex flex-col gap-2">
								<p className="text-muted-foreground text-xs">
									The <strong className="text-foreground">.xlsx</strong>{" "}
									download carries all {workbook.summary.sheetCount} tabs at
									once — drop it into Drive and open it with Sheets. It opens on{" "}
									{SHEET_NAMES.summary}, which totals the others live. To paste
									instead, copy one tab at a time and name each to match —{" "}
									{SHEET_NAMES.summary} reaches the other tabs by name.
								</p>

								<ul className="flex flex-col divide-y rounded-lg border">
									{workbook.sheets.map((sheet) => (
										<li
											className="flex items-center gap-3 px-3 py-1.5"
											key={sheet.name}
										>
											<span className="font-medium">{sheet.name}</span>
											{SHEET_NOTES[sheet.name] && (
												<Tooltip>
													<TooltipTrigger
														aria-label={`About the ${sheet.name} tab`}
														className="text-muted-foreground hover:text-foreground"
													>
														<Info className="size-3.5" />
													</TooltipTrigger>
													<TooltipContent className="max-w-xs">
														{SHEET_NOTES[sheet.name]}
													</TooltipContent>
												</Tooltip>
											)}
											<span className="text-muted-foreground text-xs tabular-nums">
												{sheet.rowCount.toLocaleString()} rows
											</span>
											<Button
												className="ml-auto"
												onClick={() => copySheet(sheet.name)}
												size="xs"
												variant="ghost"
											>
												{copiedSheet === sheet.name ? (
													<Check className="size-3" />
												) : (
													<Copy className="size-3" />
												)}
												{copiedSheet === sheet.name ? "Copied" : "Copy"}
											</Button>
										</li>
									))}
								</ul>
							</div>

							{workbook.summary.suspectAccounts.length > 0 && (
								<div className="flex gap-2.5 rounded-lg bg-amber-500/10 p-3">
									<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
									<div className="flex flex-col gap-1">
										<span className="font-medium">
											{workbook.summary.suspectAccounts.length === 1
												? "One account's book cost is unreliable"
												: `${workbook.summary.suspectAccounts.length} accounts' book costs are unreliable`}
										</span>
										<span className="text-muted-foreground text-xs">
											{workbook.summary.suspectAccounts
												.map((account) => account.accountId)
												.join(", ")}{" "}
											— buys are missing from the loaded files, so the
											unrealised gain in the sheet will be overstated for them.
										</span>
									</div>
								</div>
							)}

							{copiedSheet && (
								<p className="text-emerald-700 text-xs dark:text-emerald-400">
									{copiedSheet} is on your clipboard. In Google Sheets, add a
									tab named “{copiedSheet}”, click A1 and press ⌘V.
								</p>
							)}

							<div className="flex flex-col gap-1.5">
								<label className="font-medium text-sm" htmlFor={nameInputId}>
									File name
								</label>
								<div className="flex items-center gap-2">
									<Input
										id={nameInputId}
										onChange={(event) => setExportName(event.target.value)}
										placeholder={todayStamp()}
										value={exportName}
									/>
									<span className="text-muted-foreground text-sm">.xlsx</span>
								</div>
								<span className="text-muted-foreground text-xs">
									Downloads as {downloadName}
								</span>
							</div>
						</div>

						<DialogFooter>
							<Button
								nativeButton={false}
								render={
									<a
										href={GOOGLE_SHEETS_NEW_URL}
										onClick={() => copySheet(SHEET_NAMES.holdings)}
										rel="noopener noreferrer"
										target="_blank"
									>
										<Table2 className="size-4" />
										Copy {SHEET_NAMES.holdings} &amp; open Sheets
									</a>
								}
								variant="ghost"
							/>
							<Button onClick={handleDownloadXlsx}>
								<FileDown className="size-4" />
								Download .xlsx ({formatBytes(workbook.summary.byteLength)})
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
