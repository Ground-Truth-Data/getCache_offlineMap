/** Offline directions over the pack's z13 `roads` tiles near each stop and the world highways' z8 tiles between. Pure: no map, no store. */

import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import type { LngLat } from "../shared/kmGeo";

export const ROUTE_Z = 13;
/** The highways file's top zoom (getCache's scripts/build-world-highways.mjs): every line whole there. */
export const HIGHWAY_Z = 8;
/** The router's tile key for a highways-file tile, beside the pack's bare "z/x/y". */
export const HIGHWAY_KEY = "hw/";
/** Tile-local units per tile, whatever extent a tile was cut at. */
const UNITS = 4096;
const WORLD = 2 ** ROUTE_Z * UNITS;
const EARTH_M = 40_075_016.686;
/** Protomaps line-merges at z13 and drops junction vertices: a side road stops a metre short of the road it joins. */
const SNAP_M = 8;
/** A stop further than this from any road has no road route. */
const ATTACH_M = 3000;
/** ~250 km square of z13 tiles: past this the highways carry the middle of the trip. */
const MAX_TILES = 2500;
/** Past this no road route is offered at all. */
const MAX_KM = 999;
/** Each stop's own z13 square reaches this far, or further to touch a highway, never past the max. */
const LOCAL_MIN_M = 12_000;
const LOCAL_MAX_M = 50_000;
/** Natural Earth draws a highway up to a few hundred metres off the real road: where it enters a stop's square it joins the nearest z13 road this close. */
const ENTRY_M = 1500;

/** A tile reader that remembers the tiles it was asked for and didn't have: those are the only ones a new blob can improve a route with. */
export function gapReader<T>(read: (key: string) => Promise<T | undefined>) {
	const gaps = new Set<string>();
	return {
		read: async (key: string): Promise<T | undefined> => {
			const got = await read(key);
			if (got === undefined) gaps.add(key);
			else gaps.delete(key);
			return got;
		},
		/** True once any remembered gap now reads — each filled gap is forgotten. */
		gained: async (): Promise<boolean> => {
			const filled = (await Promise.all([...gaps].map(async (k) => ((await read(k)) === undefined ? null : k)))).filter((k) => k !== null);
			for (const k of filled) gaps.delete(k);
			return filled.length > 0;
		},
	};
}

/** Relative cost per metre; null = not drivable. Bush tracks are the roads planters drive. */
function costOf(kind: unknown, detail: unknown): number | null {
	if (kind === "highway") return 1;
	if (kind === "major_road") return 1.1;
	if (kind === "minor_road") return 1.3;
	if (kind === "path") return detail === "track" ? 1.6 : 5;
	if (kind === "other") return 2;
	return null;
}

export interface RoadLine {
	readonly pts: ReadonlyArray<readonly [number, number]>;
	readonly cost: number;
}

export interface TileId {
	readonly z: number;
	readonly x: number;
	readonly y: number;
}

export const toWorld = ([lng, lat]: LngLat): [number, number] => {
	const r = (lat * Math.PI) / 180;
	return [((lng + 180) / 360) * WORLD, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD];
};

export const toLngLat = (gx: number, gy: number): LngLat => [
	(gx / WORLD) * 360 - 180,
	(Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / WORLD))) * 180) / Math.PI,
];

/** Box padding as a share of the stops' span: a road that swings wide (the island's road detours 13 km) needs the wider retry. */
const PADS = [0.25, 0.75];

/** The z13 tile range under the stops' box, padded by `share` of its span and never less than 3 km. */
function tileBox(stops: readonly LngLat[], share: number): { x0: number; x1: number; y0: number; y1: number } {
	const w = stops.map(toWorld);
	const xs = w.map((p) => p[0]);
	const ys = w.map((p) => p[1]);
	const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
	const pad = Math.max(span * share, 3000 / metresPerUnit(stops[0][1]));
	const t = (v: number) => Math.floor(v / UNITS);
	return { x0: t(Math.min(...xs) - pad), x1: t(Math.max(...xs) + pad), y0: t(Math.min(...ys) - pad), y1: t(Math.max(...ys) + pad) };
}

