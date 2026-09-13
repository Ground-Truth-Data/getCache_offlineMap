import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OVERLAYS SURVIVE THE QUARTER TURN.
 *
 * The landscape rig puts `.mobile-preview-screen` — rotated -90° — between the
 * phone frame and the page. Two whole classes of maths break silently on it,
 * and both shipped:
 *
 *   • `rect.width / offsetWidth` reads the element's ASPECT RATIO instead of
 *     its scale once turned, so anything sized by it came out ~2x too big;
 *   • a raw difference of two rects' `.left`/`.right` is a SCREEN-space
 *     distance, and turned, the screen's "right" is the page's "down" — the
 *     share quad drove out of its button and straight down the window.
 *
 * Neither showed up as an exception. They are arithmetic that stays finite and
 * plausible while describing the wrong axis, which is why they are pinned here
 * as source assertions rather than left to a rendering check.
 */
const read = (rel: string) =>
	readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const fcb = read("./fixedContainingBlock.ts");
const atv = read("./atvShare.ts");
const portal = read("./handPortal.ts");

describe("the scale survives a turn", () => {
	// hypot(a, b) is the x-axis scale of the accumulated matrix, which holds the
	// rotation and the scale separately. The rect ratio conflates them.
	it("derives scale from the matrix, not the rect's width", () => {
		expect(strip(fcb)).toMatch(/Math\.hypot\(\s*m\.a\s*,\s*m\.b\s*\)/);
	});

	// The fallback is still correct whenever nothing is rotated, so it stays —
	// but it must not be the primary answer.
	it("keeps the rect ratio only as a fallback", () => {
		const body = strip(fcb);
		const ratio = body.indexOf("r.width / el.offsetWidth");
		const matrix = body.indexOf("Math.hypot");
		expect(ratio).toBeGreaterThan(-1);
		expect(matrix).toBeGreaterThan(-1);
		expect(matrix).toBeLessThan(ratio);
	});
});

describe("a point conversion exists, because two axes cannot express a turn", () => {
	it("offers point() alongside the scalar x/y", () => {
		expect(strip(fcb)).toMatch(/point:\s*\(/);
		expect(strip(fcb)).toMatch(/\.inverse\(\)/);
	});
});

describe("the quad measures its runway in page axes", () => {
	// The exact shape that drove the quad downward: subtracting one rect's edge
	// from another's and calling the result a rightward distance.
	it("never subtracts one raw rect edge from another", () => {
		const body = strip(atv);
		expect(body).not.toMatch(
			/(hostRect|hr)\.(right|left)\s*-\s*(btnRect|br)\.(right|left)/,
		);
		expect(body).not.toMatch(
			/(btnRect|br)\.(top|bottom)\s*-\s*(hostRect|hr)\.(top|bottom)/,
		);
	});

	it("converts both corners before comparing them", () => {
		expect(strip(atv)).toMatch(/point\([^)]*\.right[^)]*\.bottom[^)]*\)/);
	});

	// Turned, the conversion can flip which end is larger, so the pair has to be
	// sorted rather than assumed to arrive in order.
	it("sorts the converted edges instead of trusting their order", () => {
		const body = strip(atv);
		expect(body).toMatch(/Math\.min\(/);
		expect(body).toMatch(/Math\.max\(/);
	});
});

describe("the overlay home follows the turn", () => {
	// The frame is not rotated and the screen inside it is, so an overlay given
	// the frame rides along an axis the page does not share.
	it("prefers the turned screen box over the frame that holds it", () => {
		const body = strip(portal);
		expect(body).toContain("mobile-preview-screen");
		const screen = body.indexOf("mobile-preview-screen");
		const frame = body.indexOf("mobile-preview-frame");
		expect(screen).toBeGreaterThan(-1);
		expect(frame).toBeGreaterThan(-1);
		expect(screen).toBeLessThan(frame);
	});
});

describe("the quad does not re-invent the conversion", () => {
	// overlayCoordLaw bans hand-rolled frame maths in ReTreever/src; atvShare
	// moved to rapper, out of that scan's reach, and promptly grew its own copy
	// back — which is the copy that broke on the turn.
	it("uses localFrom rather than its own scale", () => {
		const body = strip(atv);
		expect(body).toMatch(/localFrom\(/);
		expect(body).not.toMatch(/hr\.width\s*\/\s*home\.offsetWidth/);
	});
});
