import { describe, expect, it } from "vitest";
import {
	LEG_LABEL_MIN_GAP_PX,
	LEG_LABEL_MIN_LEG_PX,
	keptLegLabels,
} from "./legLabelCrowding";

const long = LEG_LABEL_MIN_LEG_PX * 4;

describe("keptLegLabels", () => {
	it("keeps labels that are comfortably apart", () => {
		expect(
			keptLegLabels([
				{ x: 0, y: 0, legPx: long },
				{ x: 200, y: 0, legPx: long },
				{ x: 100, y: 180, legPx: long },
			]),
		).toEqual([true, true, true]);
	});

	// Two nodes dropped close together: only that leg loses its label.
	it("drops the shorter leg of a colliding pair, keeps the rest", () => {
		expect(
			keptLegLabels([
				{ x: 100, y: 100, legPx: long },
				{ x: 108, y: 104, legPx: long / 2 },
				{ x: 400, y: 400, legPx: long },
			]),
		).toEqual([true, false, true]);
	});

	it("hides a leg too short to carry its label, whatever its neighbours", () => {
		expect(
			keptLegLabels([
				{ x: 0, y: 0, legPx: long },
				{ x: 300, y: 0, legPx: LEG_LABEL_MIN_LEG_PX - 1 },
			]),
		).toEqual([true, false]);
	});

	it("is exclusive at the gap — exactly the gap still reads", () => {
		const gap = LEG_LABEL_MIN_GAP_PX;
		expect(
			keptLegLabels([{ x: 0, y: 0, legPx: long }, { x: gap, y: 0, legPx: long }]),
		).toEqual([true, true]);
		expect(
			keptLegLabels([{ x: 0, y: 0, legPx: long }, { x: gap - 0.01, y: 0, legPx: long - 1 }]),
		).toEqual([true, false]);
	});

	it("measures diagonally, not per-axis", () => {
		const axis = LEG_LABEL_MIN_GAP_PX * 0.9;
		expect(
			keptLegLabels([{ x: 0, y: 0, legPx: long }, { x: axis, y: axis, legPx: long }]),
		).toEqual([true, true]);
		const tight = LEG_LABEL_MIN_GAP_PX * 0.6;
		expect(
			keptLegLabels([{ x: 0, y: 0, legPx: long }, { x: tight, y: tight, legPx: long - 1 }]),
		).toEqual([true, false]);
	});

	it("treats an unplaceable label as hidden, never as far away", () => {
		expect(
			keptLegLabels([{ x: 0, y: 0, legPx: long }, { x: Number.NaN, y: 500, legPx: long }]),
		).toEqual([true, false]);
	});

	it("a single label and an empty set are kept", () => {
		expect(keptLegLabels([])).toEqual([]);
		expect(keptLegLabels([{ x: 5, y: 5, legPx: long }])).toEqual([true]);
	});

	it("honours a caller-supplied gap", () => {
		const pts = [{ x: 0, y: 0, legPx: long }, { x: 50, y: 0, legPx: long - 1 }];
		expect(keptLegLabels(pts, 40)).toEqual([true, true]);
		expect(keptLegLabels(pts, 80)).toEqual([true, false]);
	});
});
