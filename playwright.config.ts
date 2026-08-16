import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",

	// Every spec shares one IndexedDB origin (http://localhost:3100) — there is
	// no per-spec isolation the way there would be with separate browser
	// contexts pointed at separate origins. Running specs in parallel would let
	// them race each other's reads and writes of the same database, so this
	// suite runs serially. Anyone turning this on must first give each spec its
	// own origin or its own worker-scoped storage state.
	fullyParallel: false,
	// `fullyParallel: false` only serializes tests *within* a file — different
	// spec files still ran as two concurrent workers here. Playwright's
	// default per-test browser context does isolate storage even across
	// workers, so it happened not to cause a collision, but relying on that
	// isolation staying incidental rather than guaranteed is exactly the kind
	// of thing that turns into a flaky suite later. Pin it to one worker so
	// "runs serially" above is actually true, not just true today.
	workers: 1,

	retries: process.env.CI ? 1 : 0,

	reporter: process.env.CI ? [["html"], ["github"]] : "list",

	use: {
		baseURL: "http://localhost:3100",
		trace: "on-first-retry",
	},

	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],

	// Strict Mode is on by default in `next dev`, which double-invokes effects
	// — `StoreHydrator`'s `useEffect` would call `hydrate()` twice, and both
	// calls would pass the `if (get().hydrated) return` guard because neither
	// has resolved yet. That's a dev-only artifact; testing hydration timing
	// against it would measure React's development behaviour, not the app's.
	// Running against the production build is load-bearing, not a preference.
	//
	// Port 3100, deliberately not the framework's default 3000: this repo's
	// own `next dev` (a *different* checkout of the same app — port is a host
	// resource, not a worktree-scoped one) can easily already be listening on
	// 3000, and `reuseExistingServer` would then silently attach this suite to
	// that dev server instead of starting the production build below — which
	// defeats the entire point of this setting. A dedicated port means "is
	// there already a server here" can only ever mean "did this suite leave
	// one running," never "is something unrelated using the port."
	webServer: {
		command: "pnpm build && PORT=3100 pnpm start",
		url: "http://localhost:3100",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
