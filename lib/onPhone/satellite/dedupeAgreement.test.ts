/**
 * THE DEDUPE AGREEMENT. The bake decides whether to skip a download; the sweep
 * decides whether a photo was redundant. One predicate answers both, or the
 * writer mints photos the sweeper calls waste and `tidy N dupes` never reaches
 * zero however often it is pressed.
 */
import { describe, expect, it } from "vitest";
import { isBestPhotoSource } from "./photoSources";
import { photoReusableFor, PHOTO_REUSE_KM } from "./satelliteImage";

/** Argentina — outside every USGS box, so the world rows serve it. */
const AR: [number, number] = [-63.9235, -27.5171];
/** Montana — inside the USGS lower-48 box, so USGS wins and the others are beaten. */
const US: [number, number] = [-110.0, 46.0];
/** ~300 m east: inside PHOTO_REUSE_KM of its neighbour. */
const near = ([lng, lat]: [number, number]): [number, number] => [
	lng + 0.003,
	lat,
];

describe("THE DEDUPE AGREEMENT", () => {
	it("refuses a photo too far away however good its source", () => {
		const far: [number, number] = [AR[0] + 0.5, AR[1]];
		expect(photoReusableFor("MapTiler", AR, far)).toBe(false);
	});

	it("refuses a near photo whose source has been beaten", () => {
		// The case that generated the dupes: close enough on the ground, but the
		// bake wants USGS here, so it declines to reuse and bakes its own.
		expect(isBestPhotoSource("MapTiler", US[0], US[1])).toBe(false);
		expect(photoReusableFor("MapTiler", US, near(US))).toBe(false);
	});

	it("reuses a near photo from the best source", () => {
		expect(photoReusableFor("MapTiler", AR, near(AR))).toBe(true);
	});

	it("never counts an unnamed photo as reusable", () => {
		// A photo predating the source registry cannot be shown to be current.
		expect(photoReusableFor(undefined, AR, near(AR))).toBe(false);
	});

	it("is the ONLY reuse radius — a second copy would drift", () => {
		expect(PHOTO_REUSE_KM).toBe(1);
	});
});
