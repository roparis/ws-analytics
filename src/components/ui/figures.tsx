"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect } from "react";
import { formatCurrency } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/stores/preferences";

/**
 * The shared vocabulary for showing money: one big figure, one small coloured
 * verdict, one allocation glyph. Every page uses these so a number means the
 * same thing wherever it appears.
 */

/** Blurs currency figures on demand, so the app can be read in public. */
export function Amount({
	className,
	currency = "CAD",
	value,
}: {
	className?: string;
	currency?: string;
	value: number;
}) {
	const hidden = usePreferencesStore((state) => state.amountsHidden);

	return (
		<span
			className={cn(
				"tabular-nums",
				// Blurred rather than replaced with dots: the shape and width of the
				// figure stay put, so nothing reflows when it is toggled back.
				hidden && "select-none blur-sm",
				className,
			)}
		>
			{formatCurrency(value, currency)}
		</span>
	);
}

/** Mounted once at the root so the stored preference is read a single time. */
export function PreferencesHydrator() {
	const hydrate = usePreferencesStore((state) => state.hydrate);
	useEffect(() => {
		hydrate();
	}, [hydrate]);
	return null;
}

interface HeadlineValueProps {
	label: string;
	value: number;
	currency?: string;
	/** A sentence under the figure saying exactly what it counts. */
	caption?: string;
	className?: string;
}

/**
 * The one figure a page leads with. Carries its own show/hide control, because
 * the whole point of hiding is that the biggest number on screen is covered.
 */
export function HeadlineValue({
	label,
	value,
	currency = "CAD",
	caption,
	className,
}: HeadlineValueProps) {
	const hidden = usePreferencesStore((state) => state.amountsHidden);
	const toggle = usePreferencesStore((state) => state.toggleAmounts);

	return (
		<div className={cn("flex flex-col gap-1", className)}>
			<span className="text-muted-foreground text-sm">{label}</span>
			<div className="flex items-center gap-3">
				<Amount
					className="font-semibold text-4xl tracking-tight"
					currency={currency}
					value={value}
				/>
				<button
					aria-label={hidden ? "Show amounts" : "Hide amounts"}
					className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onClick={toggle}
					type="button"
				>
					{hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
				</button>
			</div>
			{caption && (
				<p className="max-w-prose text-muted-foreground text-sm">{caption}</p>
			)}
		</div>
	);
}

/**
 * A gain or loss as a tinted pill.
 *
 * Only ever rendered where the figure is real. Nothing here estimates a return
 * from a price the export doesn't contain — an open holding has no return to
 * show, and leaving the pill off is the honest answer.
 */
export function ReturnPill({
	value,
	className,
	label,
}: {
	/** A ratio, not a percentage: 0.1234 renders as 12.34%. */
	value: number;
	className?: string;
	label?: string;
}) {
	const positive = value >= 0;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs tabular-nums",
				positive
					? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
					: "bg-destructive/10 text-destructive",
				className,
			)}
			title={label}
		>
			{positive ? "+" : "−"}
			{Math.abs(value * 100).toFixed(2)}%
		</span>
	);
}

/**
 * A single-slice donut showing what share of the whole a row accounts for.
 *
 * Drawn with a stroke-dasharray on one circle rather than as a pie of many
 * wedges: each row only needs to answer "how much of the total is this", and a
 * glyph that reads at 14px can't carry more than one quantity anyway.
 */
export function AllocationDonut({
	share,
	className,
}: {
	/** A ratio in 0..1. */
	share: number;
	className?: string;
}) {
	const clamped = Math.max(0, Math.min(1, share));
	// r chosen so the circumference is almost exactly 100, which lets the
	// dasharray be read directly as a percentage.
	const radius = 15.915;
	return (
		<svg
			aria-hidden="true"
			className={cn("size-3.5 shrink-0 -rotate-90", className)}
			viewBox="0 0 36 36"
		>
			<circle
				className="stroke-muted-foreground/25"
				cx="18"
				cy="18"
				fill="none"
				r={radius}
				strokeWidth="6"
			/>
			<circle
				className="stroke-foreground"
				cx="18"
				cy="18"
				fill="none"
				r={radius}
				strokeDasharray={`${clamped * 100} 100`}
				strokeWidth="6"
			/>
		</svg>
	);
}
