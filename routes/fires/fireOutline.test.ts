import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	__resetOutlineMemoForTest,
	convexHull,
	expandRing,
	fireOutlines,
} from "./fireOutline";

const CELL = 0.00375;
const row = (n: number, lng = -121, lat = 50) =>
	Array.from({ length: n }, (_, i) => ({
		coordinates: [lng + i * CELL, lat] as [number, number],
	}));

const blob = (n: number, lng = -121, lat = 50) => {
	const out: { coordinates: [number, number] }[] = [];
	for (let x = 0; x < n; x++)
		for (let y = 0; y < n; y++)
			out.push({ coordinates: [lng + x * CELL, lat + y * CELL] });
	return out;
};

describe("convexHull", () => {
	it("returns a ring for a square", () => {
		const h = convexHull([
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 1],
		]);
		expect(h).toHaveLength(4);
	});

	it("drops interior points — only the outline survives", () => {
		const h = convexHull([
			[0, 0],
			[2, 0],
			[2, 2],
			[0, 2],
			[1, 1],
		]);
		expect(h).toHaveLength(4);
		expect(h).not.toContainEqual([1, 1]);
	});

	it("handles degenerate input without throwing", () => {
		expect(convexHull([])).toEqual([]);
		expect(convexHull([[0, 0]])).toHaveLength(1);
	});
});

describe("fireOutlines — one line per fire", () => {
	it("draws ONE outline around one group", () => {
		const fc = fireOutlines(blob(4));
		expect(fc.features).toHaveLength(1);
		expect(fc.features[0].geometry.type).toBe("Polygon");
	});

	it("draws SEPARATE outlines for fires far apart", () => {
		const fc = fireOutlines([...blob(4), ...blob(4, -120, 50)]);
		expect(fc.features).toHaveLength(2);
	});

	it("JOINS detections a few hundred metres apart — one fire, one line", () => {
		const a = blob(3);
		const b = blob(3, -121 + 2 * CELL, 50);
		expect(fireOutlines([...a, ...b]).features).toHaveLength(1);
	});

	it("ignores a lone detection — a ring around one dot says nothing", () => {
		expect(fireOutlines(row(1)).features).toHaveLength(0);
		expect(fireOutlines(row(2)).features).toHaveLength(0);
	});

	it("closes every ring, as GeoJSON requires", () => {
		const fc = fireOutlines(blob(4));
		for (const f of fc.features) {
			const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
			expect(ring[0]).toEqual(ring[ring.length - 1]);
			expect(ring.length).toBeGreaterThanOrEqual(4);
		}
	});

	it("carries NO properties — it is not tappable and makes no claims", () => {
		const fc = fireOutlines(blob(5));
		expect(fc.features[0].properties).toEqual({});
	});

	it("survives garbage coordinates rather than throwing", () => {
		const junk = [
			{ coordinates: [Number.NaN, 50] as [number, number] },
			{ coordinates: [-121, Number.POSITIVE_INFINITY] as [number, number] },
			...blob(4),
		];
		expect(() => fireOutlines(junk)).not.toThrow();
		expect(fireOutlines(junk).features).toHaveLength(1);
	});

	it("returns nothing for no input — an empty layer, never a crash", () => {
		expect(fireOutlines([]).features).toHaveLength(0);
	});

	it("stays cheap at province scale", () => {
		const many: { coordinates: [number, number] }[] = [];
		for (let i = 0; i < 20_000; i++) {
			many.push({
				coordinates: [-121 + (i % 200) * CELL, 50 + Math.floor(i / 200) * CELL],
			});
		}
		const t0 = performance.now();
		const fc = fireOutlines(many);
		expect(performance.now() - t0).toBeLessThan(2000);
		expect(fc.features.length).toBeGreaterThan(0);
	});

	it("the hull ENCLOSES every detection it was built from", () => {
		const pts = blob(6);
		const ring = (fireOutlines(pts).features[0].geometry as GeoJSON.Polygon)
			.coordinates[0];
		const xs = ring.map((p) => p[0]);
		const ys = ring.map((p) => p[1]);
		for (const p of pts) {
			expect(p.coordinates[0]).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-9);
			expect(p.coordinates[0]).toBeLessThanOrEqual(Math.max(...xs) + 1e-9);
			expect(p.coordinates[1]).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9);
			expect(p.coordinates[1]).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
		}
	});
});

