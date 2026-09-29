/** The session byte cap also stops the road-tile pool, whatever keeps it fetching. */
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

const TILE_BYTES = 100_000;
const POOL = 32;
const fetchMock = vi.fn();

beforeEach(() => {
	vi.resetModules();
	stored.length = 0;
	fetchMock.mockReset();
	fetchMock.mockImplementation(async () => ({ status: 200, arrayBuffer: async () => new ArrayBuffer(TILE_BYTES) }));
	vi.stubGlobal("fetch", fetchMock);
});

it("stops fetching road tiles once the session cap trips", async () => {
	const { configureTilesDevHost } = await import("../../lib/worker/worker-local-dev/tilesHost");
	configureTilesDevHost("https://tiles.test");
	const { downloadRegion } = await import("./download");
	const { sessionCap, SESSION_BYTE_CAP } = await import("../../lib/shared/sessionByteCap.svelte");
	vi.spyOn(console, "error").mockImplementation(() => undefined);

	await expect(downloadRegion(7.2, 43.68)).rejects.toThrow("session byte cap");

	expect(sessionCap.tripped).toBe(true);
	expect(fetchMock.mock.calls.length * TILE_BYTES).toBeLessThanOrEqual(SESSION_BYTE_CAP + POOL * TILE_BYTES);
});
