/** A piece's held photo tiles outlive every delete but its own blob's, and a wipe of the tile store takes the photo
 * records with it: a record left behind says "baked" over ground with no tiles, and the pass never bakes it again. */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { BAKE_VERSION, getSatImageByKey, pieceKey, pieceTileKeys } from "../../lib/onPhone/satellite/satelliteImage";
import { makeKeyedIdbStore } from "../../lib/onPhone/store/keyedIdbStore";
import { setBudgetMb } from "./budget";
import { allTileKeys, deleteRegion, PHOTO_PREFIX, putPhotoTiles, putRegion, type Region, wipe } from "./store";
import { regionRange } from "./tiles";

const records = makeKeyedIdbStore<object>({ dbName: "gc-offlineSatellite", storeName: "photoDiscs" });

function piece(id: string, lng: number, lat: number, d = 0.006): Region {
	const ring: [number, number][] = [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]];
	return { id, lng, lat, range: regionRange(lng, lat), at: 1, tiles: 1, fetched: 1, bytes: 0, ms: 1, photoKey: pieceKey([ring]), photoRings: [ring] };
}
const keysOf = (r: Region) => pieceTileKeys(r.photoRings!, 16);

async function bake(r: Region): Promise<void> {
	await putRegion(r);
	await putPhotoTiles(keysOf(r).map((k) => [k, new ArrayBuffer(10)]), r.id, "maptiler");
	await records.put(r.photoKey!, { bakeVersion: BAKE_VERSION, source: "MapTiler", zoom: 16, ms: 1 });
}
const held = async (r: Region) => {
	const all = await allTileKeys();
	return keysOf(r).filter((k) => !all.has(`${PHOTO_PREFIX}maptiler/${k}`));
};

// Townsville: a piece, a neighbour that overlaps it, and one well clear of it.
const P = piece("p", 146.8, -19.26);
const SHARES = piece("shares", 146.803, -19.257);
const CLEAR = piece("clear", 146.9, -19.3);

beforeEach(async () => {
	await wipe();
	setBudgetMb(1024);
	for (const r of [P, SHARES, CLEAR]) await bake(r);
});

describe("a piece keeps its photo tiles", () => {
	it("the neighbours share tiles with it, or none", () => {
		const mine = new Set(keysOf(P));
		expect(keysOf(SHARES).some((k) => mine.has(k))).toBe(true);
		expect(keysOf(CLEAR).some((k) => mine.has(k))).toBe(false);
	});

	it("through a neighbour's delete and an eviction, shared tiles or not", async () => {
		await deleteRegion(CLEAR.id);
		expect(await held(P)).toEqual([]);
		// An eviction keeps the row, marked removed.
		await deleteRegion(SHARES.id, true);
		expect(await held(P)).toEqual([]);
		expect(await getSatImageByKey(P.photoKey!)).toBeDefined();
	});

	it("a wipe of the tile store takes every photo record too, so the next pass bakes again", async () => {
		await wipe();
		expect(await held(P)).toEqual(keysOf(P));
		expect(await getSatImageByKey(P.photoKey!)).toBeUndefined();
	});
});
