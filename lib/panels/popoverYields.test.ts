/**
 * An in-progress shape is painted INTO the map canvas and a popover is DOM
 * above it, so no z-index can put the card behind the shape: the card must go
 * translucent and tap-through while a draw is live.
 */
import { describe, expect, it } from "vitest";
import { YIELD_OPACITY, yieldStyle } from "./popoverYield";

describe("while a draw is live", () => {
	it("goes translucent enough to read a shape through", () => {
		const s = yieldStyle(true);
		expect(s.opacity).toBe(YIELD_OPACITY);
		expect(YIELD_OPACITY).toBeLessThan(0.5);
	});

	it("stops taking taps, so a vertex can be placed through it", () => {
		expect(yieldStyle(true).pointerEvents).toBe("none");
	});

	it("is still rendered — the buttons come back the moment the draw ends", () => {
		// Not `display:none` and not unmounted: an unmounted card loses its
		// scroll position and its pending edits.
		expect(yieldStyle(true).opacity).toBeGreaterThan(0);
	});
});

describe("while nothing is being drawn", () => {
	it("is fully opaque", () => {
		expect(yieldStyle(false).opacity).toBe(1);
	});

	it("takes taps normally", () => {
		// Empty, not "auto": the shell's pass-through logic writes this too.
		expect(yieldStyle(false).pointerEvents).toBe("");
	});
});

describe("the tap-outside pass-through cannot cancel the yield", () => {
	// Tap-outside-to-dismiss is a second pointer-events writer; restoring ""
	// mid-draw would hand the card back the draw's taps.
	const restored = (passthroughOn: boolean, drawLive: boolean) =>
		passthroughOn || drawLive ? "none" : "";

	it("stays transparent after a gesture ends, while drawing", () => {
		expect(restored(false, true)).toBe("none");
	});

	it("restores normally after a gesture ends, when not drawing", () => {
		expect(restored(false, false)).toBe("");
	});

	it("agrees with yieldStyle about what drawing means", () => {
		expect(restored(false, true)).toBe(yieldStyle(true).pointerEvents);
		expect(restored(false, false)).toBe(yieldStyle(false).pointerEvents);
	});
});

describe("the style is expressible as a CSS declaration", () => {
	it("renders both properties when yielding", () => {
		expect(yieldStyle(true).css).toBe(
			`opacity:${YIELD_OPACITY};pointer-events:none`,
		);
	});

	it("renders nothing when not yielding, so it never fights other styles", () => {
		expect(yieldStyle(false).css).toBe("");
	});
});
