import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { configDefaults, defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// The workspace member is rapper as it is now; a bare clone has only the copy syncRapper.sh made.
const RAPPER = (() => {
	try {
		return dirname(createRequire(import.meta.url).resolve("@retreever/create-rapper/package.json"));
	} catch {
		return r("./_rapper");
	}
})();

// The svelte plugin, not SvelteKit's: runes are compiler syntax, so a `.svelte.ts`
// module reaches node with `$state` undefined without it.
export default defineConfig({
	// Never the dev server's `node_modules/.vite`: a test run would wipe optimized deps from under a running server.
	cacheDir: "node_modules/.vite-unit",
	plugins: [
		svelte(),
		// Svelte's browser build, and @testing-library's own runes module compiled rather than externalised.
		svelteTesting(),
		paraglideVitePlugin({
			project: `${RAPPER}/project.inlang`,
			outdir: `${RAPPER}/src/lib/paraglide`,
			strategy: ["preferredLanguage", "baseLocale"],
		}),
	],
	resolve: {
		// Keep in sync with svelte.config.js, same order: per-child entries before the bare `$parent`,
		// or it swallows them. An unresolvable alias kills the module graph before any `it()` registers.
		alias: {
			"$parent/siblings/ReTreever_who_what": r("../ReTreever_who_what"),
			"$parent/siblings/getCache_OfflineMap": r("."),
			"$parent/siblings/ReTreever_where": r("../ReTreever_where"),
			"$parent/siblings": r(".."),
			"$parent/src/lib/paraglide": `${RAPPER}/src/lib/paraglide`,
			$parent: r("."),
			$rig: `${RAPPER}/rig`,
			$gc: `${RAPPER}/gc`,
			$rt: `${RAPPER}/rt`,
		},
	},
	// _rapper/ and _siblings/ carry other repos' tests; _shelved/ is kept, never run. vitest reads this file, not vite.config.ts.
	test: {
		silent: "passed-only",
		// One cache at the workspace root, shared by every run: parallel suites hit ENOTEMPTY, and it saved under 10%.
		fsModuleCache: false,
		exclude: [...configDefaults.exclude, "_rapper/**", "_siblings/**", "_shelved/**"],
		setupFiles: ["vitest.setup.ts"],
	},
});
