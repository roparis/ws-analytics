"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AccountRollup } from "@/lib/positions";

/**
 * Named, up front, when an account's history looks truncated.
 *
 * Book cost is reconstructed by walking the trades in the loaded files, so an
 * account whose earliest buys are missing produces a cost — and therefore a
 * gain — that is quietly wrong rather than obviously absent. This sits above
 * every figure it invalidates.
 */
export function HistoryWarning({ accounts }: { accounts: AccountRollup[] }) {
	if (accounts.length === 0) return null;

	return (
		<Card
			className="bg-amber-500/5 ring-amber-600/20 dark:ring-amber-400/25"
			size="sm"
		>
			<CardContent className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<AlertTriangle className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
					<h2 className="font-heading font-medium text-base">
						{accounts.length === 1
							? "One account's history looks incomplete"
							: `${accounts.length} accounts' histories look incomplete`}
					</h2>
				</div>

				<p className="text-muted-foreground text-sm">
					Book cost is rebuilt from the trades in your loaded files, so a
					missing buy makes the cost — and every gain measured against it — too
					low. Share counts below are still right.
				</p>

				<ul className="flex flex-col gap-2">
					{accounts.map((account) => (
						<li className="text-sm" key={account.accountId}>
							<span className="font-medium">{account.accountId}</span>{" "}
							<span className="text-muted-foreground">
								({account.accountType}) — {account.historyReasons.join(" ")}
							</span>
						</li>
					))}
				</ul>

				<Button
					className="w-fit"
					nativeButton={false}
					render={<Link href="/merge">Review loaded files</Link>}
					size="sm"
					variant="outline"
				/>
			</CardContent>
		</Card>
	);
}