export function tilesFor(stops: readonly LngLat[], share: number): TileId[] {
	const b = tileBox(stops, share);
	const out: TileId[] = [];
	for (let x = b.x0; x <= b.x1; x++) for (let y = b.y0; y <= b.y1; y++) out.push({ z: ROUTE_Z, x, y });
	return out;
}

type Box = { x0: number; y0: number; x1: number; y1: number };

const metresPerUnit = (lat: number): number => (EARTH_M * Math.cos((lat * Math.PI) / 180)) / WORLD;

/** The tile's drivable lines in world units, each cut to the tile's own square so neighbours meet on the seam. A pack tile's `roads`, or the highways file's `highways`. */
export function decodeRoads(t: TileId, bytes: ArrayBuffer): RoadLine[] {
	if (!bytes.byteLength) return [];
	const layers = new VectorTile(new Pbf(new Uint8Array(bytes)) as unknown as ConstructorParameters<typeof VectorTile>[0]).layers;
	const layer = layers.roads ?? layers.highways;
	if (!layer) return [];
	const E = layer.extent;
	const side = UNITS * 2 ** (ROUTE_Z - t.z);
	const k = side / E;
	const ox = t.x * side;
	const oy = t.y * side;
	const out: RoadLine[] = [];
	for (let i = 0; i < layer.length; i++) {
		const f = layer.feature(i);
		if (f.type !== 2) continue;
		const cost = layer === layers.highways ? 1 : costOf(f.properties.kind, f.properties.kind_detail);
		if (cost === null) continue;
		for (const ring of f.loadGeometry()) {
			let run: Array<[number, number]> = [];
			const flush = (): void => {
				if (run.length > 1) out.push({ pts: run, cost });
				run = [];
			};
			for (let s = 1; s < ring.length; s++) {
				const a = ring[s - 1];
				const b = ring[s];
				const cut = clip(a.x, a.y, b.x, b.y, { x0: 0, y0: 0, x1: E, y1: E });
				if (!cut) {
					flush();
					continue;
				}
				const [t0, t1] = cut;
				const A: [number, number] = [ox + (a.x + t0 * (b.x - a.x)) * k, oy + (a.y + t0 * (b.y - a.y)) * k];
				const B: [number, number] = [ox + (a.x + t1 * (b.x - a.x)) * k, oy + (a.y + t1 * (b.y - a.y)) * k];
				if (run.length && t0 > 0) flush();
				if (!run.length) run.push(A);
				run.push(B);
				if (t1 < 1) flush();
			}
			flush();
		}
	}
	return out;
}

/** Liang–Barsky against the box; null when the segment misses it. */
function clip(ax: number, ay: number, bx: number, by: number, b: Box): [number, number] | null {
	const dx = bx - ax;
	const dy = by - ay;
	let t0 = 0;
	let t1 = 1;
	for (const [p, q] of [
		[-dx, ax - b.x0],
		[dx, b.x1 - ax],
		[-dy, ay - b.y0],
		[dy, b.y1 - ay],
	]) {
		if (p === 0) {
			if (q < 0) return null;
			continue;
		}
		const r = q / p;
		if (p < 0) t0 = Math.max(t0, r);
		else t1 = Math.min(t1, r);
	}
	return t0 > t1 ? null : [t0, t1];
}

/** The lines with the box cut out of them, and each point where one crossed its edge. */
function cutOut(lines: readonly RoadLine[], b: Box): { lines: RoadLine[]; ends: Array<[number, number]> } {
	const out: RoadLine[] = [];
	const ends: Array<[number, number]> = [];
	for (const l of lines) {
		let run: Array<readonly [number, number]> = [];
		const flush = (): void => {
			if (run.length > 1) out.push({ pts: run, cost: l.cost });
			run = [];
		};
		for (let s = 1; s < l.pts.length; s++) {
			const [ax, ay] = l.pts[s - 1];
			const [bx, by] = l.pts[s];
			const c = clip(ax, ay, bx, by, b);
			if (!run.length) run.push(l.pts[s - 1]);
			if (!c) {
				run.push(l.pts[s]);
				continue;
			}
			const at = (t: number): [number, number] => [ax + t * (bx - ax), ay + t * (by - ay)];
			if (c[0] > 0) {
				const e = at(c[0]);
				run.push(e);
				ends.push(e);
			}
			flush();
			if (c[1] < 1) {
				const e = at(c[1]);
				ends.push(e);
				run = [e, l.pts[s]];
			}
		}
		flush();
	}
	return { lines: out, ends };
}

