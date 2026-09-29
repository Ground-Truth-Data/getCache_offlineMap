/** THE DEDUPE AGREEMENT: the bake decides whether to skip a download, the sweep whether a photo was redundant — one predicate answers both, or the writer mints photos the sweeper calls waste. */
import { describe, expect, it } from "vitest";
import { photoReusableFor, PHOTO_REUSE_KM } from "./satelliteImage";

const AR: [number, number] = [-63.9235, -27.5171];
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
		// close enough on the ground, but the bake wants MapTiler, so it declines to reuse and bakes its own
		expect(photoReusableFor("USGS", AR, near(AR))).toBe(false);
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
