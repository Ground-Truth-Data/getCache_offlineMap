/** The close-up's raw tiles live in the road store: a deleted blob takes the ones no other pin's disc still covers. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSE_UP, photoTilesFor, satImageKey } from "../../lib/onPhone/satellite/satelliteImage";
import { configureTilesDevHost } from "../../lib/worker/tilesHost";
import { setBudgetMb } from "./budget";
import { photoTiles } from "./satellite";
import { AreaGone, allTileKeys, deleteRegion, PHOTO_PREFIX, photoTileBytes, putPhotoTiles, putRegion, type Region, wipe } from "./store";
import { regionRange } from "./tiles";

vi.mock("./blobService", () => ({ onBlob: () => () => undefined }));
configureTilesDevHost("https://tiles.test");

const Z = CLOSE_UP.zoom;

function region(id: string, lng: number, lat: number): Region {
	return { id, lng, lat, range: regionRange(lng, lat), at: 1, tiles: 1, fetched: 1, bytes: 0, ms: 1, photoKey: satImageKey([lng, lat]), photoCenter: [lng, lat] };
}

const keysOf = (r: Region) => photoTilesFor([r.lng, r.lat], Z).map((t) => `${Z}/${t.x}/${t.y}`);
const photoKeysOnDisk = async () => [...(await allTileKeys())].filter((k) => k.startsWith(PHOTO_PREFIX));

// Ailsa Craig, and a pin 1 km east: their 2 km discs overlap.
const A = region("a", -81.5076, 43.1136);
const B = region("b", -81.4953, 43.1136);

beforeEach(async () => {
	await wipe();
	setBudgetMb(1024);
	for (const r of [A, B]) {
		await putRegion(r);
		await putPhotoTiles(keysOf(r).map((k) => [k, new ArrayBuffer(10)]), r.id);
	}
});

describe("photo close-up tiles", () => {
	it("counts each blob's tiles, shared ones for both", async () => {
		const sized = await photoTileBytes([A, B]);
		expect(sized.get("a")).toMatchObject({ tiles: keysOf(A).length, bytes: keysOf(A).length * 10 });
		expect(sized.get("b")?.tiles).toBe(keysOf(B).length);
	});

	it("deleting one blob keeps the tiles the other's disc still covers", async () => {
		await deleteRegion("a");
		const left = new Set(await photoKeysOnDisk());
		expect(left).toEqual(new Set(keysOf(B).map((k) => PHOTO_PREFIX + k)));
		expect(keysOf(A).some((k) => left.has(PHOTO_PREFIX + k))).toBe(true);
	});

	it("deleting the last blob leaves no photo tile behind", async () => {
		await deleteRegion("a");
		await deleteRegion("b");
		expect(await photoKeysOnDisk()).toEqual([]);
	});

	it("a follow-me blob has no photo, so deleting it touches none", async () => {
		const follow = { ...region("f", -81.5076, 43.1136), photoKey: undefined, photoCenter: undefined };
		await putRegion(follow);
		await deleteRegion("f");
		expect((await photoKeysOnDisk()).length).toBe(new Set([...keysOf(A), ...keysOf(B)]).size);
	});
});

describe("what a photo's tiles cost on the wire", () => {
	// The Worker's /satellite/{source}/{z}/{x}/{y}.jpg: every tile 7 bytes.
	const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(7) }));
	beforeEach(() => {
		fetchMock.mockClear();
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it("a disc already on disk costs zero requests", async () => {
		const got = await photoTiles(keysOf(A), A.id);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(got.size).toBe(keysOf(A).length);
	});

	it("an overlapping disc fetches only its missing tiles, once each, and keeps them", async () => {
		const C = region("c", -81.5076, 43.1226);
		const onDisk = new Set([...keysOf(A), ...keysOf(B)]);
		const missing = keysOf(C).filter((k) => !onDisk.has(k));
		expect(missing.length).toBeGreaterThan(0);
		expect(missing.length).toBeLessThan(keysOf(C).length);

		await putRegion(C);
		const got = await photoTiles(keysOf(C), C.id);
		const asked = fetchMock.mock.calls.map((c) => /satellite\/maptiler\/(\d+\/\d+\/\d+)\.jpg/.exec(c[0])?.[1]);
		expect(asked.sort()).toEqual([...missing].sort());
		expect(got.size).toBe(keysOf(C).length);

		fetchMock.mockClear();
		await photoTiles(keysOf(C), C.id);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("another source's tiles come from its own route and are never kept: only the close-up source's are", async () => {
		const D = region("d", -70.1, 46.2);
		await putRegion(D);
		const keys = keysOf(D).slice(0, 3);
		expect((await photoTiles(keys, D.id, "sentinel")).size).toBe(3);
		expect(fetchMock.mock.calls.every((c) => c[0].includes("/satellite/sentinel/"))).toBe(true);
		fetchMock.mockClear();
		await photoTiles(keys, D.id, "sentinel");
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("counts each tile by where it came from: disk, the Worker's cache (X-Cache HIT) or the source (MISS)", async () => {
		const C = region("c", -81.5076, 43.1226);
		await putRegion(C);
		let n = 0;
		fetchMock.mockImplementation(async () => ({ ok: true, status: 200, headers: new Headers({ "X-Cache": n++ % 3 ? "HIT" : "MISS" }), arrayBuffer: async () => new ArrayBuffer(7) }));
		const wire = { disk: 0, hit: 0, miss: 0, kept: true };
		await photoTiles(keysOf(C), C.id, "maptiler", wire);
		const fetched = fetchMock.mock.calls.length;
		expect(wire.disk).toBe(keysOf(C).length - fetched);
		expect(wire.miss).toBe(Math.ceil(fetched / 3));
		expect(wire.hit + wire.miss).toBe(fetched);
	});

	it("a photo for an area whose row is gone fetches, but lands no tile", async () => {
		const C = region("c", -81.5076, 43.1226);
		const before = await photoKeysOnDisk();
		await expect(photoTiles(keysOf(C), C.id)).rejects.toBeInstanceOf(AreaGone);
		expect(await photoKeysOnDisk()).toEqual(before);
	});
});