/** The nearest point on any of the lines, and how far it is in world units. */
function nearest(lines: readonly RoadLine[], [px, py]: readonly [number, number]): { d: number; at: [number, number] } | null {
	let best: { d: number; at: [number, number] } | null = null;
	for (const l of lines)
		for (let s = 1; s < l.pts.length; s++) {
			const [ax, ay] = l.pts[s - 1];
			const [bx, by] = l.pts[s];
			const dx = bx - ax;
			const dy = by - ay;
			const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
			const at: [number, number] = [ax + t * dx, ay + t * dy];
			const d = Math.hypot(px - at[0], py - at[1]);
			if (!best || d < best.d) best = { d, at };
		}
	return best;
}

interface Edge {
	to: number;
	/** metres */
	m: number;
	cost: number;
}

export class RoadGraph {
	readonly xs: number[] = [];
	readonly ys: number[] = [];
	readonly adj: Edge[][] = [];
	private readonly ids = new Map<number, number>();
	readonly mpu: number;
	/** Numeric node keys are offsets from here: a route box is ≤ 2^20 quarter-units wide, far inside 2^25. Text keys cost seconds in a city. */
	private bx = 0;
	private by = 0;

	constructor(lines: readonly RoadLine[], lat: number) {
		this.mpu = metresPerUnit(lat);
		const first = lines[0]?.pts[0];
		if (first) {
			this.bx = Math.round(first[0] * 4) - 2 ** 25;
			this.by = Math.round(first[1] * 4) - 2 ** 25;
		}
		for (const l of lines)
			for (let i = 1; i < l.pts.length; i++) this.link(this.node(l.pts[i - 1]), this.node(l.pts[i]), l.cost);
		this.joinDeadEnds();
	}

	private node([x, y]: readonly [number, number]): number {
		// Quarter-unit grid (~0.3 m at z13) so both sides of a seam land on one node.
		const key = (Math.round(x * 4) - this.bx) * 2 ** 26 + (Math.round(y * 4) - this.by);
		let id = this.ids.get(key);
		if (id === undefined) {
			id = this.xs.length;
			this.ids.set(key, id);
			this.xs.push(x);
			this.ys.push(y);
			this.adj.push([]);
		}
		return id;
	}

	private dist(a: number, b: number): number {
		return Math.hypot(this.xs[a] - this.xs[b], this.ys[a] - this.ys[b]) * this.mpu;
	}

	private link(a: number, b: number, cost: number): void {
		if (a === b || this.adj[a].some((e) => e.to === b)) return;
		const m = this.dist(a, b);
		this.adj[a].push({ to: b, m, cost });
		this.adj[b].push({ to: a, m, cost });
	}

	private unlink(a: number, b: number): void {
		this.adj[a] = this.adj[a].filter((e) => e.to !== b);
		this.adj[b] = this.adj[b].filter((e) => e.to !== a);
	}

	private segments(): Array<[number, number, number]> {
		const out: Array<[number, number, number]> = [];
		this.adj.forEach((es, a) => {
			for (const e of es) if (a < e.to) out.push([a, e.to, e.cost]);
		});
		return out;
	}

	/** Nearest point on segment a–b to (px, py): [metres, t]. */
	private project(px: number, py: number, a: number, b: number): [number, number] {
		const ax = this.xs[a] - px;
		const ay = this.ys[a] - py;
		const dx = this.xs[b] - this.xs[a];
		const dy = this.ys[b] - this.ys[a];
		const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
		return [Math.hypot(ax + t * dx, ay + t * dy) * this.mpu, t];
	}

