import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Every module under test is pure functions over plain objects — no DOM.
		environment: "node",
		include: ["src/**/*.test.ts"],
		// Pinned so the local-vs-UTC date bugs this suite guards against are
		// reproducible on any machine. A UTC runner is exactly the blind spot
		// that let them ship: `toISOString().slice(0, 10)` is only wrong when
		// local and UTC disagree. Toronto is the app's audience, is west of
		// Greenwich, and observes DST, which the date-arithmetic tests rely on.
		env: { TZ: "America/Toronto" },
	},
	resolve: {
		// Vitest doesn't read tsconfig `paths`, so mirror `@/*` -> `./src/*` here.
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
});
