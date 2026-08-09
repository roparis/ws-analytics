"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Amount } from "@/components/ui/figures";
import { formatDate, groupByAccount } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { Activity } from "@/lib/wealthsimple";

/**
 * Accounts grouped by type, each group opening to reveal the real accounts
 * inside it.
 *
 * The grouping exists because `accountType` is a display label, not a key —
 * three TFSAs share one. Collapsing them keeps the list readable while the
 * expanded rows stay honest about there being three separate cost pools
 * underneath.
 */

interface AccountGroupListProps {
	activities: Activity[];
	currency: string;
	/** Sits under the heading to say what the figures on the right are. */
	caption?: string;
	/**
	 * Figure shown per account. Cash flow is the only one the export supports
	 * for every account type, holdings or not.
	 *
	 * Deliberately not called `valueOf` — that name collides with the one every
	 * object already has, and TypeScript resolves the prop against the built-in.
	 */
	amountFor?: (accountId: string) => number;
	/**
	 * Cash taken out of the account, as a positive magnitude. Shown beside the
	 * value rather than subtracted from it: an account can hold a large position
	 * *and* have had a lot withdrawn, because deposits, dividends and recycled
	 * sale proceeds all funded it over time. Netting the two would produce a
	 * figure that is neither what you hold nor what you put in.
	 */
	withdrawnFor?: (accountId: string) => number;
}

interface AccountRow {
	id: string;
	total: number;
	withdrawn: number;
	count: number;
	last: string;
}

interface TypeGroup {
	accountType: string;
	accounts: AccountRow[];
	total: number;
	withdrawn: number;
}

export function AccountGroupList({
	activities,
	currency,
	caption,
	amountFor,
	withdrawnFor,
}: AccountGroupListProps) {
	const groups = useMemo<TypeGroup[]>(() => {
		const byType = new Map<string, TypeGroup>();

		for (const account of groupByAccount(activities)) {
			const total = amountFor
				? amountFor(account.id)
				: account.kpis.netCashFlow;

			const withdrawn = withdrawnFor?.(account.id) ?? 0;

			let group = byType.get(account.accountType);
			if (!group) {
				group = {
					accountType: account.accountType,
					accounts: [],
					total: 0,
					withdrawn: 0,
				};
				byType.set(account.accountType, group);
			}
			group.accounts.push({
				id: account.id,
				total,
				withdrawn,
				count: account.kpis.count,
				last: account.kpis.dateRange.end,
			});
			group.total += total;
			group.withdrawn += withdrawn;
		}

		return [...byType.values()]
			.map((group) => ({
				...group,
				accounts: group.accounts.sort((a, b) => b.total - a.total),
			}))
			.sort((a, b) => b.total - a.total);
	}, [activities, amountFor, withdrawnFor]);

	const [open, setOpen] = useState<string[]>([]);

	if (groups.length === 0) return null;

	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<h2 className="font-heading font-medium text-base">Accounts</h2>
				{caption && (
					<p className="max-w-prose text-muted-foreground text-sm">{caption}</p>
				)}
			</div>

			<div className="flex flex-col gap-3">
				{groups.map((group) => {
					const expandable = group.accounts.length > 1;
					const expanded = open.includes(group.accountType);
					const href = `/accounts/${encodeURIComponent(group.accountType)}`;

					return (
						<div
							className="overflow-hidden rounded-4xl bg-card shadow-md ring-1 ring-foreground/5 dark:ring-foreground/10"
							key={group.accountType}
						>
							<div className="flex items-center gap-3 px-6 py-5">
								<Link
									className="flex min-w-0 flex-1 flex-col outline-none focus-visible:underline"
									href={href}
								>
									<span className="truncate font-heading font-semibold text-lg">
										{group.accountType}
									</span>
									<span className="text-muted-foreground text-sm">
										{expandable
											? `${group.accounts.length} accounts`
											: group.accountType}
									</span>
								</Link>

								<span className="flex flex-col items-end">
									<Amount
										className="font-medium"
										currency={currency}
										value={group.total}
									/>
									{group.withdrawn > 0 && (
										<span className="text-muted-foreground text-xs">
											<Amount currency={currency} value={group.withdrawn} />{" "}
											withdrawn
										</span>
									)}
								</span>

								{expandable && (
									<button
										aria-expanded={expanded}
										aria-label={`${expanded ? "Collapse" : "Expand"} ${group.accountType}`}
										className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
										onClick={() =>
											setOpen((current) =>
												current.includes(group.accountType)
													? current.filter((type) => type !== group.accountType)
													: [...current, group.accountType],
											)
										}
										type="button"
									>
										<ChevronDown
											className={cn(
												"size-5 transition-transform",
												expanded && "rotate-180",
											)}
										/>
									</button>
								)}
							</div>

							{expandable && expanded && (
								<div className="flex flex-col gap-1 bg-muted/40 px-6 py-4">
									{group.accounts.map((account) => (
										<Link
											className="flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-card"
											href={`${href}/${encodeURIComponent(account.id)}`}
											key={account.id}
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate font-medium">
													{account.id}
												</span>
												<span className="text-muted-foreground text-xs">
													{account.count.toLocaleString()} activities · to{" "}
													{formatDate(account.last)}
												</span>
											</span>
											<span className="flex flex-col items-end">
												<Amount currency={currency} value={account.total} />
												{account.withdrawn > 0 && (
													<span className="text-muted-foreground text-xs">
														<Amount
															currency={currency}
															value={account.withdrawn}
														/>{" "}
														withdrawn
													</span>
												)}
											</span>
										</Link>
									))}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</section>
	);
}