	/** Split a–b at t, keeping its cost; returns the new node. */
	private split(a: number, b: number, t: number, cost: number): number {
		const n = this.node([this.xs[a] + t * (this.xs[b] - this.xs[a]), this.ys[a] + t * (this.ys[b] - this.ys[a])]);
		if (n === a || n === b) return n;
		this.unlink(a, b);
		this.link(a, n, cost);
		this.link(n, b, cost);
		return n;
	}

	private joinDeadEnds(): void {
		const segs = this.segments();
		// Any cell ≥ SNAP_M finds the same joins; the 3×3 search below covers an end within SNAP_M of a sampled cell.
		const cell = (8 * SNAP_M) / this.mpu;
		const grid = new Map<number, number[]>();
		const key = (cx: number, cy: number): number => cx * 2 ** 26 + cy;
		segs.forEach(([a, b], i) => {
			// Only the cells it passes through, sampled every half cell: filling its box, a 50 km highway straight filled 600,000.
			const dx = this.xs[b] - this.xs[a];
			const dy = this.ys[b] - this.ys[a];
			const n = Math.ceil(Math.hypot(dx, dy) / (cell / 2)) || 1;
			let last = Number.NaN;
			for (let s = 0; s <= n; s++) {
				const k = key(Math.floor((this.xs[a] + (dx * s) / n) / cell), Math.floor((this.ys[a] + (dy * s) / n) / cell));
				if (k === last) continue;
				last = k;
				const list = grid.get(k);
				if (list) list.push(i);
				else grid.set(k, [i]);
			}
		});
		// Found against the original segments, applied after, so a split never invalidates a later search.
		const joins: Array<{ end: number; seg: number; t: number }> = [];
		this.adj.forEach((es, end) => {
			if (es.length !== 1) return;
			const next = es[0].to;
			const cx = Math.floor(this.xs[end] / cell);
			const cy = Math.floor(this.ys[end] / cell);
			let best: { seg: number; t: number; d: number } | null = null;
			for (let i = -1; i <= 1; i++)
				for (let j = -1; j <= 1; j++)
					for (const s of grid.get(key(cx + i, cy + j)) ?? []) {
						const [a, b] = segs[s];
						if (a === end || a === next || b === end || b === next) continue;
						const [d, t] = this.project(this.xs[end], this.ys[end], a, b);
						if (d <= SNAP_M && (!best || d < best.d)) best = { seg: s, t, d };
					}
			if (best) joins.push({ end, seg: best.seg, t: best.t });
		});
		const bySeg = new Map<number, Array<{ end: number; t: number }>>();
		for (const j of joins) {
			const list = bySeg.get(j.seg);
			if (list) list.push(j);
			else bySeg.set(j.seg, [j]);
		}
		for (const [s, list] of bySeg) {
			const [a0, b, cost] = segs[s];
			let a = a0;
			let from = 0;
			for (const j of list.sort((p, q) => p.t - q.t)) {
				// Re-base t onto what is left of the segment after earlier splits.
				const n = this.split(a, b, (j.t - from) / (1 - from || 1), cost);
				this.link(j.end, n, cost);
				a = n;
				from = j.t;
			}
		}
	}

	/** Join a stop to its nearest road; returns the node and how far off-road it sat (m), or null past ATTACH_M. */
	attach(at: LngLat): { node: number; offM: number } | null {
		const [px, py] = toWorld(at);
		let best: { a: number; b: number; cost: number; t: number; d: number } | null = null;
		for (const [a, b, cost] of this.segments()) {
			const [d, t] = this.project(px, py, a, b);
			if (!best || d < best.d) best = { a, b, cost, t, d };
		}
		if (!best || best.d > ATTACH_M) return null;
		return { node: this.split(best.a, best.b, best.t, best.cost), offM: best.d };
	}

