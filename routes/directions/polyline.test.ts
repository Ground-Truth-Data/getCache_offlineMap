import { describe, expect, it } from "vitest";
import { decodePolyline } from "./polyline";

describe("decoding a router's polyline", () => {
	it("decodes the format's own worked example", () => {
		// From Google's encoded-polyline spec: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453).
		expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
			[-120.2, 38.5],
			[-120.95, 40.7],
			[-126.453, 43.252],
		]);
	});

	it("returns [lng, lat], not [lat, lng] — a swapped pair draws in the wrong hemisphere", () => {
		const [first] = decodePolyline("_p~iF~ps|U", 5);
		expect(first[0]).toBeLessThan(0); // longitude, western
		expect(first[1]).toBeGreaterThan(0); // latitude, northern
	});

	it("polyline6 carries the extra digit Mapbox sends", () => {
		const pts = decodePolyline("_izlhA~rlgdF", 6);
		expect(pts[0][1]).toBeCloseTo(38.5, 5);
		expect(pts[0][0]).toBeCloseTo(-120.2, 5);
	});

	it("walks a multi-point line, each pair relative to the last", () => {
		// Penticton and two points up the road from it.
		const pts = decodePolyline("w|dl}AfmlbcFgyg@vhK_ry@~oR", 6);
		expect(pts).toHaveLength(3);
		expect(pts[0][0]).toBeCloseTo(-119.5937, 5);
		expect(pts[0][1]).toBeCloseTo(49.4991, 5);
		expect(pts[2][0]).toBeCloseTo(-119.61, 5);
		expect(pts[2][1]).toBeCloseTo(49.55, 5);
	});

	it("an empty string is no line, not a crash", () => {
		expect(decodePolyline("", 6)).toEqual([]);
	});
});
