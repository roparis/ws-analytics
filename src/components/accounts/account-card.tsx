"use client";

import Link from "next/link";
import { HeadlineFigures } from "@/components/headline-figures";
import { Card, CardContent } from "@/components/ui/card";
import { type AccountGroup, formatCurrency, formatDate } from "@/lib/metrics";

interface AccountCardProps {
	group: AccountGroup;
	currency: string;
}

export function AccountCard({ group, currency }: AccountCardProps) {
	const { kpis } = group;

	return (
		<Card className="transition-colors hover:bg-muted/40" size="sm">
			<CardContent className="flex flex-col gap-4">
				<Link
					className="flex flex-col gap-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
					href={`/accounts/${encodeURIComponent(group.accountType)}/${encodeURIComponent(group.id)}`}
				>
					<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
						<h2 className="font-heading font-semibold text-lg">{group.id}</h2>
						<span className="text-muted-foreground text-xs">
							{kpis.count.toLocaleString()}{" "}
							{kpis.count === 1 ? "activity" : "activities"}
						</span>
					</div>

					<HeadlineFigures
						accountType={group.accountType}
						currency={currency}
						kpis={kpis}
					/>

					<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span className="text-muted-foreground text-xs">
							{formatDate(kpis.dateRange.start)} –{" "}
							{formatDate(kpis.dateRange.end)}
						</span>
						<span className="ml-auto text-muted-foreground text-xs tabular-nums">
							Net {formatCurrency(kpis.netCashFlow, currency)}
						</span>
					</div>
				</Link>
			</CardContent>
		</Card>
	);
}
