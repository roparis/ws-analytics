"use client";

import { use } from "react";
import { AccountTypeDetail } from "@/components/accounts/account-type-detail";
import { RequireDataset } from "@/components/require-dataset";

export default function AccountTypePage(props: PageProps<"/accounts/[type]">) {
	const { type } = use(props.params);

	return (
		<RequireDataset>
			<AccountTypeDetail typeParam={type} />
		</RequireDataset>
	);
}
