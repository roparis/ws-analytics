"use client";

import { UploadCloud } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { parseCsvFile } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { useDatasetStore } from "@/stores/dataset";

export function CsvUploader() {
	const setDataset = useDatasetStore((state) => state.setDataset);
	const [isDragging, setIsDragging] = useState(false);
	const [isParsing, setIsParsing] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleFile = useCallback(
		async (file: File) => {
			if (!file.name.toLowerCase().endsWith(".csv")) {
				toast.error("Please choose a .csv file.");
				return;
			}

			setIsParsing(true);
			try {
				const dataset = await parseCsvFile(file);
				setDataset(dataset);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: "Could not parse that CSV file.",
				);
			} finally {
				setIsParsing(false);
			}
		},
		[setDataset],
	);

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
				const file = event.dataTransfer.files[0];
				if (file) void handleFile(file);
			}}
		>
			<UploadCloud className="size-10 text-muted-foreground" />
			<div className="space-y-1">
				<p className="font-medium">Drop a CSV file here</p>
				<p className="text-muted-foreground text-sm">
					or click below to browse — everything stays in your browser, nothing
					is uploaded anywhere
				</p>
			</div>
			<Button disabled={isParsing} onClick={() => inputRef.current?.click()}>
				{isParsing ? "Parsing…" : "Choose CSV file"}
			</Button>
			<input
				accept=".csv,text/csv"
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void handleFile(file);
					event.target.value = "";
				}}
				ref={inputRef}
				type="file"
			/>
		</div>
	);
}
