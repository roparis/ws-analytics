"use client";

import { FileDown } from "lucide-react";
import type { RefObject } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportElementToPdf } from "@/lib/pdf";

interface PdfExportButtonProps {
	targetRef: RefObject<HTMLElement | null>;
	filename: string;
}

export function PdfExportButton({ targetRef, filename }: PdfExportButtonProps) {
	const [isExporting, setIsExporting] = useState(false);

	async function handleExport() {
		if (!targetRef.current) return;

		setIsExporting(true);
		try {
			await exportElementToPdf(targetRef.current, filename);
		} catch (error) {
			// The toast can only say that it failed. Rendering the DOM to a canvas
			// fails in ways that are specific enough to be worth keeping (a colour
			// the parser can't read, a tainted canvas), so the reason goes to the
			// console rather than being swallowed with the stack trace.
			console.error("PDF export failed", error);
			toast.error("Could not generate the PDF report.");
		} finally {
			setIsExporting(false);
		}
	}

	return (
		<Button disabled={isExporting} onClick={handleExport} variant="outline">
			<FileDown className="size-4" />
			{isExporting ? "Generating…" : "Export PDF"}
		</Button>
	);
}
