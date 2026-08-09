"use client";

import { UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { SourceFile } from "@/lib/merge";
import { cn } from "@/lib/utils";
import { parseActivitiesCsv } from "@/lib/wealthsimple";
import { useDatasetStore } from "@/stores/dataset";

interface CsvUploaderProps {
	/** Compact variant for adding more files once a dashboard is on screen. */
	compact?: boolean;
	/** Applied to the compact button, so a caller can stretch it to fit. */
	className?: string;
}

export function CsvUploader({ compact = false, className }: CsvUploaderProps) {
	const addSources = useDatasetStore((state) => state.addSources);
	const router = useRouter();
	const [isDragging, setIsDragging] = useState(false);
	const [progress, setProgress] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleFiles = useCallback(
		async (fileList: FileList | File[]) => {
			const files = [...fileList].filter((file) =>
				file.name.toLowerCase().endsWith(".csv"),
			);

			if (files.length === 0) {
				toast.error("Please choose .csv files.");
				return;
			}

			setProgress(
				files.length === 1 ? "Parsing…" : `Parsing 0/${files.length}…`,
			);

			const parsed: SourceFile[] = [];
			let done = 0;

			// Sequential so the progress count is meaningful and a bad file names itself.
			for (const file of files) {
				try {
					parsed.push(await parseActivitiesCsv(file));
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: `Could not parse ${file.name}.`,
					);
				}
				done++;
				if (files.length > 1) setProgress(`Parsing ${done}/${files.length}…`);
			}

			if (parsed.length > 0) {
				addSources(parsed);
				// Report what survived the merge, not what was parsed — overlapping
				// exports contribute far fewer rows than they contain.
				const dataset = useDatasetStore.getState().dataset;
				const merged = dataset?.activities.length ?? 0;
				const skipped =
					dataset?.sources.reduce(
						(total, source) => total + source.rowsSkipped,
						0,
					) ?? 0;

				toast.success(
					`Loaded ${merged.toLocaleString()} activities from ${parsed.length} file${parsed.length === 1 ? "" : "s"}.`,
					skipped > 0
						? {
								description: `${skipped.toLocaleString()} rows were already covered by another file and skipped.`,
								action: {
									label: "Review merge",
									onClick: () => router.push("/merge"),
								},
								duration: 10000,
							}
						: undefined,
				);
			}

			setProgress(null);
		},
		[addSources, router],
	);

	const input = (
		<input
			accept=".csv,text/csv"
			className="hidden"
			multiple
			onChange={(event) => {
				const files = event.target.files;
				if (files?.length) void handleFiles(files);
				event.target.value = "";
			}}
			ref={inputRef}
			type="file"
		/>
	);

	if (compact) {
		return (
			<>
				<Button
					className={className}
					disabled={progress !== null}
					onClick={() => inputRef.current?.click()}
					size="sm"
					variant="outline"
				>
					<UploadCloud className="size-4" />
					{progress ?? "Add files"}
				</Button>
				{input}
			</>
		);
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop zone; file selection is also reachable via the button below
		<div
			className={cn(
				"flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-16 text-center transition-colors",
				isDragging ? "border-primary bg-accent" : "border-border",
			)}
			onDragLeave={() => setIsDragging(false)}
			onDragOver={(event) => {
				event.preventDefault();
				setIsDragging(true);
			}}
			onDrop={(event) => {
				event.preventDefault();
				setIsDragging(false);
				if (event.dataTransfer.files.length) {
					void handleFiles(event.dataTransfer.files);
				}
			}}
		>
			<UploadCloud className="size-10 text-muted-foreground" />
			<div className="space-y-1">
				<p className="font-medium">
					Drop your Wealthsimple activities exports here
				</p>
				<p className="text-muted-foreground text-sm">
					one or more files — nothing is uploaded anywhere
				</p>
				<p className="max-w-md text-muted-foreground text-xs">
					Your activity stays on this device and is saved in this browser so
					it&apos;s still here next visit. Use <strong>Clear data</strong> to
					remove it — worth doing on a shared computer.
				</p>
			</div>
			<Button
				disabled={progress !== null}
				onClick={() => inputRef.current?.click()}
			>
				{progress ?? "Choose CSV files"}
			</Button>
			{input}
		</div>
	);
}
