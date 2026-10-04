/** Which photo a new blob uses: the nearest existing photo CENTRE within the reuse radius, else its own. */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PHOTO_COVERAGE_RADIUS_KM, PHOTO_EDGE_MARGIN_KM, PHOTO_REUSE_KM, satImageKey } from "../../lib/onPhone/satellite/satelliteImage";
import { kmToDegSpan } from "../../lib/shared/kmGeo";
const dropped: string[] = [];
vi.mock("../../lib/onPhone/satellite/satelliteImage", async (orig) => ({
	...(await orig<typeof import("../../lib/onPhone/satellite/satelliteImage")>()),
	deleteSatImage: async (k: string) => {
		dropped.push(k);
	},
}));

import { setBudgetMb } from "./budget";
import { choosePhoto, deleteRegion, putRegion, type Region, regionId, wipe } from "./store";
import { regionRange } from "./tiles";

const LAT = 49.4991;
const LNG0 = -119.5937;
const kmEast = (km: number): [number, number] => [LNG0 + kmToDegSpan(km, LAT).dLng, LAT];

function born(at: [number, number], regions: Region[]): Region {
	const photo = choosePhoto(at, regions);
	return { id: regionId(...at), lng: at[0], lat: at[1], range: regionRange(...at), at: 1, tiles: 1, fetched: 1, bytes: 0, ms: 1, ...photo };
}

describe("the named radii", () => {
	it("reuse = coverage − margin", () => {
		expect(PHOTO_COVERAGE_RADIUS_KM).toBe(2);
		expect(PHOTO_EDGE_MARGIN_KM).toBe(1);
		expect(PHOTO_REUSE_KM).toBe(PHOTO_COVERAGE_RADIUS_KM - PHOTO_EDGE_MARGIN_KM);
	});
});

describe("choosePhoto", () => {
	it("the first pin takes its own photo, centred on itself", () => {
		const at = kmEast(0);
		expect(choosePhoto(at, [])).toEqual({ photoKey: satImageKey(at), photoCenter: at });
	});

	it("a 400 m chain never drifts: measured to the photo's centre, the 1.2 km pin bakes a new photo", () => {
		const regions: Region[] = [];
		const pins = [0, 0.4, 0.8, 1.2, 1.6].map(kmEast);
		for (const p of pins) regions.push(born(p, regions));
		const centres = regions.map((r) => r.photoCenter);
		// 0.4 and 0.8 km sit inside 1 km of the first photo's centre; 1.2 km does not, so it owns a photo
		expect(centres[1]).toEqual(pins[0]);
		expect(centres[2]).toEqual(pins[0]);
		expect(centres[3]).toEqual(pins[3]);
		// 1.6 km is 0.4 km from the 1.2 km photo (and 1.6 km from the first): the nearer centre wins
		expect(centres[4]).toEqual(pins[3]);
		expect(new Set(regions.map((r) => r.photoKey)).size).toBe(2);
	});

	it("a pin exactly at the reuse radius reuses; just past it bakes", () => {
		const first = born(kmEast(0), []);
		expect(choosePhoto(kmEast(PHOTO_REUSE_KM - 0.01), [first]).photoKey).toBe(first.photoKey);
		expect(choosePhoto(kmEast(PHOTO_REUSE_KM + 0.01), [first]).photoKey).not.toBe(first.photoKey);
	});

	it("a removed blob's photo is gone, so it is never reused", () => {
		const first = { ...born(kmEast(0), []), removed: 1 };
		const next = choosePhoto(kmEast(0.2), [first]);
		expect(next.photoKey).toBe(satImageKey(kmEast(0.2)));
	});

	it("a follow-me blob has no photo to offer", () => {
		const follow: Region = { ...born(kmEast(0), []), photoKey: undefined, photoCenter: undefined };
		expect(choosePhoto(kmEast(0.2), [follow]).photoKey).toBe(satImageKey(kmEast(0.2)));
	});
});

describe("deleting a blob whose photo another still uses", () => {
	beforeEach(async () => {
		await wipe();
		setBudgetMb(1024);
		dropped.length = 0;
	});

	it("the photo survives until its last user goes", async () => {
		const a = born(kmEast(0), []);
		const b = born(kmEast(0.5), [a]);
		expect(b.photoKey).toBe(a.photoKey);
		await putRegion(a);
		await putRegion(b);
		await deleteRegion(a.id);
		expect(dropped).toEqual([]);
		await deleteRegion(b.id);
		expect(dropped).toEqual([b.photoKey]);
	});
});
