import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Every module under test is pure functions over plain objects — no DOM.
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
	resolve: {
		// Vitest doesn't read tsconfig `paths`, so mirror `@/*` -> `./src/*` here.
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
});
