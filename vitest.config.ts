import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { configDefaults, defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The svelte plugin, not SvelteKit's: runes are compiler syntax, so a `.svelte.ts`
// module reaches node with `$state` undefined without it.
export default defineConfig({
	// Never the dev server's `node_modules/.vite`: a test run would wipe optimized deps from under a running server.
	cacheDir: "node_modules/.vite-unit",
	plugins: [svelte()],
	resolve: {
		// Keep in sync with svelte.config.js, same order: per-child entries before the bare `$parent`,
		// or it swallows them. An unresolvable alias kills the module graph before any `it()` registers.
		alias: {
			"$parent/siblings/ReTreever_who_what": r("../ReTreever_who_what"),
			"$parent/siblings/getCache_OnlineMap": r("../getCache_OnlineMap"),
			"$parent/siblings/getCache_OfflineMap": r("."),
			"$parent/siblings/ReTreever_where": r("../ReTreever_where"),
			"$parent/siblings": r(".."),
			$parent: r("."),
		},
	},
	// _rapper/ and _siblings/ carry other repos' tests; vitest reads this file, not vite.config.ts.
	test: {
		exclude: [...configDefaults.exclude, "_rapper/**", "_siblings/**"],
	},
});
