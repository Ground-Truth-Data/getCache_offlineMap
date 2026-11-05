import { guardBakeGrid } from "../store/downloadGuard";
import { sessionCap } from "../../shared/sessionByteCap.svelte";
import { tileToLat, tileToLng } from "../../contract/geo";
import { makeKeyedIdbStore } from "../store/keyedIdbStore";
import { SATELLITE_SOURCES, type SatelliteSource, sourceNamed } from "../../contract/satelliteSources";

const DB_NAME = "gc-offlineSatellite";
const STORE = "photoDiscs";

export type Bounds = [number, number, number, number]; // [w,s,e,n]

/** Bump whenever what an area holds changes: an older record is not current, so the pass saves the area again. */
export const BAKE_VERSION = 15;

/** Lowest zoom a held photo shows at: below its own zoom every tile is shrunk on the phone from the held ones. */
export const PHOTO_MIN_Z = 10;

/** A source tile as fetched, keyed `z/x/y`. */
export type RawTile = [string, ArrayBuffer];

export interface CoverTile {
	x: number;
	y: number;
	w: number;
	e: number;
	n: number;
	s: number;
}

type Pt = [number, number];

// Tile units: a ring that lands on a tile's edge or corner, to rounding, touches that tile.
const TOUCH = 1e-9;

/** The cover rule: every zoom-z tile the filled ring touches, edge and corner tiles included, so the photos stick out
 * past the line and none inside is ever missing. */
