import { DatasetWorkspace } from "@/components/dataset-workspace";

export default function Home() {
	return (
		<main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
			<DatasetWorkspace />
		</main>
	);
}
