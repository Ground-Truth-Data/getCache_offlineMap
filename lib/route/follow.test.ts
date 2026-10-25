import { describe, expect, it } from "vitest";
import type { LngLat } from "../shared/kmGeo";
import { courseDeg, metresAlong, progressOn } from "./follow";

// ~111 m per 0.001° of latitude; longitude shrinks by cos(-13.8°) ≈ 0.97.
const O: LngLat = [136.8, -13.8];
const east = (m: number, north = 0): LngLat => [O[0] + m / (111_320 * 0.9711), O[1] + north / 111_320];

describe("progressOn", () => {
	const line = [east(0), east(1000), east(2000)];
	const along = metresAlong(line);

	it("snaps a fix beside the road onto it and counts what is left", () => {
		const p = progressOn(line, along, east(1500, 20));
		expect(p.offM).toBeCloseTo(20, 0);
		expect(p.toGoM).toBeCloseTo(500, -1);
		expect(p.index).toBe(1);
	});

	it("keeps going forward on an out-and-back spur", () => {
		// Out 500 m north to a waypoint and back down the same road.
		const spur = [east(0), east(0, 500), east(0), east(1000)];
		const sAlong = metresAlong(spur);
		const fix = east(0, 200);
		expect(progressOn(spur, sAlong, fix, 0).index).toBe(0);
		expect(progressOn(spur, sAlong, fix, 1).index).toBe(1);
		expect(progressOn(spur, sAlong, fix, 1).toGoM).toBeCloseTo(1200, -1);
	});
});

describe("courseDeg", () => {
	it("reads north as 0 and east as 90", () => {
		expect(courseDeg(east(0), east(0, 100))).toBeCloseTo(0, 0);
		expect(courseDeg(east(0), east(100))).toBeCloseTo(90, 0);
	});

	it("holds when the truck has barely moved", () => {
		expect(courseDeg(east(0), east(2))).toBeNull();
	});
});
