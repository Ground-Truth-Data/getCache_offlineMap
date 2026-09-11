import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { configDefaults, defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The child's OWN test runner, so `npm test` here means what it says.
 *
 * This is not the build config `_no_build_on_purpose` forbids — a child still
 * ships no vite.config.ts and is still built only by a parent. It is the
 * runner, and it exists because runes are COMPILER syntax: a `.svelte.ts`
 * module reaches node with `$state` as an undefined global unless the svelte
 * plugin transforms it first. Without this, 31 tests across four files failed
 * with `$state is not defined` while the very same files passed from
 * ReTreever, whose config already applies the plugin — a suite that is
 * permanently red for a config reason is one nobody reads.
 *
 * Deliberately NOT the SvelteKit plugin: these tests import pure module
 * functions, not routed pages, so the full app graph would only cost time.
 */
export default defineConfig({
	// Never the dev server's `node_modules/.vite`: vitest is a Vite instance
	// too, and sharing one deps dir means a test run wipes optimized deps out
	// from under a running server, which then 504s on innocent routes.
	cacheDir: "node_modules/.vite-unit",
	plugins: [svelte({ hot: false })],
	resolve: {
		// ORDER IS LOAD-BEARING: Vite matches aliases in sequence, so the
		// per-child entries MUST precede the bare `$parent`, which would
		// otherwise swallow them and rewrite
		// `$parent/siblings/getCache_OnlineMap/...` into a path with no file.
		//
		// An unresolvable alias does not redden an assertion — it kills the
		// module graph before a single `it()` registers, so the file reports a
		// collection error and its tests vanish from the totals rather than
		// failing. A test that cannot load is indistinguishable from one that
		// was never written.
		alias: {
			"$parent/siblings/ReTreever_who_what": r("../ReTreever_who_what"),
			"$parent/siblings/getCache_OnlineMap": r("../getCache_OnlineMap"),
			"$parent/siblings/getCache_OfflineMap": r("."),
			"$parent/siblings/ReTreever_where": r("../ReTreever_where"),
			"$parent/siblings": r(".."),
			// `$parent` is the TIER SWITCH: it points each tier at ITSELF, so
			// here it is this child, not ReTreever.
			$parent: r("."),
			// No $rig/$gc/$rt here: those name rapper, and a child must run
			// under either parent or none. This child imports nothing from the
			// shared tree — noParentNames.test.ts fails the build if that
			// changes by copy-paste.
		},
	},
	// ⛔ _rapper/ and _siblings/ are VENDORED by dressChild.sh — other repos'
	// tests, written for their own harness and their own assets. Running them
	// here fails on files this repo never had. vite.config.ts already excludes
	// them; vitest reads THIS file, so the rule has to live here too.
	test: {
		exclude: [...configDefaults.exclude, "_rapper/**", "_siblings/**"],
	},
});
