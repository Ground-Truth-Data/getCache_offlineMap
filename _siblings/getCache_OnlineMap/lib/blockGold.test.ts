// THE GOLD LAW — gold means BLOCK, and nothing else on the map may wear it.
//
// A block is not a new geometry or a new table: it is a polygon carrying a block
// number, which the BLOCK pill already persists into the geometry JSON. Its whole
// identity on the map is the colour, so the colour has to be unambiguous — the
// moment an ordinary polygon can come out gold, "gold = block" stops being
// readable and becomes a coincidence the user has to second-guess.
//
// The hazard is quiet: POLYGON_COLOR_CYCLE is a plain list someone will one day
// extend or re-order, and a yellow slipped back in reddens nothing — it just
// makes some unrelated overlapping polygon gold on a map where blocks also live.
// Hence a test on the cycle's CONTENTS, not on a rendered pixel.
//
// Tracks share the exact gold deliberately: a thin dashed line and a filled area
// never read as the same object.

import { describe, expect, it } from "vitest";
import {
	assignOverlapColors,
	BLOCK_GOLD,
	isBlockFeature,
	POLYGON_COLOR_CYCLE,
} from "./mapDraw";

// "Could this be mistaken for gold at a glance?" — a cycle colour needn't equal
// BLOCK_GOLD exactly to muddy the signal, so the law can't just compare strings.
//
// The test is HUE, because that is the axis the eye actually reads here. Per-channel
// thresholds and red:blue ratios both fail on this palette: the rust that opens the
// cycle (#e8a06a) and the yellow that was removed from it (#ecd36e) have nearly the
// same channel ratios, yet one is plainly gold and the other plainly is not. By hue
// they are 22° apart — gold 50.6°, the yellows 45–48°, rust 26° — with everything
// else past 100°. Anything in the yellow band with real saturation is gold enough.
function isGoldish(hex: string): boolean {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	const r = ((n >> 16) & 0xff) / 255;
	const g = ((n >> 8) & 0xff) / 255;
	const b = (n & 0xff) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	if (d < 0.15) return false; // washed out — no hue to speak of
	let hue: number;
	if (max === r) hue = ((g - b) / d) % 6;
	else if (max === g) hue = (b - r) / d + 2;
	else hue = (r - g) / d + 4;
	hue = (hue * 60 + 360) % 360;
	return hue >= 38 && hue <= 70;
}

function poly(coords: number[][], props: Record<string, unknown> = {}) {
	return {
		type: "Feature" as const,
		geometry: { type: "Polygon" as const, coordinates: [coords] },
		properties: props,
	};
}

const SQUARE = [
	[0, 0],
	[0, 1],
	[1, 1],
	[1, 0],
	[0, 0],
];
// Overlaps SQUARE by half.
const OVERLAP = [
	[0.5, 0],
	[0.5, 1],
	[1.5, 1],
	[1.5, 0],
	[0.5, 0],
];

describe("the gold law", () => {
	// Guards the guard: a heuristic that answers false for everything would let
	// the law above pass while protecting nothing.
	it("recognises gold and only gold", () => {
		expect(isGoldish(BLOCK_GOLD)).toBe(true);
		expect(isGoldish("#ecd36e")).toBe(true); // the yellow removed from the cycle
		expect(isGoldish("#e8a06a")).toBe(false); // rust — pale orange, not gold
		expect(isGoldish("#cf4444")).toBe(false);
	});

	it("keeps every ordinary polygon colour clear of gold", () => {
		for (const c of POLYGON_COLOR_CYCLE) {
			expect(isGoldish(c.fill), `fill ${c.fill} reads as gold`).toBe(false);
			expect(isGoldish(c.stroke), `stroke ${c.stroke} reads as gold`).toBe(
				false,
			);
		}
	});

	it("never hands a block an overlap-cycle colour", () => {
		const block = poly(SQUARE, { blockNumber: "A-704" });
		const plain = poly(OVERLAP);
		const colors = assignOverlapColors([block, plain]);
		expect(colors.get(0)).toBeUndefined();
	});

	// A block must not push the polygons it sits across along the rainbow —
	// otherwise tagging one shape silently recolours its neighbours.
	it("leaves ordinary polygons the colours they had before a block overlapped them", () => {
		const a = poly(SQUARE);
		const b = poly(OVERLAP);
		const before = assignOverlapColors([a, b]);
		const after = assignOverlapColors([
			poly(SQUARE, { blockNumber: "12" }),
			a,
			b,
		]);
		expect(after.get(2)).toEqual(before.get(1));
	});
});

