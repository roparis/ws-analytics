import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	/**
	 * `yahoo-finance2` is a Deno-authored package shipped through dnt, and its
	 * entry point pulls in a `createRequire` polyfill over `node:module` before
	 * anything else. Bundled into the route that uses it, that polyfill is the
	 * kind of thing that survives dev and falls over in a production build, so
	 * the package is left to Node to resolve at runtime instead.
	 *
	 * It is only ever imported by `src/app/api/prices/route.ts`, which runs on
	 * the server; nothing in the browser bundle touches it.
	 */
	serverExternalPackages: ["yahoo-finance2"],
};

export default nextConfig;
