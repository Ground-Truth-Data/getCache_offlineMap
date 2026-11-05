import { describe, expect, it } from "vitest";
import { latToTileY, lngToTileX, tileToLat, tileToLng } from "../../contract/geo";
import { piecesOf } from "../../shared/anchors";
import { coverTiles } from "./satelliteImage";

type Pt = [number, number];
const Z = 16;
const keys = (ring: Pt[], z = Z) => new Set(coverTiles(ring, z).map((t) => `${t.x}/${t.y}`));
const tileOf = ([lng, lat]: Pt, z = Z) => `${lngToTileX(lng, z)}/${latToTileY(lat, z)}`;

/** Every sampled point the filled ring holds: a dense grid plus each edge walked finely. */
function inside(ring: Pt[], step: number): Pt[] {
	const xs = ring.map((p) => p[0]);
	const ys = ring.map((p) => p[1]);
	const pts: Pt[] = [];
	const hit = ([x, y]: Pt) => {
		let c = false;
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i]!;
			const [xj, yj] = ring[j]!;
			if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
		}
		return c;
	};
	for (let x = Math.min(...xs); x <= Math.max(...xs); x += step)
		for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) if (hit([x, y])) pts.push([x, y]);
	for (let i = 1; i < ring.length; i++)
		for (let t = 0; t <= 1; t += 0.001) pts.push([ring[i - 1]![0] + (ring[i]![0] - ring[i - 1]![0]) * t, ring[i - 1]![1] + (ring[i]![1] - ring[i - 1]![1]) * t]);
	return pts;
}

const square = (w: number, s: number, e: number, n: number): Pt[] => [[w, s], [e, s], [e, n], [w, n], [w, s]];

describe("the cover rule: every tile the filled outer ring touches", () => {
	it("a ring with a hole holds the tiles under the hole too", () => {
		const outer = square(-120.02, 50, -119.98, 50.02);
		const hole = square(-120.01, 50.005, -119.99, 50.015);
		const rings = piecesOf({ type: "Polygon", coordinates: [outer, hole] }).map((p) => p.ring);
		expect(rings).toEqual([outer]);
		const got = keys(rings[0]!);
		for (const p of inside(hole, 0.0005)) expect(got.has(tileOf(p))).toBe(true);
		for (const p of inside(outer, 0.0005)) expect(got.has(tileOf(p))).toBe(true);
	});

	it("a ring that only grazes a tile's corner or edge holds that tile", () => {
		const x = lngToTileX(-120, Z);
		const y = latToTileY(50, Z);
		const [cx, cy] = [tileToLng(x + 1, Z), tileToLat(y + 1, Z)];
		const w = tileToLng(x, Z);
		const n = tileToLat(y, Z);
		// A triangle inside tile x/y whose one vertex sits exactly on that tile's lower-right corner.
		const corner = keys([[w + 1e-5, n - 1e-5], [cx, cy], [w + 1e-5, cy + 1e-6], [w + 1e-5, n - 1e-5]]);
		for (const k of [`${x}/${y}`, `${x + 1}/${y}`, `${x}/${y + 1}`, `${x + 1}/${y + 1}`]) expect(corner.has(k)).toBe(true);
		// A sliver lying along the tile's east edge.
		const edge = keys([[cx - 1e-5, n - 1e-5], [cx, n - 1e-5], [cx, cy + 1e-5], [cx - 1e-5, cy + 1e-5], [cx - 1e-5, n - 1e-5]]);
		expect(edge.has(`${x}/${y}`)).toBe(true);
		expect(edge.has(`${x + 1}/${y}`)).toBe(true);
	});

	it("a thin diagonal sliver leaves no tile it crosses out", () => {
		const sliver: Pt[] = [[-120, 50], [-119.95, 50.03], [-119.95, 50.03001], [-120, 50.00001], [-120, 50]];
		const got = keys(sliver);
		for (const p of inside(sliver, 0.00002)) expect(got.has(tileOf(p))).toBe(true);
		expect(got.size).toBeGreaterThan(10);
	});

	it("a MultiPolygon is each part's outer ring, holes dropped", () => {
		const a = square(-120.02, 50, -120.01, 50.01);
		const b = square(-119.9, 50.1, -119.89, 50.11);
		const rings = piecesOf({ type: "MultiPolygon", coordinates: [[a, square(-120.018, 50.002, -120.012, 50.008)], [b]] }).map((p) => p.ring);
		expect(rings).toEqual([a, b]);
		for (const r of rings) for (const p of inside(r, 0.0005)) expect(keys(r).has(tileOf(p))).toBe(true);
	});

	it("covers at the overview zooms too, and keeps nothing outside the ring's bounding tiles", () => {
		const r = square(-120.02, 50, -119.98, 50.02);
		for (const z of [10, 11, 12, 16]) {
			const got = coverTiles(r, z);
			for (const t of got) {
				expect(t.x).toBeGreaterThanOrEqual(lngToTileX(-120.02, z));
				expect(t.x).toBeLessThanOrEqual(lngToTileX(-119.98, z));
			}
			for (const p of inside(r, 0.001)) expect(new Set(got.map((t) => `${t.x}/${t.y}`)).has(tileOf(p, z))).toBe(true);
		}
	});
});
