import { guardBakeGrid } from "../store/downloadGuard";
import { sessionCap } from "../../shared/sessionByteCap.svelte";
import { kmBetween, kmToDegSpan } from "../../shared/kmGeo";
import { latToTileY, lngToTileX, tileToLat, tileToLng } from "../../contract/geo";
import { makeKeyedIdbStore } from "../store/keyedIdbStore";
import { SATELLITE_SOURCES, type SatelliteSource, sourceNamed } from "../../contract/satelliteSources";

/** What one held area's close tiles cover around its centre. */
export const PHOTO_COVERAGE_RADIUS_KM = 2;
/** How close to an area's edge a pin may sit and still use that area. */
export const PHOTO_EDGE_MARGIN_KM = 1;
/** A pin within this of an existing area's centre uses that area; beyond it, it holds its own. */
export const PHOTO_REUSE_KM = PHOTO_COVERAGE_RADIUS_KM - PHOTO_EDGE_MARGIN_KM;
const DB_NAME = "gc-offlineSatellite";
const STORE = "photoDiscs";

export type Bounds = [number, number, number, number]; // [w,s,e,n]

/** Bump whenever what an area holds changes: an older record is not current, so the pass saves the area again. */
export const BAKE_VERSION = 12;

/** Every held area also keeps its source's tiles at these zooms, so a zoomed-out map has its ground. */
export const FAR_ZOOMS = [10, 11, 12] as const;

/** A source tile as fetched, keyed `z/x/y`. */
export type RawTile = [string, ArrayBuffer];

export interface DiscTile {
	x: number;
	y: number;
	w: number;
	e: number;
	n: number;
	s: number;
}

/** The zoom-z tiles whose ground reaches within PHOTO_COVERAGE_RADIUS_KM of the centre. */
export function photoTilesFor(center: [number, number], z: number): DiscTile[] {
	const [clng, clat] = center;
	const { dLat, dLng } = kmToDegSpan(PHOTO_COVERAGE_RADIUS_KM, clat);
	const out: DiscTile[] = [];
	for (let x = lngToTileX(clng - dLng, z); x <= lngToTileX(clng + dLng, z); x++) {
		for (let y = latToTileY(clat + dLat, z); y <= latToTileY(clat - dLat, z); y++) {
			const w = tileToLng(x, z);
			const e = tileToLng(x + 1, z);
			const n = tileToLat(y, z);
			const s = tileToLat(y + 1, z);
			const cx = Math.min(Math.max(clng, w), e);
			const cy = Math.min(Math.max(clat, s), n);
			if (kmBetween([clng, clat], [cx, cy]) <= PHOTO_COVERAGE_RADIUS_KM) out.push({ x, y, w, e, n, s });
		}
	}
	return out;
}

/** Every `z/x/y` an area centred here holds from a source whose close zoom is `z`: the overview zooms, then the disc. */
export function areaTileKeys(center: [number, number], z: number): string[] {
	return [...FAR_ZOOMS, z].flatMap((tz) => photoTilesFor(center, tz).map((t) => `${tz}/${t.x}/${t.y}`));
}

/** The outline of every held area together: each disc tile's side, minus the stretches another area's disc covers beyond it. */
export function heldEdge(areas: Iterable<{ center: [number, number]; z: number }>): [number, number][][] {
	const pieces: Bounds[] = [];
	// A side with its own area's tile beyond it is never edge: that drops nearly every side before any search.
	const owner: number[] = [];
	const inner: boolean[][] = [];
	let a = 0;
	for (const { center, z } of areas) {
		const disc = photoTilesFor(center, z);
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

/** Hold an area: every tile `areaTileKeys` names, on disk, then its record. Null unless every tile arrived; the ones
 * that did are kept, so the next pass asks only for the rest. `beforeSave` throws to keep the record off disk. */
export async function saveAreaTiles(
	key: string,
	center: [number, number],
	src: SatelliteSource,
	tiles: PhotoTileSource,
	beforeSave?: () => Promise<void>,
	wire?: PhotoWire,
): Promise<SatImage | null> {
	const existing = await idb.get(key);
	if (isCurrentPhoto(existing)) return existing;
	if (sessionCap.tripped) return null;

	const t0 = performance.now();
	const keys = areaTileKeys(center, src.zoom);
	guardBakeGrid(keys.length, { center, z: src.zoom, radiusKm: PHOTO_COVERAGE_RADIUS_KM });
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
