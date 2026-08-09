"use client";

import {
	ChartCandlestick,
	GitMerge,
	Home,
	LayoutDashboard,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CsvUploader } from "@/components/csv-uploader";
import { matchDatasetValue } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { useDatasetStore } from "@/stores/dataset";

const NAV = [
	{ href: "/", label: "Timeline", Icon: Home },
	{ href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
	{ href: "/investment", label: "Investments", Icon: ChartCandlestick },
	// Merge is the utility, so it stays last.
	{ href: "/merge", label: "Merge", Icon: GitMerge },
] as const;

// A stable empty-array fallback: returning `[]` inline from a selector would
// create a new reference on every call and defeat zustand's equality check.
const NO_ACCOUNT_TYPES: string[] = [];

function isActive(pathname: string, href: string): boolean {
	// Prefix-matching would make every route match "/", and would make
	// "/accounts/RRSP" match a hypothetical "/accounts/RRSP2" link too — so
	// anything past root only matches on a full segment.
	return href === "/"
		? pathname === "/"
		: pathname.startsWith(`${href}/`) || pathname === href;
}

export function AppShell({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const accountTypes =
		useDatasetStore((state) => state.dataset?.accountTypes) ?? NO_ACCOUNT_TYPES;
	const sortedAccountTypes = [...accountTypes].sort();

	// On an account-type or account-detail route, the second path segment is
	// the type (URL-encoded) — resolve it back to the real value so the right
	// link highlights even when the URL segment doesn't match the stored
	// string byte-for-byte.
	const activeAccountType = pathname.startsWith("/accounts/")
		? matchDatasetValue(accountTypes, pathname.split("/")[2] ?? "")
		: undefined;

	return (
		<div className="flex w-full flex-1 gap-6 px-4 lg:px-6">
			<header className="hidden shrink-0 lg:block lg:w-56">
				<div className="sticky top-0 flex h-dvh flex-col gap-6 py-6">
					<span className="px-3 font-semibold">ws-analytics</span>
					<nav className="flex flex-col gap-1">
						{NAV.map(({ href, label, Icon }) => (
							<Link
								className={cn(
									"flex items-center gap-3 rounded-full px-3 py-2 text-base transition-colors hover:bg-muted",
									isActive(pathname, href)
										? "font-semibold text-foreground"
										: "text-muted-foreground",
								)}
								href={href}
								key={href}
							>
								<Icon className="size-5" />
								{label}
							</Link>
						))}
					</nav>

					{/* Account-type links only appear once a dataset is loaded; the
					mobile bottom bar keeps its three fixed tabs instead (see below),
					since a free-form, unbounded list of types doesn't fit there. */}
					{sortedAccountTypes.length > 0 && (
						<nav className="flex min-h-0 flex-col gap-1 overflow-y-auto">
							<span className="px-3 text-muted-foreground text-xs">
								Accounts
							</span>
							{sortedAccountTypes.map((type) => (
								<Link
									className={cn(
										"truncate rounded-full px-3 py-2 text-sm transition-colors hover:bg-muted",
										activeAccountType === type
											? "font-semibold text-foreground"
											: "text-muted-foreground",
									)}
									href={`/accounts/${encodeURIComponent(type)}`}
									key={type}
								>
									{type}
								</Link>
							))}
						</nav>
					)}

					<div className="mt-auto">
						<CsvUploader compact />
					</div>
				</div>
			</header>

			<div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
				{/* Mobile header — the sidebar is hidden below lg. */}
				<div className="flex items-center justify-between py-4 lg:hidden">
					<span className="font-semibold">ws-analytics</span>
					<CsvUploader compact />
				</div>
				<Breadcrumbs />
				{children}
			</div>

			<nav className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-background/95 backdrop-blur lg:hidden">
				{NAV.map(({ href, label, Icon }) => (
					<Link
						className={cn(
							// `whitespace-nowrap` keeps a longer label on one line: a wrapped
							// tab would be taller than its neighbours and shift the bar.
							"flex flex-1 flex-col items-center gap-1 whitespace-nowrap py-2.5 text-xs transition-colors",
							isActive(pathname, href)
								? "font-medium text-foreground"
								: "text-muted-foreground",
						)}
						href={href}
						key={href}
					>
						<Icon className="size-5" />
						{label}
					</Link>
				))}
			</nav>
		</div>
	);
}