describe("the margin — the outline sits OUTSIDE every detection", () => {
	it("pushes the ring outward from the centre", () => {
		const square: [number, number][] = [
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 1],
		];
		const out = expandRing(square, 0.1);
		const xs = out.map((p) => p[0]);
		const ys = out.map((p) => p[1]);
		expect(Math.min(...xs)).toBeLessThan(0);
		expect(Math.max(...xs)).toBeGreaterThan(1);
		expect(Math.min(...ys)).toBeLessThan(0);
		expect(Math.max(...ys)).toBeGreaterThan(1);
	});

	it("keeps the same number of vertices — a bigger ring, not a new shape", () => {
		const tri: [number, number][] = [
			[0, 0],
			[1, 0],
			[0, 1],
		];
		expect(expandRing(tri, 0.1)).toHaveLength(3);
	});

	it("scales longitude by latitude so the gap is even on the GROUND", () => {
		const at = (lat: number) => {
			const r: [number, number][] = [
				[0, lat],
				[1, lat],
				[1, lat + 1],
				[0, lat + 1],
			];
			const e = expandRing(r, 0.1);
			return Math.max(...e.map((p) => p[0])) - 1;
		};
		expect(at(60)).toBeGreaterThan(at(0));
	});

	it("EVERY detection ends up strictly inside its own outline", () => {
		const pts = blob(6);
		const ring = (fireOutlines(pts).features[0].geometry as GeoJSON.Polygon)
			.coordinates[0];
		const xs = ring.map((p) => p[0]);
		const ys = ring.map((p) => p[1]);
		for (const p of pts) {
			expect(p.coordinates[0]).toBeGreaterThan(Math.min(...xs));
			expect(p.coordinates[0]).toBeLessThan(Math.max(...xs));
			expect(p.coordinates[1]).toBeGreaterThan(Math.min(...ys));
			expect(p.coordinates[1]).toBeLessThan(Math.max(...ys));
		}
	});

	it("the gap is ONE FLAME WIDE — a few hundred metres, never kilometres", () => {
		const pts = blob(6, -121, 49);
		const ring = (fireOutlines(pts).features[0].geometry as GeoJSON.Polygon)
			.coordinates[0];
		const lats = pts.map((p) => p.coordinates[1]);
		const ringLats = ring.map((p) => p[1]);
		const gapM = (Math.max(...ringLats) - Math.max(...lats)) * 111_320;
		expect(gapM).toBeGreaterThan(100);
		expect(gapM).toBeLessThan(700);
	});

	it("the gap does NOT grow with the size of the fire", () => {
		const gapOf = (n: number) => {
			const pts = blob(n, -121, 49);
			const ring = (fireOutlines(pts).features[0].geometry as GeoJSON.Polygon)
				.coordinates[0];
			return (
				Math.max(...ring.map((p) => p[1])) -
				Math.max(...pts.map((p) => p.coordinates[1]))
			);
		};
		const small = gapOf(5);
		const large = gapOf(40);
		expect(Math.abs(large - small)).toBeLessThan(small * 0.5);
	});

	it("does not throw on a degenerate ring", () => {
		expect(() => expandRing([], 0.1)).not.toThrow();
		expect(() =>
			expandRing(
				[
					[0, 0],
					[0, 0],
					[0, 0],
				],
				0.1,
			),
		).not.toThrow();
	});
});

// TODO: re-point `src` at the fire render layer's source and unskip.
describe.skip("the outline layer is zoom-gated", () => {
	const src = "";
	const block = src.slice(src.indexOf("id: ids.outline,"));
	const layer = block.slice(0, block.indexOf("\n\t});"));

	it("has a minzoom — it is absent at regional zoom", () => {
		expect(layer).toContain("minzoom: OUTLINE_MIN_ZOOM");
	});

	it("waits for BLOCK scale — this is a tree-planting app", () => {
		expect(src).toMatch(/const OUTLINE_MIN_ZOOM = 13;/);
	});

	it("is gated ABOVE the zoom where clusters hand over", () => {
		const clusterMax = Number(src.match(/clusterMaxZoom: (\d+)/)?.[1]);
		const outlineMin = Number(src.match(/OUTLINE_MIN_ZOOM = (\d+)/)?.[1]);
		expect(outlineMin).toBeGreaterThan(clusterMax);
	});

	it("fades in rather than popping into existence", () => {
		expect(layer).toContain('"line-opacity"');
		expect(layer).toContain('"interpolate"');
	});

	it("sits UNDER the flames — the dots stay the primary mark", () => {
		expect(src.indexOf("id: ids.outline,")).toBeLessThan(
			src.indexOf("id: ids.flame"),
		);
	});
});

describe("fireOutlines — the per-pan memo", () => {
	it("returns the SAME object for unchanged data (a pan must not recompute)", () => {
		__resetOutlineMemoForTest();
		const spots = blob(4);
		const first = fireOutlines(spots);
		const second = fireOutlines([...spots]);
		expect(second).toBe(first);
	});

	it("RECOMPUTES when a fire actually moves", () => {
		__resetOutlineMemoForTest();
		const first = fireOutlines(blob(4));
		const moved = fireOutlines(blob(4, -120, 50));
		expect(moved).not.toBe(first);
		const ring = (moved.features[0].geometry as GeoJSON.Polygon).coordinates[0];
		expect(ring.every(([lng]) => lng > -120.1)).toBe(true);
	});

	it("RECOMPUTES when a fire grows", () => {
		__resetOutlineMemoForTest();
		const small = fireOutlines(blob(4));
		const bigger = fireOutlines(blob(6));
		expect(bigger).not.toBe(small);
	});

	it("distinguishes a group SPLITTING from one that merely moved", () => {
		__resetOutlineMemoForTest();
		const together = fireOutlines(blob(4));
		const apart = fireOutlines([...blob(2), ...blob(2, -119, 48)]);
		expect(apart).not.toBe(together);
	});
});

describe("fireOutlines — stableKey", () => {
	it("hits across rebuilt `shown` arrays when given a stable key", () => {
		__resetOutlineMemoForTest();
		const all = blob(4);
		const first = fireOutlines([...all], all);
		const second = fireOutlines([...all], all);
		expect(second).toBe(first);
	});

	it("⛔ does NOT serve a stale outline when `shown` shrinks under a stable key", () => {
		__resetOutlineMemoForTest();
		const all = [...blob(4), ...blob(4, -119, 48)];
		const both = fireOutlines([...all], all);
		expect(both.features).toHaveLength(2);
		const half = fireOutlines(blob(4), all);
		expect(half).not.toBe(both);
		expect(half.features).toHaveLength(1);
	});

	it("still works with no key at all (content hashing fallback)", () => {
		__resetOutlineMemoForTest();
		const a = fireOutlines(blob(4));
		const b = fireOutlines([...blob(4)]);
		expect(b).toBe(a);
	});
});
