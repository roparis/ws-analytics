"use client";

import type { CoverageSegment } from "@/lib/merge";
import { cn } from "@/lib/utils";

// The theme's --chart-* ramp is monochrome, which is fine for a single measure
// but useless for telling sources apart, so identity gets its own hues.
const SOURCE_COLORS = [
	"bg-sky-500",
	"bg-violet-500",
	"bg-amber-500",
	"bg-emerald-500",
	"bg-rose-500",
	"bg-cyan-500",
];

export function sourceColor(index: number): string {
	return SOURCE_COLORS[index % SOURCE_COLORS.length];
}

function toTime(date: string): number {
	return Date.parse(`${date}T00:00:00`);
}

interface CoverageBarProps {
	/** Segments for a single account, tagged with the source that owns them. */
	segments: (CoverageSegment & { sourceIndex: number; fileName: string })[];
	range: { start: string; end: string };
}

export function CoverageBar({ segments, range }: CoverageBarProps) {
	const min = toTime(range.start);
	const max = toTime(range.end);
	const span = Math.max(max - min, 1);

	return (
		<div className="relative h-5 w-full overflow-hidden rounded-full bg-muted">
			{segments.map((segment) => {
				const left = ((toTime(segment.start) - min) / span) * 100;
				const width = Math.max(
					((toTime(segment.end) - toTime(segment.start)) / span) * 100,
					1.5,
				);
				return (
					<div
						className={cn(
							"absolute inset-y-0 rounded-full opacity-80",
							sourceColor(segment.sourceIndex),
						)}
						key={`${segment.fileName}-${segment.accountId}-${segment.start}`}
						style={{
							left: `${left}%`,
							width: `${Math.min(width, 100 - left)}%`,
						}}
						title={`${segment.fileName}: ${segment.start} – ${segment.end} (${segment.rows} rows)`}
					/>
				);
			})}
		</div>
	);
}
