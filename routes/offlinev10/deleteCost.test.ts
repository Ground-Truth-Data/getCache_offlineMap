/** Photo keys are tiled only where tiles can be: on 10 Nov /app/inbox froze for 8 s and the offline map stuttered
 * through 200 MB bursts, each delete and each size check tiling every held piece at z18 for every source. */
import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";

const covered: string[] = [];
const zooms: number[] = [];
vi.mock("../../lib/onPhone/satellite/satelliteImage", async (real) => {
	const m = await real<typeof import("../../lib/onPhone/satellite/satelliteImage")>();
	return {
		...m,
		pieceTileKeys: (rings: [number, number][][], z: number) => {
			covered.push(rings[0]![0]!.join(","));
			zooms.push(z);
			return m.pieceTileKeys(rings, z);
		},
	};
});

const { pieceKey } = await import("../../lib/onPhone/satellite/satelliteImage");
const { deleteRegion, photoTileBytes, putPhotoTiles, putRegion, wipe } = await import("./store");
const { setBudgetMb } = await import("./budget");
const { regionRange } = await import("./tiles");
type Region = import("./store").Region;

function piece(id: string, lng: number, lat: number, d = 0.006): Region {
	const ring: [number, number][] = [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]];
	return { id, lng, lat, range: regionRange(lng, lat), at: 1, tiles: 1, fetched: 1, bytes: 0, ms: 1, photoKey: pieceKey([ring]), photoRings: [ring] };
}

const GONE = piece("gone", 146.8, -19.26);
const NEAR = piece("near", 146.803, -19.257);
const FAR = Array.from({ length: 40 }, (_, i) => piece(`far${i}`, 140 + i * 0.5, -25));

beforeEach(async () => {
	await wipe();
	setBudgetMb(1024);
	for (const r of [GONE, NEAR, ...FAR]) await putRegion(r);
	await putPhotoTiles([["16/1/1", new ArrayBuffer(10)]], GONE.id, "maptiler");
	covered.length = 0;
	zooms.length = 0;
});

it("sizing photos tiles only for a source with tiles on disk", async () => {
	await photoTileBytes([GONE, NEAR, ...FAR]);
	expect(new Set(zooms)).toEqual(new Set([16]));
});

it("a delete never tiles a piece far from it", async () => {
	await deleteRegion(GONE.id);
	const far = new Set(FAR.map((r) => r.photoRings![0]![0]!.join(",")));
	expect(covered.filter((c) => far.has(c))).toEqual([]);
	expect(new Set(covered)).toEqual(new Set([GONE, NEAR].map((r) => r.photoRings![0]![0]!.join(","))));
});
