"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { flowBreakdown, formatCurrency } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { Activity } from "@/lib/wealthsimple";

interface MoneyFlowProps {
	activities: Activity[];
	currency: string;
}

function amountTone(value: number): string {
	if (value > 0) return "text-emerald-600 dark:text-emerald-400";
	if (value < 0) return "text-destructive";
	return "text-muted-foreground";
}

export function MoneyFlow({ activities, currency }: MoneyFlowProps) {
	const { sections, net } = flowBreakdown(activities);

	if (sections.length === 0) return null;

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle>Where the money came from and went</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-5">
				{sections.map((section) => (
					<div className="flex flex-col gap-1.5" key={section.key}>
						<div className="flex items-baseline justify-between gap-3 border-b pb-1">
							<span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
								{section.title}
							</span>
							<span
								className={cn(
									"font-semibold text-sm tabular-nums",
									amountTone(section.total),
								)}
							>
								{formatCurrency(section.total, currency)}
							</span>
						</div>
						{section.lines.map((line) => (
							<div
								className="flex items-baseline justify-between gap-3 pl-1"
								key={line.key}
							>
								<span className="flex min-w-0 items-baseline gap-2">
									<span className="truncate text-sm">{line.label}</span>
									<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
										{line.count}×
									</span>
								</span>
								<span
									className={cn(
										"shrink-0 text-sm tabular-nums",
										amountTone(line.value),
									)}
								>
									{formatCurrency(line.value, currency)}
								</span>
							</div>
						))}
					</div>
				))}

				<div className="flex items-baseline justify-between gap-3 border-t pt-2">
					<span className="font-semibold text-sm">Net change in cash</span>
					<span
						className={cn(
							"font-semibold text-sm tabular-nums",
							amountTone(net),
						)}
					>
						{formatCurrency(net, currency)}
					</span>
				</div>
			</CardContent>
		</Card>
	);
}
