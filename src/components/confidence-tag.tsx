"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { Confidence } from "@/lib/merge";
import { cn } from "@/lib/utils";

const STYLES: Record<
	Confidence,
	{ label: string; className: string; Icon: typeof CheckCircle2 }
> = {
	high: {
		label: "High",
		className:
			"bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-400 dark:ring-emerald-400/25",
		Icon: CheckCircle2,
	},
	medium: {
		label: "Medium",
		className:
			"bg-amber-500/10 text-amber-700 ring-amber-600/20 dark:text-amber-400 dark:ring-amber-400/25",
		Icon: Info,
	},
	low: {
		label: "Conflict",
		className: "bg-destructive/10 text-destructive ring-destructive/20",
		Icon: AlertTriangle,
	},
};

interface ConfidenceTagProps {
	confidence: Confidence;
	title?: string;
}

export function ConfidenceTag({ confidence, title }: ConfidenceTagProps) {
	const { label, className, Icon } = STYLES[confidence];

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-xs ring-1 ring-inset",
				className,
			)}
			title={title}
		>
			<Icon className="size-3" />
			{label}
		</span>
	);
}