export function coverTiles(ring: Pt[], z: number): CoverTile[] {
	const n = 2 ** z;
	const P = ring.map(([lng, lat]): Pt => {
		const r = (lat * Math.PI) / 180;
		return [((lng + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
	});
	const lo = (v: number) => Math.max(0, Math.ceil(v - TOUCH) - 1);
	const hi = (v: number) => Math.min(n - 1, Math.floor(v + TOUCH));
	const hit = new Set<string>();
	// Liang–Barsky against the tile grown by TOUCH: does segment a→b touch tile x/y?
	const touches = ([ax, ay]: Pt, [bx, by]: Pt, x: number, y: number): boolean => {
		let t0 = 0;
		let t1 = 1;
		const dx = bx - ax;
		const dy = by - ay;
		for (const [p, q] of [[-dx, ax - (x - TOUCH)], [dx, x + 1 + TOUCH - ax], [-dy, ay - (y - TOUCH)], [dy, y + 1 + TOUCH - ay]] as const) {
			if (p === 0) {
				if (q < 0) return false;
				continue;
			}
			const t = q / p;
			if (p < 0) t0 = Math.max(t0, t);
			else t1 = Math.min(t1, t);
			if (t0 > t1) return false;
		}
		return true;
	};
	for (let i = 0; i < P.length; i++) {
		const a = P[i]!;
		const b = P[(i + 1) % P.length]!;
		for (let x = lo(Math.min(a[0], b[0])); x <= hi(Math.max(a[0], b[0])); x++)
			for (let y = lo(Math.min(a[1], b[1])); y <= hi(Math.max(a[1], b[1])); y++) if (touches(a, b, x, y)) hit.add(`${x}/${y}`);
	}
	// A tile no edge touches is wholly inside or wholly out: its centre says which.
	const inside = (px: number, py: number): boolean => {
		let c = false;
		for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
			const [xi, yi] = P[i]!;
			const [xj, yj] = P[j]!;
			if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
		}
		return c;
	};
	const xs = P.map((p) => p[0]);
	const ys = P.map((p) => p[1]);
	const out: CoverTile[] = [];
	for (let x = lo(Math.min(...xs)); x <= hi(Math.max(...xs)); x++)
		for (let y = lo(Math.min(...ys)); y <= hi(Math.max(...ys)); y++)
			if (hit.has(`${x}/${y}`) || inside(x + 0.5, y + 0.5))
				out.push({ x, y, w: tileToLng(x, z), e: tileToLng(x + 1, z), n: tileToLat(y, z), s: tileToLat(y + 1, z) });
	return out;
}

/** Every `z/x/y` a blob's pieces hold at their source's zoom `z`, once each; zoomed out, the same tiles are stitched, never coarser ones. */
export function pieceTileKeys(rings: Pt[][], z: number): string[] {
	return [...new Set(rings.flatMap((r) => coverTiles(r, z).map((t) => `${z}/${t.x}/${t.y}`)))];
}

/** A blob's photo key: its pieces' outer rings, so an edited piece is a new photo. */
export function pieceKey(rings: Pt[][]): string {
	let h = 0x811c9dc5;
	for (const c of rings.map((r) => r.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";")).join("|")) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
	return `piece:${(h >>> 0).toString(36)}:${rings.length}`;
}

/** The jagged outline of every held piece together: each cover tile's side, minus the stretches another piece's cover covers beyond it. */
export function heldEdge(areas: Iterable<{ ring: Pt[]; z: number }>): [number, number][][] {
	const pieces: Bounds[] = [];
	// A side with its own area's tile beyond it is never edge: that drops nearly every side before any search.
	const owner: number[] = [];
	const inner: boolean[][] = [];
	let a = 0;
	for (const { ring, z } of areas) {
		const disc = coverTiles(ring, z);
		const own = new Set(disc.map((t) => `${t.x}/${t.y}`));
		for (const t of disc) {
			pieces.push([t.w, t.s, t.e, t.n]);
			owner.push(a);
			inner.push([own.has(`${t.x}/${t.y - 1}`), own.has(`${t.x}/${t.y + 1}`), own.has(`${t.x + 1}/${t.y}`), own.has(`${t.x - 1}/${t.y}`)]);
		}
		a++;
	}
	const EPS = 1e-9;
	// A coarse grid, so a side is tested only against the pieces near it.
	const CELL = 0.02;
	const cells = new Map<string, number[]>();
	const cellsOf = ([w, s, e, n]: Bounds) => {
		const keys: string[] = [];
		for (let i = Math.floor((w - EPS) / CELL); i <= Math.floor((e + EPS) / CELL); i++)
			for (let j = Math.floor((s - EPS) / CELL); j <= Math.floor((n + EPS) / CELL); j++) keys.push(`${i},${j}`);
		return keys;
	};
	pieces.forEach((p, i) => {
		for (const k of cellsOf(p)) (cells.get(k) ?? cells.set(k, []).get(k)!).push(i);
	});
	const out: [number, number][][] = [];
	// Each side: the line it sits on, its span, and whether a covering piece reaches past it the positive way.
	pieces.forEach((piece, i) => {
		const [w, s, e, n] = piece;
		const sides = ([
			[false, n, w, e, true],
			[false, s, w, e, false],
			[true, e, s, n, true],
			[true, w, s, n, false],
		] as const).filter((_, k) => !inner[i]![k]);
		if (!sides.length) return;
		const near = [...new Set(cellsOf(piece).flatMap((k) => cells.get(k)!))].filter((j) => owner[j] !== owner[i]).map((j) => pieces[j]!);
		for (const [vertical, at, lo, hi, up] of sides) {
			let open: [number, number][] = [[lo, hi]];
			for (const [qw, qs, qe, qn] of near) {
				const [a0, a1, b0, b1] = vertical ? [qw, qe, qs, qn] : [qs, qn, qw, qe];
				if (!(up ? a0 <= at + EPS && a1 > at + EPS : a1 >= at - EPS && a0 < at - EPS)) continue;
				open = open.flatMap(([x, y]): [number, number][] =>
					b1 <= x + EPS || b0 >= y - EPS ? [[x, y]] : ([[x, Math.max(x, b0)], [Math.min(y, b1), y]] as [number, number][]).filter(([u, v]) => v - u > EPS),
				);
				if (!open.length) break;
			}
			for (const [x, y] of open) out.push(vertical ? [[at, x], [at, y]] : [[x, at], [y, at]]);
		}
	});
	return out;
}

/** A held area: its tiles live in the tile store under its source; this record says they are all there. */
export interface SatImage {
	bakeVersion: number;
	/** the source's name, as Squirrel and the credits show it */
	source: string;
	/** its close tiles' zoom */
	zoom: number;
	/** ask → every tile on disk */
	ms?: number;
	wire?: PhotoWire;
}

/** A save's tiles by origin: this phone's disk, a Worker cache hit (X-Cache HIT), or the source (MISS); `kept` says the Worker wrote those misses to R2. */
export interface PhotoWire {
	disk: number;
	hit: number;
	miss: number;
	/** what this bake put on the phone, counted as it landed */
	tiles: number;
	bytes: number;
	kept: boolean;
}

const idb = makeKeyedIdbStore<SatImage>({ dbName: DB_NAME, storeName: STORE });

/** The one freshness test: the save and the photo pass both ask it. */
export function isCurrentPhoto(img: SatImage | undefined): img is SatImage {
	return !!img && img.bakeVersion === BAKE_VERSION && !!sourceNamed(img.source);
}

export async function deleteSatImage(key: string): Promise<void> {
	await idb.delete(key);
}

/** The tile store was emptied: a record must not outlive its tiles, or the pass takes it as baked and never bakes again. */
export async function deleteAllSatImages(): Promise<void> {
	await Promise.all((await idb.keys()).map((k) => idb.delete(k)));
}

/** A current record, or absent. */
export async function getSatImageByKey(key: string): Promise<SatImage | undefined> {
	const img = await idb.get(key);
	return isCurrentPhoto(img) ? img : undefined;
}

/** Every area's record, current or not; projected, because a record from before tiles still holds its photo. */
export async function satImageMeta(): Promise<({ key: string } & Partial<SatImage>)[]> {
	const [keys, meta] = await Promise.all([
		idb.keys(),
		idb.getAllProjected(({ bakeVersion, source, zoom, ms, wire }) => ({ bakeVersion, source, zoom, ms, wire })),
	]);
	return keys.map((key, i) => ({ key, ...meta[i] }));
}

/** A stable key for an area centre. */
export function satImageKey(c: [number, number]): string {
	return `${c[0].toFixed(4)},${c[1].toFixed(4)}`;
}

/** The save's only way to tiles: `z/x/y` → bytes from `source` (the area's own when omitted), each kept on disk before it
 * answers. A key missing from the answer failed; an empty buffer is ground the source has no imagery for. */
export type PhotoTileSource = (keys: string[], source?: string) => Promise<Map<string, ArrayBuffer>>;

/** Fills ground the area's source has no imagery for: free, and covers the whole world. */
const FILL = "sentinel";

/** Hold a piece: every tile `pieceTileKeys` names, on disk, then its record. Null unless every tile arrived; the ones
 * that did are kept, so the next pass asks only for the rest. `beforeSave` throws to keep the record off disk. */
export async function saveAreaTiles(
	key: string,
	rings: Pt[][],
	src: SatelliteSource,
	tiles: PhotoTileSource,
	beforeSave?: () => Promise<void>,
	wire?: PhotoWire,
): Promise<SatImage | null> {
	const existing = await idb.get(key);
	if (isCurrentPhoto(existing)) return existing;
	if (sessionCap.tripped) return null;

	const t0 = performance.now();
	const keys = pieceTileKeys(rings, src.zoom);
	// Per piece: one blob may carry many pieces, each held to the cap on its own.
	for (const r of rings) guardBakeGrid(pieceTileKeys([r], src.zoom).length, { key, z: src.zoom });
	const have = await tiles(keys);
	if (keys.some((k) => !have.has(k))) return null;
	const fz = SATELLITE_SOURCES[FILL].zoom;
	const holes = [...new Set(keys.filter((k) => !have.get(k)!.byteLength).flatMap((k) => {
		const [z, x, y] = k.split("/").map(Number) as [number, number, number];
		return z > fz ? [`${fz}/${x >> (z - fz)}/${y >> (z - fz)}`] : [];
	}))];
	if (holes.length) {
		const fill = await tiles(holes, FILL);
		if (holes.some((k) => !fill.get(k)?.byteLength)) return null;
	}
	const out: SatImage = { bakeVersion: BAKE_VERSION, source: src.name, zoom: src.zoom, ms: Math.round(performance.now() - t0), wire };
	await beforeSave?.();
	await idb.put(key, out);
	return out;
}
