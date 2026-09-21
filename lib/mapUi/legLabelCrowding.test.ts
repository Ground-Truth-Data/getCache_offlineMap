import { describe, expect, it } from "vitest";
import {
	LEG_LABEL_MIN_GAP_PX,
	legLabelsReadable,
} from "./legLabelCrowding";

describe("legLabelsReadable", () => {
	it("keeps labels that are comfortably apart", () => {
		expect(
			legLabelsReadable([
				{ x: 0, y: 0 },
				{ x: 200, y: 0 },
				{ x: 100, y: 180 },
			]),
		).toBe(true);
	});

	// The screenshot: a triangle zoomed out until its three leg labels pile up.
	it("hides ALL when any two collide, not just the offender", () => {
		expect(
			legLabelsReadable([
				{ x: 100, y: 100 },
				{ x: 108, y: 104 },
				{ x: 400, y: 400 },
			]),
		).toBe(false);
	});

	it("is exclusive at the threshold — exactly the gap still reads", () => {
		const gap = LEG_LABEL_MIN_GAP_PX;
		expect(legLabelsReadable([{ x: 0, y: 0 }, { x: gap, y: 0 }])).toBe(true);
		expect(
			legLabelsReadable([{ x: 0, y: 0 }, { x: gap - 0.01, y: 0 }]),
		).toBe(false);
	});

	it("measures diagonally, not per-axis", () => {
		// Each axis alone clears the bar; the true distance does not. An
		// axis-wise test would wrongly keep this pair.
		const axis = LEG_LABEL_MIN_GAP_PX * 0.9; // > bar on x, > bar on y
		expect(Math.hypot(axis, axis)).toBeGreaterThan(LEG_LABEL_MIN_GAP_PX);
		expect(legLabelsReadable([{ x: 0, y: 0 }, { x: axis, y: axis }])).toBe(
			true,
		);
		const tight = LEG_LABEL_MIN_GAP_PX * 0.6; // hypot ≈ 0.85 × bar
		expect(legLabelsReadable([{ x: 0, y: 0 }, { x: tight, y: tight }])).toBe(
			false,
		);
	});

	it("treats an unplaceable label as crowded, never as far away", () => {
		expect(
			legLabelsReadable([{ x: 0, y: 0 }, { x: Number.NaN, y: 500 }]),
		).toBe(false);
		expect(
			legLabelsReadable([
				{ x: 0, y: 0 },
				{ x: Number.POSITIVE_INFINITY, y: 0 },
			]),
		).toBe(false);
	});

	it("a single label and an empty set are always readable", () => {
		expect(legLabelsReadable([])).toBe(true);
		expect(legLabelsReadable([{ x: 5, y: 5 }])).toBe(true);
	});

	it("honours a caller-supplied gap", () => {
		const pts = [{ x: 0, y: 0 }, { x: 50, y: 0 }];
		expect(legLabelsReadable(pts, 40)).toBe(true);
		expect(legLabelsReadable(pts, 80)).toBe(false);
	});
});
