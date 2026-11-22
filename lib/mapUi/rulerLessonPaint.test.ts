// The ruler lesson's "saved" beat shows what Save makes: on open ground a polygon is born a block
// (getCache v2Land bornGroundHere), so the lesson paints it as one, not as a bare piece.
import { describe, expect, it } from "vitest";
import { STROKE } from "$gc/drawDials";
import { SAVED_PAINT } from "./SnakeRuler.svelte";

const paint = new Map(SAVED_PAINT.map(([id, prop, v]) => [`${id}.${prop}`, v]));

describe("the ruler lesson saves a block", () => {
	it("outlines it in block gold at block width", () => {
		expect(paint.get("measure-line-casing.line-color")).toBe("#ffd700");
		expect(paint.get("measure-line-casing.line-width")).toBe(STROKE.block.line);
		expect(paint.get("measure-end-dots.circle-color")).toBe("#ffd700");
	});

	it("leaves the ground under it unshaded, as a block is", () => {
		expect(paint.get("measure-fill.fill-opacity")).toBe(0);
	});
});
