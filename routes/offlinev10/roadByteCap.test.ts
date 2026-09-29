/** The session byte cap also stops the road-tile batches, whatever keeps them fetching. */
import { gzipSync } from "node:zlib";
import { beforeEach, expect, it, vi } from "vitest";

const stored: string[] = [];
vi.mock("./store", () => ({
	allTileKeys: async () => new Set<string>(),
	bytesOfTiles: async () => 0,
	deleteTiles: async () => undefined,
	putRegion: async () => undefined,
	putTiles: async (b: Array<[string]>) => void stored.push(...b.map(([k]) => k)),
	regionId: () => "r",
	usedBytes: async () => 0,
}));
vi.mock("./places", () => ({ nearestPlace: async () => null }));

const TILE_BYTES = 1_000_000;
const fetchMock = vi.fn();

/** What the Worker's POST /tiles answers: [uint32 manifestLen][manifest][bytes], gzipped. */
function batchResponse(body: string): Response {
	const keys = JSON.parse(body) as Array<[number, number, number]>;
	const manifest = new TextEncoder().encode(
		JSON.stringify({ total: keys.length, empty: 0, tiles: keys.map(([z, x, y]) => ({ k: `${z}/${x}/${y}`, n: TILE_BYTES })) }),
	);
	const out = new Uint8Array(4 + manifest.length + keys.length * TILE_BYTES);
	new DataView(out.buffer).setUint32(0, manifest.length, true);
	out.set(manifest, 4);
	return new Response(gzipSync(out));
}

beforeEach(() => {
	vi.resetModules();
	stored.length = 0;
	fetchMock.mockReset();
	fetchMock.mockImplementation(async (_url: string, init: { body: string }) => batchResponse(init.body));
	vi.stubGlobal("fetch", fetchMock);
});

it("stops fetching road tiles once the session cap trips", async () => {
	const { configureTilesDevHost } = await import("../../lib/worker/worker-local-dev/tilesHost");
	configureTilesDevHost("https://tiles.test");
	const { downloadRegion } = await import("./download");
	const { sessionCap } = await import("../../lib/shared/sessionByteCap.svelte");
	vi.spyOn(console, "error").mockImplementation(() => undefined);

	await expect(downloadRegion(7.2, 43.68)).rejects.toThrow("session byte cap");

	const { rangeTiles, regionRange } = await import("./tiles");
	expect(rangeTiles(regionRange(7.2, 43.68)).length).toBeGreaterThan(700);
	expect(sessionCap.tripped).toBe(true);
	expect(fetchMock).toHaveBeenCalledTimes(1);
});
