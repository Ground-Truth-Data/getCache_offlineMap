import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The "route arms the handler" assertions here read OfflineMapPage.svelte,
// which went with the old offline map (8 Sep 2026). V10 arms no blind handler
// — it reads whole z10 tiles and repairs a blob rather than healing per-tile —
// so there is no longer a call site to hold to its import block. What is left
// is the export the protocol still owes anything that does wire it.
describe("rawWallProtocol keeps its self-heal entry point", () => {
	it("refreshRawTiles is actually exported by rawWallProtocol", () => {
		const proto = readFileSync(join(__dirname, "rawWallProtocol.ts"), "utf8");
		expect(proto).toMatch(/export function refreshRawTiles/);
	});
});
