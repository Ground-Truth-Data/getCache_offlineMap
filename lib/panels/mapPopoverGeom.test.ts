import { describe, expect, it } from "vitest";
import { leaderLine, MIN_OPEN, type PlaceInput, placePopover } from "./mapPopoverGeom";

// Chrome reserves, mirroring MapPopoverShell's.
const TOP = 150;
const BOTTOM = 95;
const PAD = 8;

// A phone-shaped map container.
const W = 390;
const H = 800;

function place(over: Partial<PlaceInput> = {}) {
	return placePopover({
		bbox: { minX: 180, maxX: 210, minY: 260, maxY: 300 },
		containerWidth: W,
		containerHeight: H,
		isPoint: true,
		wide: false,
		topReserve: TOP,
		bottomReserve: BOTTOM,
		...over,
	});
}

/** A pin's bbox: bottom-anchored icon, inflated up by PIN_H and out by HALF_W. */
function pinAt(y: number) {
	return { minX: 180, maxX: 210, minY: y - 40, maxY: y };
}

describe("placePopover — open where there is room, never squeezed", () => {
	it("opens BELOW a pin up top", () => {
		const p = place({ bbox: pinAt(240) });
		expect(p.side).toBe("below");
		expect(p.edge).toBeGreaterThan(240);
		expect(p.edge + p.maxH).toBe(H - BOTTOM);
	});

	it("hangs ABOVE a pin near the bottom, its bottom edge at the pin, never over it", () => {
		const bbox = pinAt(700);
		const p = place({ bbox });
		expect(p.side).toBe("above");
		expect(p.edge).toBeLessThanOrEqual(bbox.minY);
	});

	it("is never shorter than its minimum, wherever the pin is", () => {
		for (let y = TOP; y < H - BOTTOM; y += 25) expect(place({ bbox: pinAt(y) }).maxH).toBeGreaterThanOrEqual(MIN_OPEN);
	});

	it("climbs into the top reserve only when it needs the room, and never off the screen", () => {
		for (let y = TOP; y < H - BOTTOM; y += 25) {
			const p = place({ bbox: pinAt(y) });
			if (p.side !== "above") continue;
			const reach = p.edge - p.maxH;
			expect(reach).toBeGreaterThanOrEqual(PAD);
			if (p.edge - TOP >= MIN_OPEN) expect(reach).toBe(TOP);
		}
	});

	it("never covers the pin it belongs to while one side has room", () => {
		const GAP = 33;
		for (let y = TOP; y < H - BOTTOM; y += 25) {
			const bbox = pinAt(y);
			if (Math.max(H - BOTTOM - (bbox.maxY + GAP), bbox.minY - GAP - PAD) < MIN_OPEN) continue;
			const p = place({ bbox });
			if (p.side === "above") expect(p.edge).toBeLessThanOrEqual(bbox.minY);
			else expect(p.edge).toBeGreaterThanOrEqual(bbox.maxY);
		}
	});

	it("treats points and polygons the same way at the same anchor", () => {
		const bbox = pinAt(700);
		expect(place({ bbox, isPoint: true }).side).toBe(place({ bbox, isPoint: false }).side);
	});
});

describe("placePopover — horizontal placement", () => {
	it("centres on the anchor and clamps to the container edges", () => {
		const left = place({ bbox: { minX: 0, maxX: 10, minY: 300, maxY: 340 } });
		expect(left.left).toBeGreaterThanOrEqual(8);
		const right = place({ bbox: { minX: W - 10, maxX: W, minY: 300, maxY: 340 } });
		expect(right.left + right.width).toBeLessThanOrEqual(W - 8);
	});

	it("holds clear of the crow tile when their bands overlap", () => {
		const crow = { left: 320, top: 150, bottom: 300 };
		const p = place({ bbox: pinAt(200), crow });
		expect(p.left + p.width).toBeLessThanOrEqual(crow.left - 10);
	});

	it("keeps its width when it opens wholly under the crow tile", () => {
		const crow = { left: 320, top: 150, bottom: 220 };
		const p = place({ bbox: pinAt(330), crow, wide: true });
		expect(p.left + p.width).toBeGreaterThan(crow.left - 10);
	});
});

describe("leaderLine — the dotted trail follows the card", () => {
	it("runs DOWN from the pin to the card's top when the card is below", () => {
		const bbox = pinAt(240);
		const p = place({ bbox });
		const l = leaderLine(bbox, p);
		expect(l?.y0).toBeLessThan(l?.y1 ?? 0);
		expect(l?.y1).toBe(p.edge);
	});

	it("runs UP from the pin to the card's bottom when the card is above", () => {
		const bbox = pinAt(700);
		const p = place({ bbox });
		const l = leaderLine(bbox, p);
		expect(l?.y0).toBeGreaterThan(l?.y1 ?? 0);
		expect(l?.y1).toBe(p.edge);
		expect(l?.x1).toBeGreaterThanOrEqual(p.left);
		expect(l?.x1).toBeLessThanOrEqual(p.left + p.width);
	});

	it("returns null when the card is too close to draw a trail", () => {
		const bbox = { minX: 180, maxX: 210, minY: 260, maxY: 300 };
		expect(leaderLine(bbox, { left: 100, edge: 303, width: 260, maxH: 300, side: "below" })).toBeNull();
	});
});
