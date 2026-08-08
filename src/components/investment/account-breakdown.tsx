"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/metrics";
import type { AccountRollup } from "@/lib/positions";

interface AccountBreakdownProps {
	accounts: AccountRollup[];
	currency: string;
}

/**
 * One card per real account. Grouping by account type would merge the three
 * TFSAs, but cost is pooled per account and each one has its own history — so
 * this is the grain the figures are actually computed at. The type roll-up
 * sits below, labelled as a roll-up.
 */
export function AccountBreakdown({
	accounts,
	currency,
}: AccountBreakdownProps) {
	if (accounts.length === 0) return null;

	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<h2 className="font-heading font-medium text-base">By account</h2>
				<p className="text-muted-foreground text-sm">
					Each account holds its own cost pool, so the same security bought in
					two accounts has two separate book costs.
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				{accounts.map((account) => (
					<Card
						className="transition-colors hover:bg-muted/40"
						key={account.accountId}
						size="sm"
					>
						<CardContent>
							<Link
								className="flex flex-col gap-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
								href={`/accounts/${encodeURIComponent(account.accountType)}/${encodeURIComponent(account.accountId)}`}
							>
								<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
									<h3 className="flex items-center gap-1.5 font-heading font-semibold text-lg">
										{account.accountType}
										{account.historyConfidence === "suspect" && (
											<AlertTriangle
												aria-label="This account's history looks incomplete"
												className="size-4 text-amber-600 dark:text-amber-400"
											/>
										)}
									</h3>
									<span className="text-muted-foreground text-xs">
										{account.accountId}
									</span>
								</div>

								<dl className="grid grid-cols-3 gap-3">
									<div className="flex flex-col gap-0.5">
										<dt className="text-muted-foreground text-xs">Book cost</dt>
										<dd className="font-medium tabular-nums">
											{formatCurrency(account.bookCost, currency)}
										</dd>
									</div>
									<div className="flex flex-col gap-0.5">
										<dt className="text-muted-foreground text-xs">Holdings</dt>
										<dd className="font-medium tabular-nums">
											{account.openCount}
										</dd>
									</div>
									<div className="flex flex-col gap-0.5">
										<dt className="text-muted-foreground text-xs">Cash</dt>
										<dd className="font-medium tabular-nums">
											{formatCurrency(account.cashBalance, currency)}
										</dd>
									</div>
								</dl>

								<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
									<span>
										{formatDate(account.firstActivityDate)} –{" "}
										{formatDate(account.lastActivityDate)}
									</span>
									<span className="ml-auto tabular-nums">
										Dividends {formatCurrency(account.dividends, currency)}
									</span>
								</div>
							</Link>
						</CardContent>
					</Card>
				))}
			</div>
		</section>
	);
}