	/** A* by cost-weighted metres; the node path, or null when the two are on separate road networks. */
	path(s: number, t: number): number[] | null {
		const g = new Map<number, number>([[s, 0]]);
		const prev = new Map<number, number>();
		const heap = new MinHeap();
		heap.push(this.dist(s, t), s);
		const done = new Set<number>();
		while (heap.size) {
			const u = heap.pop();
			if (u === t) break;
			if (done.has(u)) continue;
			done.add(u);
			const gu = g.get(u) ?? 0;
			for (const e of this.adj[u]) {
				const ng = gu + e.m * e.cost;
				if (ng < (g.get(e.to) ?? Number.POSITIVE_INFINITY)) {
					g.set(e.to, ng);
					prev.set(e.to, u);
					heap.push(ng + this.dist(e.to, t), e.to);
				}
			}
		}
		if (s !== t && !prev.has(t)) return null;
		const out = [t];
		while (out[0] !== s) out.unshift(prev.get(out[0]) as number);
		return out;
	}

	lngLat(n: number): LngLat {
		return toLngLat(this.xs[n], this.ys[n]);
	}

	metres(path: readonly number[]): number {
		let m = 0;
		for (let i = 1; i < path.length; i++) m += this.dist(path[i - 1], path[i]);
		return m;
	}
}

class MinHeap {
	private k: number[] = [];
	private v: number[] = [];
	get size(): number {
		return this.k.length;
	}
	push(key: number, val: number): void {
		const { k, v } = this;
		let i = k.length;
		k.push(key);
		v.push(val);
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (k[p] <= k[i]) break;
			[k[p], k[i]] = [k[i], k[p]];
			[v[p], v[i]] = [v[i], v[p]];
			i = p;
		}
	}
	pop(): number {
		const { k, v } = this;
		const top = v[0];
		const lk = k.pop() as number;
		const lv = v.pop() as number;
		if (k.length) {
			k[0] = lk;
			v[0] = lv;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1;
				const r = l + 1;
				let m = i;
				if (l < k.length && k[l] < k[m]) m = l;
				if (r < k.length && k[r] < k[m]) m = r;
				if (m === i) break;
				[k[m], k[i]] = [k[i], k[m]];
				[v[m], v[i]] = [v[i], v[m]];
				i = m;
			}
		}
		return top;
	}
}

export type RouteResult =
	| {
			readonly ok: true;
			readonly line: LngLat[];
			/** Index into `line` where each leg ends — one per stop after the first. */
			readonly legEnds: number[];
			readonly km: number;
			/** Dashed walk from a stop to its road, when it sat off one. */
			readonly offRoad: Array<[LngLat, LngLat]>;
	  }
	| {
			readonly ok: false;
			readonly reason: "no-road" | "too-far";
			readonly crowKm: number;
			/** Tiles the reader had nothing for — a no-road answer over missing tiles says "not downloaded". */
			readonly missing: number;
	  };

const OFF_ROAD_DRAW_M = 15;

/** Route through every stop in order: on z13 alone when it fits, else z13 around each stop and the highways between. */
export async function findRoute(
	stops: readonly LngLat[],
	read: (t: TileId) => Promise<RoadLine[] | null>,
	highways?: (t: TileId) => Promise<RoadLine[] | null>,
): Promise<RouteResult> {
	const crowKm = crowMetres(stops) / 1000;
	const tooFar: RouteResult = { ok: false, reason: "too-far", crowKm, missing: 0 };
	if (crowKm > MAX_KM) return tooFar;
	let last: RouteResult = tooFar;
	const b = tileBox(stops, PADS[0]);
	if ((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) > MAX_TILES) {
		if (highways) last = await viaHighways(stops, read, highways, crowKm);
	} else
		for (const share of PADS) {
			const tiles = tilesFor(stops, share);
			if (tiles.length > MAX_TILES) break;
			const got = await Promise.all(tiles.map(read));
			const missing = got.filter((g) => g === null).length;
			last = routeOver(new RoadGraph(got.flatMap((g) => g ?? []), stops[0][1]), stops) ?? { ok: false, reason: "no-road", crowKm, missing };
			if (last.ok) break;
		}
	// The limit is the drive, not the crow: 900 km apart can be 1,400 km of road.
	return last.ok && last.km > MAX_KM ? tooFar : last;
}

