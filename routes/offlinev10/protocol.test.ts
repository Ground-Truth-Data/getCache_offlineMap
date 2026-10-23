// `v10://` reads the tile store: a road tile under the anchor zoom comes out
// clipped to the blobs it belongs to (and cached until the blob list
// changes), a photo tile comes out raw, and a miss or a bad URL is a 404.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	handler: null as null | ((p: { url: string }, a: { signal: { aborted: boolean } }) => Promise<{ data: ArrayBuffer }>),
	addProtocol: vi.fn(),
	tiles: new Map<string, ArrayBuffer>(),
	snap: { version: 1, regions: Promise.resolve([] as unknown[]) },
	clipTile: vi.fn((bytes: Uint8Array, rects: unknown[]) => new Uint8Array([bytes.length, rects.length])),
}));
h.addProtocol.mockImplementation((_s: string, fn: typeof h.handler) => void (h.handler = fn));
vi.mock("maplibre-gl", () => ({ addProtocol: h.addProtocol }));
vi.mock("./clip", () => ({ clipTile: h.clipTile }));
vi.mock("./store", () => ({
	PHOTO_PREFIX: "p/",
	getTile: async (k: string) => h.tiles.get(k),
	regionsSnapshot: () => h.snap,
}));

import { installProtocol, PHOTO_TILES, PLANET_TILES, readCounts, resetReadCounts } from "./protocol";
import { regionRange } from "./tiles";

const ask = (url: string, aborted = false) => h.handler!({ url }, { signal: { aborted } });
const bytes = (r: { data: ArrayBuffer }) => [...new Uint8Array(r.data)];

beforeEach(() => {
	resetReadCounts();
	h.tiles.clear();
	h.clipTile.mockClear();
});

describe("installProtocol", () => {
	it("registers the v10 scheme once", () => {
		installProtocol();
		installProtocol();
		expect(h.addProtocol).toHaveBeenCalledTimes(1);
		expect(h.addProtocol.mock.calls[0]![0]).toBe("v10");
		expect(PLANET_TILES).toBe("v10://planet/{z}/{x}/{y}");
		expect(PHOTO_TILES).toBe("v10://photo/{z}/{x}/{y}");
	});

	it("serves a photo tile and an anchor-zoom road tile raw, and counts hits and misses", async () => {
		installProtocol();
		h.tiles.set("p/13/5/6", new Uint8Array([1, 2, 3]).buffer);
		h.tiles.set("12/1/1", new Uint8Array([9]).buffer);
		h.tiles.set("12/1/2", new ArrayBuffer(0));
		expect(bytes(await ask("v10://photo/13/5/6"))).toEqual([1, 2, 3]);
		expect(bytes(await ask("v10://planet/12/1/1"))).toEqual([9]);
		await expect(ask("v10://planet/12/1/2")).rejects.toMatchObject({ status: 404, message: "no tile: v10://planet/12/1/2" });
		await expect(ask("v10://planet/12/7/7")).rejects.toMatchObject({ status: 404 });
		await expect(ask("https://elsewhere/1/2/3")).rejects.toMatchObject({ status: 404 });
		await expect(ask("v10://planet/12/1/1", true)).rejects.toMatchObject({ name: "AbortError" });
		expect(h.clipTile).not.toHaveBeenCalled();
		expect(readCounts()).toEqual({ hit: 2, miss: 2, net: 0 });
	});

	it("clips a low-zoom road tile to the blobs that cover it and caches it per blob-list version", async () => {
		installProtocol();
		const range = regionRange(-119.59, 49.49);
		h.snap = { version: 1, regions: Promise.resolve([{ range }]) };
		h.tiles.set("0/0/0", new Uint8Array([4, 4, 4, 4]).buffer);
		h.tiles.set("5/0/0", new Uint8Array([7]).buffer);
		expect(bytes(await ask("v10://planet/0/0/0"))).toEqual([4, 1]);
		const [, rects] = h.clipTile.mock.calls[0]!;
		const r = (rects as Array<{ x0: number; y0: number; x1: number; y1: number }>)[0]!;
		expect(r.x0).toBeGreaterThan(0.16);
		expect(r.x1).toBeLessThan(0.18);
		expect(r.y0).toBeLessThan(r.y1);
		expect(bytes(await ask("v10://planet/0/0/0"))).toEqual([4, 1]);
		expect(h.clipTile).toHaveBeenCalledTimes(1);
		h.snap = { version: 2, regions: Promise.resolve([{ range }]) };
		await ask("v10://planet/0/0/0");
		expect(h.clipTile).toHaveBeenCalledTimes(2);
		await expect(ask("v10://planet/5/0/0")).rejects.toMatchObject({ status: 404 });
		expect(readCounts()).toEqual({ hit: 3, miss: 1, net: 0 });
	});
});
