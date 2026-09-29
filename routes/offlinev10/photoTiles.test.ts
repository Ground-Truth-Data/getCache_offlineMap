/** The close-up's raw tiles live in the road store: a deleted blob takes the ones no other pin's disc still covers. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { photoTilesFor } from "../../lib/onPhone/satellite/satelliteImage";
import { PHOTO_SOURCES } from "../../lib/onPhone/satellite/photoSources";
import { configureTilesDevHost } from "../../lib/worker/worker-local-dev/tilesHost";
import { setBudgetMb } from "./budget";
import { photoTiles } from "./satellite";
import { allTileKeys, deleteRegion, PHOTO_PREFIX, photoTileBytes, putPhotoTiles, putRegion, type Region, wipe } from "./store";
import { regionRange } from "./tiles";

vi.mock("./blobService", () => ({ onBlob: () => () => undefined }));
configureTilesDevHost("https://tiles.test");

const Z = PHOTO_SOURCES[0].zoom;

function region(id: string, lng: number, lat: number): Region {
	return { id, lng, lat, range: regionRange(lng, lat), at: 1, tiles: 1, fetched: 1, bytes: 0, ms: 1 };
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
		await putPhotoTiles(keysOf(r).map((k) => [k, new ArrayBuffer(10)]));
	}
});

describe("photo close-up tiles", () => {
	it("counts each blob's tiles, shared ones for both", async () => {
		const sized = await photoTileBytes([A, B]);
		expect(sized.get("a")).toEqual({ tiles: keysOf(A).length, bytes: keysOf(A).length * 10 });
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
		const follow = { ...region("f", -81.5076, 43.1136), photo: false as const };
		await putRegion(follow);
		await deleteRegion("f");
		expect((await photoKeysOnDisk()).length).toBe(new Set([...keysOf(A), ...keysOf(B)]).size);
	});
});

/** The Worker's POST /satellite answer for these keys: every tile 7 bytes. */
function pack(keys: number[][]): ArrayBuffer {
	const manifest = new TextEncoder().encode(JSON.stringify({ tiles: keys.map(([z, x, y]) => ({ k: `${z}/${x}/${y}`, n: 7 })) }));
	const out = new Uint8Array(4 + manifest.length + keys.length * 7);
	new DataView(out.buffer).setUint32(0, manifest.length, true);
	out.set(manifest, 4);
	return out.buffer;
}

describe("what a photo's tiles cost on the wire", () => {
	const fetchMock = vi.fn(async (_url: string, init: { body: string }) => ({
		ok: true,
		arrayBuffer: async () => pack(JSON.parse(init.body)),
	}));
	beforeEach(() => {
		fetchMock.mockClear();
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it("a disc already on disk costs zero requests", async () => {
		const got = await photoTiles(keysOf(A));
		expect(fetchMock).not.toHaveBeenCalled();
		expect(got.size).toBe(keysOf(A).length);
	});

	it("an overlapping disc fetches only its missing tiles, in one request, and keeps them", async () => {
		const C = region("c", -81.5076, 43.1226);
		const onDisk = new Set([...keysOf(A), ...keysOf(B)]);
		const missing = keysOf(C).filter((k) => !onDisk.has(k));
		expect(missing.length).toBeGreaterThan(0);
		expect(missing.length).toBeLessThan(keysOf(C).length);

		const got = await photoTiles(keysOf(C));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body).map((k: number[]) => k.join("/"))).toEqual(missing);
		expect(got.size).toBe(keysOf(C).length);

		fetchMock.mockClear();
		await photoTiles(keysOf(C));
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
