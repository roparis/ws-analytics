"use client";

import { use } from "react";
import { AccountDetail } from "@/components/accounts/account-detail";
import { RequireDataset } from "@/components/require-dataset";

export default function AccountPage(
	props: PageProps<"/accounts/[type]/[accountId]">,
) {
	const { type, accountId } = use(props.params);

	return (
		<RequireDataset>
			<AccountDetail accountId={accountId} typeParam={type} />
		</RequireDataset>
	);
}
