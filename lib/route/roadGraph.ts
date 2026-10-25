/** Offline directions over the pack's z13 `roads` tiles — the same bytes the offline map draws. Pure: no map, no store. */

import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import type { LngLat } from "../shared/kmGeo";

export const ROUTE_Z = 13;
/** Tile-local units per tile, whatever extent a tile was cut at. */
const UNITS = 4096;
const WORLD = 2 ** ROUTE_Z * UNITS;
const EARTH_M = 40_075_016.686;
/** Protomaps line-merges at z13 and drops junction vertices: a side road stops a metre short of the road it joins. */
const SNAP_M = 8;
/** A stop further than this from any road has no road route. */
const ATTACH_M = 3000;
/** ~250 km square of z13 tiles — past this the request is not a drive. */
export const MAX_TILES = 2500;

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

/** Every z13 tile under the stops' box, padded by `share` of its span and never less than 3 km. */
export function tilesFor(stops: readonly LngLat[], share: number): TileId[] {
	const w = stops.map(toWorld);
	const xs = w.map((p) => p[0]);
	const ys = w.map((p) => p[1]);
	const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
	const pad = Math.max(span * share, 3000 / metresPerUnit(stops[0][1]));
	const t = (v: number) => Math.floor(v / UNITS);
	const out: TileId[] = [];
	for (let x = t(Math.min(...xs) - pad); x <= t(Math.max(...xs) + pad); x++)
		for (let y = t(Math.min(...ys) - pad); y <= t(Math.max(...ys) + pad); y++) out.push({ z: ROUTE_Z, x, y });
	return out;
}

const metresPerUnit = (lat: number): number => (EARTH_M * Math.cos((lat * Math.PI) / 180)) / WORLD;

/** The tile's drivable lines in world units, each cut to the tile's own square so neighbours meet on the seam. */
export function decodeRoads(t: TileId, bytes: ArrayBuffer): RoadLine[] {
	if (!bytes.byteLength) return [];
	const layer = new VectorTile(new Pbf(new Uint8Array(bytes)) as unknown as ConstructorParameters<typeof VectorTile>[0]).layers.roads;
	if (!layer) return [];
	const E = layer.extent;
	const k = UNITS / E;
	const ox = t.x * UNITS;
	const oy = t.y * UNITS;
	const out: RoadLine[] = [];
	for (let i = 0; i < layer.length; i++) {
		const f = layer.feature(i);
		if (f.type !== 2) continue;
		const cost = costOf(f.properties.kind, f.properties.kind_detail);
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
				const cut = clip(a.x, a.y, b.x, b.y, E);
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

/** Liang–Barsky against [0, E]²; null when the segment misses the square. */
function clip(ax: number, ay: number, bx: number, by: number, E: number): [number, number] | null {
	const dx = bx - ax;
	const dy = by - ay;
	let t0 = 0;
	let t1 = 1;
	for (const [p, q] of [
		[-dx, ax],
		[dx, E - ax],
		[-dy, ay],
		[dy, E - ay],
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
	private readonly ids = new Map<string, number>();
	readonly mpu: number;

	constructor(lines: readonly RoadLine[], lat: number) {
		this.mpu = metresPerUnit(lat);
		for (const l of lines)
			for (let i = 1; i < l.pts.length; i++) this.link(this.node(l.pts[i - 1]), this.node(l.pts[i]), l.cost);
		this.joinDeadEnds();
	}

	private node([x, y]: readonly [number, number]): number {
		// Quarter-unit grid (~0.3 m at z13) so both sides of a seam land on one node.
		const key = `${Math.round(x * 4)},${Math.round(y * 4)}`;
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
		const cell = SNAP_M / this.mpu;
		const grid = new Map<string, number[]>();
		const cellOf = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
		segs.forEach(([a, b], i) => {
			const x0 = Math.floor(Math.min(this.xs[a], this.xs[b]) / cell);
			const x1 = Math.floor(Math.max(this.xs[a], this.xs[b]) / cell);
			const y0 = Math.floor(Math.min(this.ys[a], this.ys[b]) / cell);
			const y1 = Math.floor(Math.max(this.ys[a], this.ys[b]) / cell);
			for (let x = x0; x <= x1; x++)
				for (let y = y0; y <= y1; y++) {
					const k = `${x},${y}`;
					const list = grid.get(k);
					if (list) list.push(i);
					else grid.set(k, [i]);
				}
		});
		// Found against the original segments, applied after, so a split never invalidates a later search.
		const joins: Array<{ end: number; seg: number; t: number }> = [];
		this.adj.forEach((es, end) => {
			if (es.length !== 1) return;
			const own = new Set([end, es[0].to]);
			const [cx, cy] = cellOf(this.xs[end], this.ys[end]).split(",").map(Number);
			let best: { seg: number; t: number; d: number } | null = null;
			for (let i = -1; i <= 1; i++)
				for (let j = -1; j <= 1; j++)
					for (const s of grid.get(`${cx + i},${cy + j}`) ?? []) {
						const [a, b] = segs[s];
						if (own.has(a) || own.has(b)) continue;
						const [d, t] = this.project(this.xs[end], this.ys[end], a, b);
						if (d <= SNAP_M && (!best || d < best.d)) best = { seg: s, t, d };
					}
			if (best) joins.push({ end, seg: best.seg, t: best.t });
		});
		const bySeg = new Map<number, Array<{ end: number; t: number }>>();
		for (const j of joins) bySeg.set(j.seg, [...(bySeg.get(j.seg) ?? []), j]);
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

/** Route through every stop in order. */
export async function findRoute(
	stops: readonly LngLat[],
	read: (t: TileId) => Promise<RoadLine[] | null>,
): Promise<RouteResult> {
	const crowKm = crowMetres(stops) / 1000;
	let last: RouteResult = { ok: false, reason: "too-far", crowKm, missing: 0 };
	for (const share of PADS) {
		const tiles = tilesFor(stops, share);
		if (tiles.length > MAX_TILES) break;
		const got = await Promise.all(tiles.map(read));
		const missing = got.filter((g) => g === null).length;
		last = routeOver(new RoadGraph(got.flatMap((g) => g ?? []), stops[0][1]), stops) ?? { ok: false, reason: "no-road", crowKm, missing };
		if (last.ok) break;
	}
	return last;
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
