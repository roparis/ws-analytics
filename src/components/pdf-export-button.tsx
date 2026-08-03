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
		} catch {
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
