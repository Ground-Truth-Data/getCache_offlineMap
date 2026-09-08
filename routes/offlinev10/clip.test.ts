import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { describe, expect, it } from "vitest";
import { clipTile, type Rect } from "./clip";

// ── a tiny MVT encoder, enough to build one tile with one layer ─────────────
function varint(out: number[], v: number): void {
	let n = v;
	while (n > 0x7f) {
		out.push((n & 0x7f) | 0x80);
		n = Math.floor(n / 128);
	}
	out.push(n);
}
const zig = (v: number): number => (v << 1) ^ (v >> 31);
function bytes(out: number[], field: number, body: number[]): void {
	varint(out, (field << 3) | 2);
	varint(out, body.length);
	out.push(...body);
}
function str(field: number, s: string): number[] {
	const out: number[] = [];
	bytes(out, field, [...new TextEncoder().encode(s)]);
	return out;
}
type Pt = [number, number];
function geometry(type: number, parts: Pt[][]): number[] {
	const g: number[] = [];
	let px = 0;
	let py = 0;
	const emit = (p: Pt) => {
		varint(g, zig(p[0] - px));
		varint(g, zig(p[1] - py));
		px = p[0];
		py = p[1];
	};
	if (type === 1) {
		varint(g, (parts.length << 3) | 1);
		for (const [p] of parts) emit(p);
		return g;
	}
	for (const part of parts) {
		varint(g, (1 << 3) | 1);
		emit(part[0]);
		varint(g, ((part.length - 1) << 3) | 2);
		for (let i = 1; i < part.length; i++) emit(part[i]);
		if (type === 3) varint(g, (1 << 3) | 7);
	}
	return g;
}
interface F {
	id: number;
	type: number;
	parts: Pt[][];
	kind: string;
}
function tile(features: F[], extent = 4096): Uint8Array {
	const kinds = [...new Set(features.map((f) => f.kind))];
	const layer: number[] = [...str(1, "roads")];
	for (const f of features) {
		const body: number[] = [];
		varint(body, (1 << 3) | 0);
		varint(body, f.id);
		const tags: number[] = [];
		varint(tags, 0);
		varint(tags, kinds.indexOf(f.kind));
		bytes(body, 2, tags);
		varint(body, (3 << 3) | 0);
		varint(body, f.type);
		bytes(body, 4, geometry(f.type, f.parts));
		bytes(layer, 2, body);
	}
	layer.push(...str(3, "kind"));
	for (const k of kinds) {
		const v: number[] = [...str(1, k)];
		bytes(layer, 4, v);
	}
	varint(layer, (5 << 3) | 0);
	varint(layer, extent);
	varint(layer, (15 << 3) | 0);
	varint(layer, 2);
	const out: number[] = [];
	bytes(out, 3, layer);
	return Uint8Array.from(out);
}

function decode(data: Uint8Array) {
	// vector-tile 3 wants its own reader type; pbf 4's class is the same shape
	const t = new VectorTile(
		new Pbf(data) as unknown as ConstructorParameters<typeof VectorTile>[0],
	);
	const layer = t.layers.roads;
	if (!layer) return [];
	const out: Array<{ id: number; type: number; kind: string; geom: Pt[][] }> =
		[];
	for (let i = 0; i < layer.length; i++) {
		const f = layer.feature(i);
		out.push({
			id: f.id ?? -1,
			type: f.type,
			kind: String(f.properties.kind),
			// loadGeometry repeats a ring's first vertex to close it; the wire format does not
			geom: f.loadGeometry().map((ring) => {
				const pts = ring.map((p) => [p.x, p.y] as Pt);
				const a = pts[0];
				const b = pts[pts.length - 1];
				if (f.type === 3 && pts.length > 1 && a[0] === b[0] && a[1] === b[1])
					pts.pop();
				return pts;
			}),
		});
	}
	return out;
}