/** Each stop's own z13 square, the highways with those squares cut out, joined where a highway crosses a square's edge. */
async function viaHighways(
	stops: readonly LngLat[],
	read: (t: TileId) => Promise<RoadLine[] | null>,
	highways: (t: TileId) => Promise<RoadLine[] | null>,
	crowKm: number,
): Promise<RouteResult> {
	const mpu = metresPerUnit(stops[0][1]);
	const w = stops.map(toWorld);
	const xs = w.map((p) => p[0]);
	const ys = w.map((p) => p[1]);
	// The wide pad at once: a short join outside the box (Merritt's, at 25 %) cuts a highway that runs inside it.
	const pad = Math.max(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * PADS[1], 50_000 / mpu);
	const side = UNITS * 2 ** (ROUTE_Z - HIGHWAY_Z);
	const corridor: TileId[] = [];
	for (let x = Math.floor((Math.min(...xs) - pad) / side); x <= Math.floor((Math.max(...xs) + pad) / side); x++)
		for (let y = Math.floor((Math.min(...ys) - pad) / side); y <= Math.floor((Math.max(...ys) + pad) / side); y++) corridor.push({ z: HIGHWAY_Z, x, y });
	let coarse = (await Promise.all(corridor.map(highways))).flatMap((g) => g ?? []);
	const local: RoadLine[] = [];
	const entries: RoadLine[] = [];
	let missing = 0;
	for (const p of w) {
		const r = Math.min(Math.max((nearest(coarse, p)?.d ?? 0) * mpu + 8000, LOCAL_MIN_M), LOCAL_MAX_M) / mpu;
		const box = { x0: p[0] - r, y0: p[1] - r, x1: p[0] + r, y1: p[1] + r };
		const tiles: TileId[] = [];
		for (let x = Math.floor(box.x0 / UNITS); x <= Math.floor(box.x1 / UNITS); x++)
			for (let y = Math.floor(box.y0 / UNITS); y <= Math.floor(box.y1 / UNITS); y++) tiles.push({ z: ROUTE_Z, x, y });
		const got = await Promise.all(tiles.map(read));
		missing += got.filter((g) => g === null).length;
		const mine = got.flatMap((g) => g ?? []);
		// Nothing downloaded here: the stop meets the highway itself.
		if (!mine.length) continue;
		const cut = cutOut(coarse, box);
		coarse = cut.lines;
		for (const e of cut.ends) {
			const j = nearest(mine, e);
			if (j && j.d * mpu <= ENTRY_M) entries.push({ pts: [e, j.at], cost: 1 });
		}
		local.push(...mine);
	}
	return routeOver(new RoadGraph([...coarse, ...local, ...entries], stops[0][1]), stops) ?? { ok: false, reason: "no-road", crowKm, missing };
}

function routeOver(graph: RoadGraph, stops: readonly LngLat[]): RouteResult | null {
	const at = stops.map((s) => graph.attach(s));
	if (at.some((a) => a === null)) return null;
	const nodes = at as Array<{ node: number; offM: number }>;
	const line: LngLat[] = [];
	const legEnds: number[] = [];
	let m = 0;
	for (let i = 1; i < nodes.length; i++) {
		const p = graph.path(nodes[i - 1].node, nodes[i].node);
		if (!p) return null;
		m += graph.metres(p);
		for (const n of line.length ? p.slice(1) : p) line.push(graph.lngLat(n));
		legEnds.push(line.length - 1);
	}
	const offRoad: Array<[LngLat, LngLat]> = [];
	nodes.forEach((n, i) => {
		if (n.offM > OFF_ROAD_DRAW_M) offRoad.push([stops[i], graph.lngLat(n.node)]);
	});
	return { ok: true, line, legEnds, km: m / 1000, offRoad };
}

function crowMetres(stops: readonly LngLat[]): number {
	const a = stops[0];
	const b = stops[stops.length - 1];
	const mpd = 111_320;
	return Math.hypot((b[0] - a[0]) * mpd * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * mpd);
}
