"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useMemo } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { matchDatasetValue, monthLabel } from "@/lib/metrics";
import { useDatasetStore } from "@/stores/dataset";

/**
 * The path from a top-level page down to whatever is on screen, with a switcher
 * on any crumb that has siblings.
 *
 * Only drill-down routes get a trail. A top-level page has no parent, so its
 * "breadcrumb" would be one word repeating the heading below it and the nav
 * item already highlighted beside it — the crumbs earn their place exactly
 * where the sidebar stops, which is inside an account type or a month.
 */

interface CrumbLink {
	href: string;
	label: string;
}

interface Crumb extends CrumbLink {
	/** Same level of the tree, different value. Renders as the dropdown. */
	siblings?: CrumbLink[];
	/** What the dropdown switches, for the trigger's accessible name. */
	switches?: string;
}

function useTrail(): Crumb[] {
	const pathname = usePathname();
	const dataset = useDatasetStore((state) => state.dataset);

	// Derived here rather than taken from `groupByMonth`, which computes a full
	// KPI set per month — far more work than a list of links needs.
	const months = useMemo(() => {
		if (!dataset) return [];
		const keys = new Set<string>();
		for (const activity of dataset.activities) {
			const key = activity.transactionDate.slice(0, 7);
			if (key) keys.add(key);
		}
		return [...keys].sort().reverse();
	}, [dataset]);

	return useMemo<Crumb[]>(() => {
		if (!dataset) return [];

		// `usePathname` reports the URL as written, so segments are still encoded —
		// `matchDatasetValue` is what resolves one back to the stored string.
		const segments = pathname.split("/").filter(Boolean);

		if (segments[0] === "accounts" && segments[1]) {
			const accountType = matchDatasetValue(dataset.accountTypes, segments[1]);
			// An unresolvable type means the page itself is showing its "no activity"
			// state, which carries its own way back. A trail would only guess.
			if (!accountType) return [];

			const typeHref = `/accounts/${encodeURIComponent(accountType)}`;
			const trail: Crumb[] = [
				// The account list lives on the dashboard; there is no `/accounts`.
				{ href: "/dashboard", label: "Dashboard" },
				{
					href: typeHref,
					label: accountType,
					switches: "account type",
					siblings: dataset.accountTypes.map((type) => ({
						href: `/accounts/${encodeURIComponent(type)}`,
						label: type,
					})),
				},
			];

			if (!segments[2]) return trail;

			const inType = dataset.accounts.filter(
				(account) => account.accountType === accountType,
			);
			const accountId = matchDatasetValue(
				inType.map((account) => account.id),
				segments[2],
			);
			if (!accountId) return trail;

			trail.push({
				href: `${typeHref}/${encodeURIComponent(accountId)}`,
				label: accountId,
				switches: "account",
				siblings: inType.map((account) => ({
					href: `${typeHref}/${encodeURIComponent(account.id)}`,
					label: account.id,
				})),
			});
			return trail;
		}

		if (segments[0] === "month" && segments[1]) {
			// A month key is `2026-06` — nothing in it needs escaping, so the raw
			// segment compares directly against the derived keys.
			const monthKey = segments[1];
			if (!months.includes(monthKey)) return [];

			return [
				{ href: "/", label: "Timeline" },
				{
					href: `/month/${monthKey}`,
					label: monthLabel(monthKey),
					switches: "month",
					siblings: months.map((month) => ({
						href: `/month/${month}`,
						label: monthLabel(month),
					})),
				},
			];
		}

		return [];
	}, [pathname, dataset, months]);
}

function CrumbSwitcher({ crumb }: { crumb: Crumb }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={`Switch ${crumb.switches}`}
				className="-my-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
			>
				<ChevronsUpDown className="size-3.5" />
			</DropdownMenuTrigger>
			{/* The trigger is a 22px icon button, so the popup can't inherit its
			width the way a normal `w-(--anchor-width)` menu does. */}
			<DropdownMenuContent className="max-h-80 w-auto min-w-56 max-w-72">
				{/* Base UI requires a group around a GroupLabel, and the grouping is
				what makes the label announce as this list's name rather than as a
				stray item. */}
				<DropdownMenuGroup>
					{/* `capitalize` would title-case it into "Account Type". */}
					<DropdownMenuLabel className="first-letter:uppercase">
						{crumb.switches}
					</DropdownMenuLabel>
					{crumb.siblings?.map((sibling) => (
						<DropdownMenuItem
							className="justify-between"
							key={sibling.href}
							render={
								<Link href={sibling.href}>
									<span className="truncate">{sibling.label}</span>
									{sibling.href === crumb.href ? (
										<Check className="shrink-0" />
									) : null}
								</Link>
							}
						/>
					))}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function Breadcrumbs() {
	const trail = useTrail();

	if (trail.length < 2) return null;

	return (
		// Crumbs never wrap or ellipsise — a narrow screen scrolls the trail
		// instead. Truncating would clip every crumb at once ("Dashbo… /
		// Non-registered … / HQB5TG204…"), and the way *up* is the part a
		// breadcrumb exists for, so it's the tail that should fall off the edge.
		// The scrollbar is hidden with it: on platforms without overlay scrollbars
		// it would draw a permanent grey rule under the trail. Every crumb is a
		// focusable link, so keyboard focus still scrolls what's off-screen.
		<nav
			aria-label="Breadcrumb"
			className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pt-2 text-sm [-ms-overflow-style:none] [scrollbar-width:none] lg:pt-6 [&::-webkit-scrollbar]:hidden"
		>
			{trail.map((crumb, index) => {
				const last = index === trail.length - 1;

				return (
					<Fragment key={crumb.href}>
						{index > 0 && (
							<span aria-hidden className="shrink-0 select-none text-border">
								/
							</span>
						)}
						<span className="flex shrink-0 items-center gap-0.5">
							{last ? (
								<span aria-current="page" className="font-medium">
									{crumb.label}
								</span>
							) : (
								<Link
									className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
									href={crumb.href}
								>
									{crumb.label}
								</Link>
							)}
							{crumb.siblings && crumb.siblings.length > 1 && (
								<CrumbSwitcher crumb={crumb} />
							)}
						</span>
					</Fragment>
				);
			})}
		</nav>
	);
}