describe("isBlockFeature", () => {
	it("requires a polygon AND a non-blank block number", () => {
		expect(isBlockFeature(poly(SQUARE, { blockNumber: "12" }))).toBe(true);
		expect(isBlockFeature(poly(SQUARE, { blockNumber: " " }))).toBe(false);
		expect(isBlockFeature(poly(SQUARE))).toBe(false);
		expect(
			isBlockFeature({
				type: "Feature",
				geometry: { type: "Point", coordinates: [0, 0] },
				properties: { blockNumber: "12" },
			}),
		).toBe(false);
	});

	it("pins the gold to one constant so tracks and blocks can't drift apart", () => {
		expect(BLOCK_GOLD).toBe("#ffd700");
	});
});

// THE STABLE-LAYOUT LAW — nothing the camera controls may reach the collision pass.
//
// Chips are placed by projecting each shape to a screen point and resolving
// overlaps. If any INPUT to that projection is derived from the camera — a lift
// that ramps with zoom, a size that scales — then every zoom frame hands the
// layout a different geometry, chips re-decide chip-vs-dot continuously, and the
// whole label set flutters. It looks like a render loop; it is actually the
// layout honestly answering a question that keeps changing.
//
// A zoom-derived chip lift shipped once and did exactly this. The fix was to make
// the lift constant, and the guard is: areaLabels must not read the zoom except
// to decide whether labels appear AT ALL (the boundary-pin handoff gate).
import { readFileSync } from "node:fs";

describe("the stable-layout law", () => {
	const src = readFileSync(new URL("./areaLabels.ts", import.meta.url), "utf8");

	it("keeps the chip gap a constant, never zoom-derived", () => {
		const gap = src.match(/const CHIP_GAP_PX\s*=\s*([\d.]+)/);
		expect(gap, "CHIP_GAP_PX must exist as a plain number").not.toBeNull();
		expect(Number(gap?.[1])).toBeGreaterThan(0);
		// No ramp function, no zoom interpolation feeding the offset.
		expect(src).not.toMatch(/function chipLift/);
		expect(src).not.toMatch(/CHIP_LIFT_MAX_PX/);
	});

	// A constant offset off the CENTROID cannot clear a shape whose on-screen
	// height grows with zoom — that is how the chip ended up back on the polygon
	// after the first fix. The chip hangs off the north edge instead.
	it("hangs the chip off the shape's north edge, not its centroid", () => {
		const code = src
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		const proj = code.match(/project:\s*\(a\)\s*=>\s*\{([\s\S]*?)\n\t\t\}/);
		expect(proj?.[1]).toMatch(/e\.anchor/);
		expect(proj?.[1]).not.toMatch(/e\.center/);
		// The anchor is the bbox's north edge (bbox[3] = maxLat).
		expect(code).toMatch(/anchor = \[\(bbox\[0\] \+ bbox\[2\]\) \/ 2, bbox\[3\]\]/);
	});

	// THE ONE-WRITER LAW. A mapboxgl.Marker's element is positioned by Mapbox on
	// every GL frame. Writing our own transform to that same element makes the two
	// writers fight and the label oscillates at frame rate — the map appears to
	// vibrate. Our offsets belong on the inner chip, in CSS.
	it("never writes a transform to the Mapbox-owned marker root", () => {
		const code = src
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		expect(code).not.toMatch(/\broot\.style\.transform\s*=/);
		// …and nothing may reach the root indirectly either.
		expect(code).not.toMatch(/getElement\(\)\.style\.transform\s*=/);
	});

	it("never lets the zoom reach the collision projection", () => {
		// Strip comments first — prose about zoom is fine and would otherwise make
		// this test a word-count of its own explanation.
		const code = src
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");

		// The camera is read exactly once, for the show/hide gate.
		expect(code.match(/getZoom\(\)/g)?.length ?? 0).toBe(1);

		// …and the body of project() must not mention it. project() is the layout's
		// only view of where a shape is; anything camera-derived in there is the
		// flutter bug returning.
		const proj = code.match(/project:\s*\(a\)\s*=>\s*\{([\s\S]*?)\n\t\t\}/);
		expect(proj, "project() not found — did its shape change?").not.toBeNull();
		expect(proj?.[1]).not.toMatch(/zoom/i);
	});
});
