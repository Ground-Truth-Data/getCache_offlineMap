/**
 * A POPOVER MUST YIELD TO THE WORK UNDERNEATH IT.
 *
 * An in-progress shape — the Snake Ruler's polygon before it is saved — is
 * painted INTO the map canvas. A popover is a DOM card above that canvas, so
 * no z-index ordering can ever put the card behind the shape: the card is
 * opaque over the work, always, by construction. The only cure is for the card
 * to stop being opaque while a draw is live.
 *
 * `yieldStyle` is the whole decision, kept pure so it is testable without a
 * browser. The shell applies it; these tests pin what it must produce.
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
		// Empty, not "auto": the shell's own pass-through logic sets this
		// property directly, and hardcoding "auto" here would fight it.
		expect(yieldStyle(false).pointerEvents).toBe("");
	});
});

describe("the tap-outside pass-through cannot cancel the yield", () => {
	/**
	 * The shell has a SECOND writer of pointer-events: tap-outside-to-dismiss
	 * sets the surface transparent for a gesture starting outside it, then
	 * restores "" on pointerup. Restoring while a draw is live would hand the
	 * card back the taps the draw needs — the first tap anywhere on the map
	 * would silently re-arm it. Both writers must agree, so the restore is
	 * `on || drawLive`, not `on`.
	 */
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
