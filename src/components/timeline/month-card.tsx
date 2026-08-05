"use client";

import Link from "next/link";
import { HeadlineFigures } from "@/components/headline-figures";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, type MonthGroup } from "@/lib/metrics";

export const RETURN_ANCHOR_KEY = "ws-analytics:timeline-anchor";

export function monthAnchorId(key: string): string {
	return `month-${key}`;
}

interface MonthCardProps {
	group: MonthGroup;
	currency: string;
}

export function MonthCard({ group, currency }: MonthCardProps) {
	const { kpis } = group;

	return (
		<Card
			className="transition-colors hover:bg-muted/40"
			id={monthAnchorId(group.key)}
			size="sm"
		>
			<CardContent className="flex flex-col gap-4">
				<Link
					className="flex flex-col gap-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
					href={`/month/${group.key}`}
					onClick={() => {
						// Read back by the feed to re-anchor this card after returning.
						sessionStorage.setItem(RETURN_ANCHOR_KEY, group.key);
					}}
				>
					<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
						<h2 className="font-heading font-semibold text-lg">
							{group.label}
						</h2>
						<span className="text-muted-foreground text-xs">
							{kpis.count.toLocaleString()}{" "}
							{kpis.count === 1 ? "activity" : "activities"}
						</span>
					</div>

					<HeadlineFigures currency={currency} kpis={kpis} />

					<div className="flex flex-wrap items-center gap-1.5">
						{group.accountTypes.map((accountType) => (
							<Badge key={accountType} variant="outline">
								{accountType}
							</Badge>
						))}
						<span className="ml-auto text-muted-foreground text-xs tabular-nums">
							Net {formatCurrency(kpis.netCashFlow, currency)}
						</span>
					</div>
				</Link>
			</CardContent>
		</Card>
	);
}
