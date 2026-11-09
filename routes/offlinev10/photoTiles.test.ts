/** A held area's satellite tiles live in the road store, keyed by source; every one the phone lacks comes through the
 * tiles Worker's /satellite route, which honours Squirrel's switches, and a deleted blob takes the ones no other
 * area still covers. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SATELLITE_SOURCES } from "../../lib/contract/satelliteSources";
import { coverTiles, getSatImageByKey, pieceKey, pieceTileKeys } from "../../lib/onPhone/satellite/satelliteImage";
import { piecesOf } from "../../lib/shared/anchors";
import { configureTilesDevHost } from "../../lib/worker/tilesHost";
import { setBudgetMb } from "./budget";
import { bakePhotos, photoTiles } from "./satellite";
import { AreaGone, allTileKeys, deleteRegion, PHOTO_PREFIX, photoTileBytes, putPhotoTiles, putRegion, type Region, wipe } from "./store";
import { regionRange } from "./tiles";

vi.mock("./blobService", () => ({ onBlob: () => () => undefined, photoIds: () => ({ has: () => true }) }));
const HOST = "https://tiles.test";
configureTilesDevHost(HOST);

function region(id: string, lng: number, lat: number): Region {
	const ring: [number, number][] = [[lng, lat], [lng + 0.02, lat], [lng + 0.02, lat + 0.012], [lng, lat + 0.012], [lng, lat]];
	return { id, lng, lat, range: regionRange(lng, lat), at: 1, tiles: 1, fetched: 1, bytes: 0, ms: 1, photoKey: pieceKey([ring]), photoRings: [ring] };
}

const keysOf = (r: Region, z: number = SATELLITE_SOURCES.maptiler.zoom) => pieceTileKeys(r.photoRings!, z);
const onDisk = async () => [...(await allTileKeys())].filter((k) => k.startsWith(PHOTO_PREFIX));

// Ailsa Craig, and a piece 1 km east: the two overlap.
const A = region("a", -81.5076, 43.1136);
const B = region("b", -81.4953, 43.1136);

beforeEach(async () => {
	await wipe();
	setBudgetMb(1024);
	for (const r of [A, B]) {
		await putRegion(r);
		await putPhotoTiles(keysOf(r).map((k) => [k, new ArrayBuffer(10)]), r.id, "maptiler");
	}
});

describe("an area's tiles on disk", () => {
	it("counts each blob's tiles, shared ones for both", async () => {
		const sized = await photoTileBytes([A, B]);
		expect(sized.get("a")).toMatchObject({ tiles: keysOf(A).length, bytes: keysOf(A).length * 10 });
		expect(sized.get("b")?.tiles).toBe(keysOf(B).length);
	});

	it("deleting one blob keeps the tiles the other area still covers", async () => {
		await deleteRegion("a");
		const left = new Set(await onDisk());
		expect(left).toEqual(new Set(keysOf(B).map((k) => `${PHOTO_PREFIX}maptiler/${k}`)));
	});

	it("deleting the last blob leaves no satellite tile behind, whatever its source", async () => {
		await putPhotoTiles(keysOf(A, 14).map((k) => [k, new ArrayBuffer(10)]), A.id, "sentinel");
		await deleteRegion("a");
		await deleteRegion("b");
		expect(await onDisk()).toEqual([]);
	});

	it("a pin's blob has no piece, so deleting it touches none", async () => {
		const follow = { ...region("f", -81.5076, 43.1136), photoKey: undefined, photoRings: undefined };
		await putRegion(follow);
		await deleteRegion("f");
		expect((await onDisk()).length).toBe(new Set([...keysOf(A), ...keysOf(B)]).size);
	});
});

describe("what an area's tiles cost on the wire", () => {
	// The Worker's /satellite/{source}/{z}/{x}/{y}.jpg: every tile 7 bytes.
	const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(7) }));
	beforeEach(() => {
		fetchMock.mockClear();
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it("an area already on disk costs zero requests", async () => {
		const got = await photoTiles(keysOf(A), A.id);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(got.size).toBe(keysOf(A).length);
	});

	it("an overlapping area fetches only its missing tiles, once each, and keeps them", async () => {
		const C = region("c", -81.5076, 43.1226);
		const held = new Set([...keysOf(A), ...keysOf(B)]);
		const missing = keysOf(C).filter((k) => !held.has(k));
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

	it("another source's tiles come from its own route and are kept under it", async () => {
		const D = region("d", -70.1, 46.2);
		await putRegion(D);
		const keys = keysOf(D, 14).slice(0, 3);
		expect((await photoTiles(keys, D.id, "sentinel")).size).toBe(3);
		expect(fetchMock.mock.calls.every((c) => c[0].includes("/satellite/sentinel/"))).toBe(true);
		fetchMock.mockClear();
		await photoTiles(keys, D.id, "sentinel");
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await onDisk()).toEqual(expect.arrayContaining(keys.map((k) => `${PHOTO_PREFIX}sentinel/${k}`)));
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

	it("ten fresh photo areas in an hour (5,200 tiles) never trip a breaker, and a bake and a pack still go after", async () => {
		const F = region("f", -60.1, 47.2);
		await putRegion(F);
		for (let bake = 0; bake < 10; bake++) {
			const keys = Array.from({ length: 520 }, (_, i) => `17/${bake * 1000 + i}/0`);
			await expect(photoTiles(keys, F.id)).resolves.toBeInstanceOf(Map);
		}
		const g = await import("../../lib/onPhone/store/downloadGuard");
		expect(() => g.guardBakeGrid(520, {})).not.toThrow();
		expect(() => g.guardPackDownload({})).not.toThrow();
	});

	it("an area whose row is gone fetches, but lands no tile", async () => {
		const C = region("c", -81.5076, 43.1226);
		const before = await onDisk();
		await expect(photoTiles(keysOf(C), C.id)).rejects.toBeInstanceOf(AreaGone);
		expect(await onDisk()).toEqual(before);
	});
});

describe("Squirrel's switch decides every tile", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("the pass asks the Worker which source is on, then fetches every tile at that source's zoom and no coarser, through its /satellite route", async () => {
		const E = region("e", -95.1, 55.3);
		await putRegion(E);
		const urls: string[] = [];
		vi.stubGlobal("fetch", vi.fn(async (url: string) => {
			urls.push(url);
			if (url === `${HOST}/squirrel/active`) return new Response(JSON.stringify({ active: "sentinel", cache: { sentinel: false } }));
			return { ok: true, status: 200, headers: new Headers({ "X-Cache": "MISS" }), arrayBuffer: async () => new ArrayBuffer(7) };
		}));
		expect(await bakePhotos([{ id: E.id, photoKey: E.photoKey!, rings: E.photoRings! }])).toBe(1);

		const [first, ...tiles] = urls;
		expect(first).toBe(`${HOST}/squirrel/active`);
		const zooms = new Set(tiles.map((u) => Number(new RegExp(`^${HOST}/satellite/sentinel/(\\d+)/\\d+/\\d+\\.jpg$`).exec(u)?.[1])));
		expect([...zooms]).toEqual([14]);
		expect(tiles).toHaveLength(keysOf(E, 14).length);
		// Counted as Squirrel counts it: every tile a miss the Worker was told not to keep.
		expect((await getSatImageByKey(E.photoKey!))?.wire).toEqual({ disk: 0, hit: 0, miss: tiles.length, tiles: tiles.length, bytes: 7 * tiles.length, kept: false });
	});

	it("a 12-piece shape on ten blobs holds every piece's cover tiles at its source's zoom, and none coarser", async () => {
		// 0.03° apart: each piece owns its tiles, so a dropped ring shows.
		const parts = Array.from({ length: 12 }, (_, i): [number, number][][] => {
			const x = -76.2 + i * 0.03;
			return [[[x, 45.07], [x + 0.002, 45.07], [x + 0.002, 45.0715], [x, 45.07]]];
		});
		const blobs = piecesOf({ type: "MultiPolygon", coordinates: parts }).map((p, i) => ({ id: `twelve-${i}`, photoKey: pieceKey(p.rings), rings: p.rings }));
		expect(blobs).toHaveLength(10);
		for (const b of blobs) await putRegion({ ...region(b.id, ...b.rings[0]![0]!), photoKey: b.photoKey, photoRings: b.rings });
		vi.stubGlobal("fetch", vi.fn(async (url: string) =>
			url === `${HOST}/squirrel/active`
				? new Response(JSON.stringify({ active: "sentinel", cache: { sentinel: false } }))
				: { ok: true, status: 200, headers: new Headers({ "X-Cache": "MISS" }), arrayBuffer: async () => new ArrayBuffer(7) }));
		await bakePhotos(blobs);

		const held = new Set(await onDisk());
		const zoom = SATELLITE_SOURCES.sentinel.zoom;
		const short = parts.flatMap(([ring], i) =>
			coverTiles(ring!, zoom).map((t) => `${PHOTO_PREFIX}sentinel/${zoom}/${t.x}/${t.y}`).filter((k) => !held.has(k)).map((k) => `part ${i + 1}: ${k}`));
		expect(short).toEqual([]);
		const baked = [...held].filter((k) => !k.startsWith(`${PHOTO_PREFIX}maptiler/`));
		expect(baked.filter((k) => !k.startsWith(`${PHOTO_PREFIX}sentinel/${zoom}/`))).toEqual([]);
	});
});
