// ⛔ Never point a parent's kit.files.routes at the child's route dir when that parent has its own routes (e.g. ReTreever) — it REPLACES the whole route tree rather than merging, so every other route 404s at once. Share at the import layer instead: a small route file per tier imports the shared component.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = resolve(HERE, "../..");
const FETCH = resolve(CHILD, "..");
const RETREEVER = join(FETCH, "ReTreever");

// The "one map component, two tiers" assertions this file used to carry went
// with OfflineMapPage.svelte (8 Sep 2026). The map they guarded is V10, which
// this child does not contain — so there is no shared component here to hold
// to one inode, and a test pointed at any remaining file would pass while
// asserting nothing. What survives is the route-tree rule, which is about how
// a parent mounts a child at all and is true whatever the child serves.
describe("a parent keeps its own route tree", () => {
	// ⛔ kit.files.routes takes ONE path and doesn't merge — setting it in ReTreever replaces all thirty-odd Get Cache routes with the child's (measured 28 Aug 2026: /menu /cache /map /inbox /account /quality704 all 404'd at once). Share at the import layer instead.
	it("ReTreever does not hand its route tree to the child", () => {
		const config = join(RETREEVER, "svelte.config.js");
		if (!existsSync(config)) return; // ReTreever not checked out beside us
		const src = readFileSync(config, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
		expect(
			/routes\s*:\s*["'][^"']*getCache_OfflineMap/.test(src),
			"ReTreever/svelte.config.js sets kit.files.routes to the child. That REPLACES " +
				"ReTreever's whole route tree — every other Get Cache route 404s. " +
				"Import the component from a route file instead.",
		).toBe(false);
	});
});