/** The square from 1024..3072 on both axes, as a fraction of the tile. */
const SQUARE: Rect = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 };
const inSquare = (p: Pt) =>
	p[0] >= 1024 && p[0] <= 3072 && p[1] >= 1024 && p[1] <= 3072;

describe("clipTile", () => {
	it("cuts a road at the border and keeps its id and tags", () => {
		const src = tile([
			{
				id: 7,
				type: 2,
				kind: "highway",
				parts: [
					[
						[0, 2048],
						[4096, 2048],
					],
				],
			},
		]);
		const [f] = decode(clipTile(src, [SQUARE]));
		expect(f.id).toBe(7);
		expect(f.kind).toBe("highway");
		expect(f.geom).toEqual([
			[
				[1024, 2048],
				[3072, 2048],
			],
		]);
	});

	it("a road that leaves and comes back is two runs, both inside", () => {
		const road: Pt[] = [
			[1500, 1500],
			[5000, 1500],
			[5000, 2500],
			[1500, 2500],
		];
		const src = tile([{ id: 1, type: 2, kind: "minor", parts: [road] }]);
		const [f] = decode(clipTile(src, [SQUARE]));
		expect(f.geom.length).toBe(2);
		for (const run of f.geom)
			for (const p of run) expect(inSquare(p)).toBe(true);
	});

	it("drops a road entirely outside, and the layer if nothing is left", () => {
		const src = tile([
			{
				id: 1,
				type: 2,
				kind: "minor",
				parts: [
					[
						[0, 100],
						[4096, 100],
					],
				],
			},
		]);
		expect(decode(clipTile(src, [SQUARE]))).toEqual([]);
	});

	it("clips a lake to the border and keeps its winding", () => {
		const ring: Pt[] = [
			[0, 0],
			[4096, 0],
			[4096, 4096],
			[0, 4096],
		];
		const src = tile([{ id: 3, type: 3, kind: "lake", parts: [ring] }]);
		const [f] = decode(clipTile(src, [SQUARE]));
		expect(f.type).toBe(3);
		const out = f.geom[0];
		expect(out.length).toBe(4);
		for (const p of out) expect(inSquare(p)).toBe(true);
		const area = (r: Pt[]) => {
			let a = 0;
			for (let i = 0, j = r.length - 1; i < r.length; j = i++)
				a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
			return a;
		};
		expect(Math.sign(area(out))).toBe(Math.sign(area(ring)));
		expect(Math.abs(area(out))).toBe(2048 * 2048 * 2);
	});

	it("keeps only the points inside", () => {
		const src = tile([
			{ id: 9, type: 1, kind: "town", parts: [[[2000, 2000]], [[100, 100]]] },
		]);
		const [f] = decode(clipTile(src, [SQUARE]));
		expect(f.geom).toEqual([[[2000, 2000]]]);
	});

	it("two neighbouring borders cut a road into pieces that meet at the shared edge", () => {
		const west: Rect = { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.75 };
		const east: Rect = { x0: 0.5, y0: 0.25, x1: 0.75, y1: 0.75 };
		const src = tile([
			{
				id: 1,
				type: 2,
				kind: "highway",
				parts: [
					[
						[0, 2048],
						[4096, 2048],
					],
				],
			},
		]);
		const [f] = decode(clipTile(src, [west, east]));
		expect(f.geom).toEqual([
			[
				[1024, 2048],
				[2048, 2048],
			],
			[
				[2048, 2048],
				[3072, 2048],
			],
		]);
	});

	it("respects a layer's own extent", () => {
		const src = tile(
			[
				{
					id: 1,
					type: 2,
					kind: "highway",
					parts: [
						[
							[0, 4096],
							[8192, 4096],
						],
					],
				},
			],
			8192,
		);
		const [f] = decode(clipTile(src, [SQUARE]));
		expect(f.geom).toEqual([
			[
				[2048, 4096],
				[6144, 4096],
			],
		]);
	});
});
