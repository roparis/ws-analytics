"use client";

import { cn } from "@/lib/utils";

/**
 * The time-range selector, and the segmented toggle it sits opposite.
 *
 * Both are plain buttons in a track rather than a `Select`: with six or fewer
 * options the whole choice fits on screen, and seeing the alternatives is most
 * of the value.
 */

export interface RangeOption<T extends string> {
	value: T;
	label: string;
}

interface SegmentedProps<T extends string> {
	options: readonly RangeOption<T>[];
	value: T;
	onChange: (value: T) => void;
	"aria-label": string;
	className?: string;
	/** A filled track, for the smaller value/returns style toggle. */
	inset?: boolean;
}

export function Segmented<T extends string>({
	options,
	value,
	onChange,
	className,
	inset = false,
	...props
}: SegmentedProps<T>) {
	return (
		<div
			aria-label={props["aria-label"]}
			className={cn(
				"flex items-center gap-0.5",
				inset && "rounded-full bg-muted p-0.5",
				className,
			)}
			role="tablist"
		>
			{options.map((option) => {
				const active = option.value === value;
				return (
					<button
						aria-selected={active}
						className={cn(
							"rounded-full px-3 py-1.5 font-medium text-sm transition-colors",
							active
								? "bg-foreground text-background"
								: "text-muted-foreground hover:bg-muted hover:text-foreground",
							// Inside a filled track the active pill lifts to the card
							// colour instead, or it would read as a hole punched in the row.
							inset &&
								active &&
								"bg-card text-foreground shadow-sm ring-1 ring-foreground/5",
						)}
						key={option.value}
						onClick={() => onChange(option.value)}
						role="tab"
						type="button"
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
