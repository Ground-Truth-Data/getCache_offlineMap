import { describe, expect, it } from "vitest";
import { GRID_RADIUS_KM, radiusBox } from "./grid";

function km(lng1: number, lat1: number, lng2: number, lat2: number): number {
	const dLat = (lat2 - lat1) * 110.574;
	const dLng =
		(lng2 - lng1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
	return Math.hypot(dLat, dLng);
}

const PINS: Array<[number, number]> = [
	[-121.5722, 48.2164],
	[-121.5246, 48.4817],
	[-2.92565, 16.7277],
	[-115.4419, 41.905],
	[0.001, 0.001],
];

describe("the roads picture is pin-centred", () => {
	it("⛔ THE BOX IS CENTRED ON THE PIN — every pin, exactly", () => {
		for (const [lng, lat] of PINS) {
			const b = radiusBox(lng, lat);
			const cx = (b.w + b.e) / 2;
			const cy = (b.s + b.n) / 2;
			expect(km(lng, lat, cx, cy), `pin ${lng},${lat}`).toBeLessThan(0.01);
		}
	});

	it("⛔ TWO NEARBY PINS GET DIFFERENT BOXES — no shared address", () => {
		const a = radiusBox(-121.5722, 48.2164);
		const b = radiusBox(-121.5246, 48.4817);
		expect(a.w).not.toBe(b.w);
		expect(a.s).not.toBe(b.s);
	});

	it("the box really is the promised radius each way", () => {
		for (const [lng, lat] of PINS) {
			const b = radiusBox(lng, lat);
			expect(km(lng, lat, b.w, lat)).toBeGreaterThanOrEqual(GRID_RADIUS_KM - 0.5);
			expect(km(lng, lat, b.e, lat)).toBeGreaterThanOrEqual(GRID_RADIUS_KM - 0.5);
			expect(km(lng, lat, lng, b.s)).toBeGreaterThanOrEqual(GRID_RADIUS_KM - 0.5);
			expect(km(lng, lat, lng, b.n)).toBeGreaterThanOrEqual(GRID_RADIUS_KM - 0.5);
		}
	});

	it("⛔ packBuilder builds VECTOR tiles around the PIN'S OWN point", async () => {
		const { readFileSync } = await import("node:fs");
		const { fileURLToPath } = await import("node:url");
		const src = readFileSync(
			fileURLToPath(new URL("./packBuilder.ts", import.meta.url)),
			"utf8",
		);
		expect(src).toContain("buildBlobTile(");
		expect(src).not.toContain("renderRoadPng(");

		// The pin's real GPS point drives what is read and which cells are built.
		expect(src).toContain("radiusBox(lng, lat)");
		expect(src).toContain("cellsFor(lng, lat)");

		// Each cell framed to its OWN box.
		expect(src).toContain("boxFrame(cellBox(c))");
	});
});
