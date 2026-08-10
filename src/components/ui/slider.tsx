"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "@/lib/utils";

/**
 * A single-value slider, assembled from Base UI's parts.
 *
 * Range sliders are deliberately not supported: nothing in this app compares
 * two ends of a band, and a `number | number[]` value would push that ambiguity
 * into every caller for no gain.
 */

function Slider({
	className,
	value,
	onValueChange,
	...props
}: Omit<SliderPrimitive.Root.Props<number>, "onValueChange" | "value"> & {
	value: number;
	onValueChange: (value: number) => void;
}) {
	return (
		<SliderPrimitive.Root
			className={cn("w-full", className)}
			data-slot="slider"
			onValueChange={(next) => onValueChange(next)}
			value={value}
			{...props}
		>
			<SliderPrimitive.Control className="flex w-full touch-none select-none items-center py-2">
				<SliderPrimitive.Track className="h-1.5 w-full rounded-full bg-muted">
					<SliderPrimitive.Indicator className="rounded-full bg-foreground" />
					<SliderPrimitive.Thumb className="size-4 rounded-full bg-foreground outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/40 data-dragging:ring-3 data-dragging:ring-foreground/15" />
				</SliderPrimitive.Track>
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	);
}

export { Slider };
