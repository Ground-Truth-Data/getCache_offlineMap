/** The road download stops at the session cap, and every download together stays under the Worker's ceiling. */
import { beforeEach, expect, it, vi } from "vitest";

const stored: string[] = [];
vi.mock("./store", () => ({
	allTileKeys: async () => new Set<string>(),
	bytesOfTiles: async () => 0,
	deleteRegion: async () => 0,
	patchRegion: async () => undefined,
	putRegion: async () => undefined,
	putTiles: async (b: Array<[string]>) => void stored.push(...b.map(([k]) => k)),
	regionId: () => "r",
	usedBytes: async () => 0,
}));
vi.mock("./places", () => ({ nearestPlace: async () => null }));

const TILE_BYTES = 1_000_000;
const fetchMock = vi.fn();
let cap: { tripped: boolean } | null = null;
let askedAfterTrip = 0;

beforeEach(() => {
	vi.resetModules();
	stored.length = 0;
	fetchMock.mockReset();
	cap = null;
	askedAfterTrip = 0;
	fetchMock.mockImplementation(async () => {
		if (cap?.tripped) askedAfterTrip++;
		return new Response(new ArrayBuffer(TILE_BYTES));
	});
	vi.stubGlobal("fetch", fetchMock);
});

it("stops fetching road tiles once the session cap trips", async () => {
	const { configureTilesDevHost } = await import("../../lib/worker/worker-local-dev/tilesHost");
	configureTilesDevHost("https://tiles.test");
	const { downloadRegion } = await import("./download");
	const { sessionCap } = await import("../../lib/shared/sessionByteCap.svelte");
	cap = sessionCap;
	vi.spyOn(console, "error").mockImplementation(() => undefined);

	await expect(downloadRegion(7.2, 43.68)).rejects.toThrow("session byte cap");

	const { rangeTiles, regionRange } = await import("./tiles");
	expect(sessionCap.tripped).toBe(true);
	expect(askedAfterTrip).toBe(0);
	expect(fetchMock.mock.calls.length).toBeLessThan(rangeTiles(regionRange(7.2, 43.68)).length);
});

it("a map and its photo downloading together never have more than 48 requests out", async () => {
	let open = 0;
	let most = 0;
	fetchMock.mockImplementation(async () => {
		most = Math.max(most, ++open);
		await new Promise((r) => setTimeout(r, 1));
		open--;
		return new Response(new ArrayBuffer(1));
	});
	const { getEach } = await import("./download");
	const urls = Array.from({ length: 300 }, (_, i) => `https://tiles.test/${i}`);
	await Promise.all([getEach(urls, () => undefined), getEach(urls, () => undefined)]);
	expect(fetchMock).toHaveBeenCalledTimes(600);
	expect(most).toBe(48);
});
