"use client";

import { AlertTriangle, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
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
import { SHEET_NAMES } from "@/lib/google-sheet";
import { formatCurrency, formatDate } from "@/lib/metrics";
import type { PositionsReport } from "@/lib/positions";
import {
	parsePriceCsv,
	STALE_AFTER_DAYS,
	snapshotAgeDays,
	valueWith,
} from "@/lib/price-snapshot";
import { cn } from "@/lib/utils";
import { usePriceStore } from "@/stores/prices";

/**
 * The other half of the export.
 *
 * `ExportSheetDialog` sends a workbook out whose prices are `GOOGLEFINANCE`
 * formulas; this brings the resolved numbers back. That round trip is the only
 * way this app can show a market value at all — the activities export has no
 * prices in it, and nothing here talks to a server.
 *
 * A CSV of one tab rather than the `.xlsx`: Sheets downloads the open tab with
 * its formulas already evaluated, and reading a compressed workbook back would
 * be several hundred lines for the same numbers.
 */

interface ImportPricesDialogProps {
	report: PositionsReport;
	currency: string;
	variant?: "default" | "outline";
}

export function ImportPricesDialog({
	currency,
	report,
	variant = "outline",
}: ImportPricesDialogProps) {
	const snapshot = usePriceStore((state) => state.snapshot);
	const setSnapshot = usePriceStore((state) => state.setSnapshot);
	const clear = usePriceStore((state) => state.clear);
	const persistFailed = usePriceStore((state) => state.persistFailed);

	const [open, setOpen] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const valued = valueWith(report, snapshot);
	const age = snapshot ? snapshotAgeDays(snapshot) : 0;
	const stale = age > STALE_AFTER_DAYS;

	async function handleFile(file: File | undefined) {
		if (!file) return;
		if (!file.name.toLowerCase().endsWith(".csv")) {
			toast.error("Please choose the .csv you downloaded from Sheets.");
			return;
		}

		try {
			const next = parsePriceCsv(await file.text(), file.name);
			setSnapshot(next);
			toast.success(
				`Priced ${next.matched.length} ${next.matched.length === 1 ? "holding" : "holdings"}.`,
			);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : `Could not read ${file.name}.`,
			);
		}
	}

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger
				render={
					<Button variant={variant}>
						<RefreshCw className="size-4" />
						{snapshot ? "Update prices" : "Import prices"}
					</Button>
				}
			/>

			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Import prices</DialogTitle>
					<DialogDescription>
						Your export has no prices in it. Export the workbook, let Google
						Finance fill them in, then bring that tab back here — the app works
						out what your holdings are worth from your own share counts.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4 text-sm">
					<ol className="flex list-decimal flex-col gap-1.5 pl-5 text-muted-foreground">
						<li>Export to Google Sheets and open the file in Sheets.</li>
						<li>
							Open the{" "}
							<strong className="text-foreground">
								{SHEET_NAMES.holdings}
							</strong>{" "}
							tab and wait for the prices to fill in.
						</li>
						<li>
							<strong className="text-foreground">
								File ▸ Download ▸ Comma-separated values (.csv)
							</strong>{" "}
							— that downloads the tab you're on.
						</li>
						<li>Drop that file below.</li>
					</ol>

					{/* biome-ignore lint/a11y/noStaticElementInteractions: the button
					inside is the accessible control; the drop zone is a shortcut. */}
					<div
						className={cn(
							"flex flex-col items-center gap-3 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors",
							isDragging ? "border-foreground bg-muted" : "border-border",
						)}
						onDragLeave={() => setIsDragging(false)}
						onDragOver={(event) => {
							event.preventDefault();
							setIsDragging(true);
						}}
						onDrop={(event) => {
							event.preventDefault();
							setIsDragging(false);
							void handleFile(event.dataTransfer.files[0]);
						}}
					>
						<UploadCloud className="size-6 text-muted-foreground" />
						<span className="text-muted-foreground">
							Drop the {SHEET_NAMES.holdings} tab here
						</span>
						<input
							accept=".csv,text/csv"
							className="hidden"
							onChange={(event) => {
								void handleFile(event.target.files?.[0]);
								event.target.value = "";
							}}
							ref={inputRef}
							type="file"
						/>
						<Button onClick={() => inputRef.current?.click()} variant="outline">
							Choose a CSV
						</Button>
					</div>

					{snapshot && valued && (
						<div className="flex flex-col gap-2 rounded-lg border p-3">
							<div className="flex items-baseline justify-between gap-3">
								<span className="font-medium">
									{valued.pricedCount} of {valued.holdingCount} holdings priced
								</span>
								<span className="text-muted-foreground text-xs">
									{formatDate(snapshot.asOf)}
									{age > 0 && ` · ${age} ${age === 1 ? "day" : "days"} old`}
								</span>
							</div>
							<div className="flex items-baseline justify-between gap-3">
								<span className="text-muted-foreground">Market value</span>
								<span className="font-medium tabular-nums">
									{formatCurrency(
										valued.byAccountType.reduce(
											(total, row) => total + row.marketValue,
											0,
										),
										currency,
									)}
								</span>
							</div>

							{valued.missingSymbols.length > 0 && (
								<p className="text-muted-foreground text-xs">
									No price for {valued.missingSymbols.join(", ")} —{" "}
									{valued.missingSymbols.length === 1
										? "it is counted at what you paid. Fix that row's Google ticker"
										: "they are counted at what you paid. Fix those rows' Google tickers"}{" "}
									in the sheet and re-download.
								</p>
							)}

							{stale && (
								<div className="flex gap-2.5 rounded-lg bg-amber-500/10 p-3">
									<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
									<span className="text-xs">
										These prices are {age} days old. Markets have moved — export
										again for a current figure.
									</span>
								</div>
							)}

							{persistFailed && (
								<div className="flex gap-2.5 rounded-lg bg-amber-500/10 p-3">
									<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
									<span className="text-xs">
										These prices couldn't be saved to this browser, so they'll
										be gone when you reload. Everything on the page is correct
										until then.
									</span>
								</div>
							)}
						</div>
					)}
				</div>

				<DialogFooter>
					{snapshot && (
						<Button
							onClick={() => {
								clear();
								toast.success("Prices removed. Figures are back to book cost.");
							}}
							variant="ghost"
						>
							<Trash2 className="size-4" />
							Remove prices
						</Button>
					)}
					<Button onClick={() => setOpen(false)}>Done</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
