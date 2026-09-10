import { describe, expect, it } from "vitest";
import {
	distanceKm,
	edgeMarginKm,
	FOLLOW_MARGIN_KM,
	marginKm,
	moved,
} from "./follow";
import { RADIUS_KM, rangeBox, regionRange } from "./tiles";

const PENTICTON: [number, number] = [-119.5937, 49.4991];

describe("follow-me margin", () => {
	it("a blob around the person leaves at least the radius on every side", () => {
		const box = rangeBox(regionRange(...PENTICTON));
		const m = marginKm(PENTICTON[0], PENTICTON[1], [box]);
		expect(m).toBeGreaterThanOrEqual(RADIUS_KM);
		expect(m).toBeLessThan(2 * RADIUS_KM);
	});

	it("is distance to the nearest EDGE, so a corner is not further than an edge", () => {
		const box = { w: -120, e: -119, s: 49, n: 50 };
		// 0.1° from the west edge with the south edge far away
		const edge = edgeMarginKm(-119.9, 49.1, { ...box, s: 0 });
		// 0.1° from both the west and south edges — the same margin, not less
		const corner = edgeMarginKm(-119.9, 49.1, box);
		expect(corner).toBeCloseTo(edge, 6);
	});

	it("is negative outside every blob and -Infinity with none", () => {
		const box = { w: -120, e: -119, s: 49, n: 50 };
		expect(edgeMarginKm(-118.9, 49.5, box)).toBeLessThan(0);
		expect(marginKm(0, 0, [])).toBe(Number.NEGATIVE_INFINITY);
	});

	it("the largest margin across blobs wins — doubling back stays deep inside an old blob", () => {
		const a = { w: -120, e: -119, s: 49, n: 50 };
		const b = { w: -119.05, e: -118, s: 49, n: 50 };
		// deep inside a, a hair inside b's west edge: a's margin is what counts
		const m = marginKm(-119.5, 49.5, [a, b]);
		expect(m).toBeCloseTo(edgeMarginKm(-119.5, 49.5, a), 6);
		expect(m).toBeGreaterThan(FOLLOW_MARGIN_KM);
	});

	it("walking toward an edge crosses the trigger line", () => {
		const box = rangeBox(regionRange(...PENTICTON));
		const inside = marginKm(PENTICTON[0], PENTICTON[1], [box]);
		expect(inside).toBeGreaterThan(FOLLOW_MARGIN_KM);
		// 5 km short of the east edge
		const cos = Math.cos((PENTICTON[1] * Math.PI) / 180);
		const lng = box.e - 5 / (cos * (40075.016686 / 360));
		expect(marginKm(lng, PENTICTON[1], [box])).toBeCloseTo(5, 0);
		expect(marginKm(lng, PENTICTON[1], [box])).toBeLessThanOrEqual(
			FOLLOW_MARGIN_KM,
		);
	});
});

describe("movement gate", () => {
	it("the first fix always counts; a shuffle does not; a kilometre does", () => {
		expect(moved(null, PENTICTON)).toBe(true);
		expect(moved(PENTICTON, [PENTICTON[0] + 0.001, PENTICTON[1]])).toBe(false);
		const km = distanceKm(PENTICTON, [PENTICTON[0], PENTICTON[1] + 0.01]);
		expect(km).toBeCloseTo(1.11, 1);
		expect(moved(PENTICTON, [PENTICTON[0], PENTICTON[1] + 0.01])).toBe(true);
	});
});
