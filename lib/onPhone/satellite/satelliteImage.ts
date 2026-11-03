import { guardBakeGrid } from "../store/downloadGuard";
import { sessionCap } from "../../shared/sessionByteCap.svelte";
import { kmBetween, kmToDegSpan } from "../../shared/kmGeo";
import { latToTileY, lngToTileX, tileToLat, tileToLng } from "../../contract/geo";
import { makeKeyedIdbStore } from "../store/keyedIdbStore";
import { SATELLITE_SOURCES, type SatelliteSource, sourceNamed } from "../../contract/satelliteSources";

/** The source whose raw tiles stay on disk for the close-up; any other's photo already holds every pixel it has. */
export const CLOSE_UP = SATELLITE_SOURCES.maptiler;

/** What one photo physically holds around its centre. */
export const PHOTO_COVERAGE_RADIUS_KM = 2;
/** How close to a photo's edge a pin may sit and still use that photo: the mask fades there. */
export const PHOTO_EDGE_MARGIN_KM = 1;
/** A pin within this of an existing photo's centre uses that photo; beyond it, it bakes its own. */
export const PHOTO_REUSE_KM = PHOTO_COVERAGE_RADIUS_KM - PHOTO_EDGE_MARGIN_KM;
const DB_NAME = "gc-offlineSatellite";
const STORE = "photoDiscs";

export type Bounds = [number, number, number, number]; // [w,s,e,n]

/** Bump whenever bake geometry changes, or a mis-bounded photo stays pinned forever. */
export const BAKE_VERSION = 11;

/** A source tile as fetched, keyed `z/x/y`: the close-up the shrunk photo cannot hold. */
export type RawTile = [string, ArrayBuffer];

export interface DiscTile {
	x: number;
	y: number;
	w: number;
	e: number;
	n: number;
	s: number;
}

/** The zoom-z tiles whose ground reaches within PHOTO_COVERAGE_RADIUS_KM of the centre — the bake's and the eviction's one answer. */
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

/** The outline of every held photo together: each visible piece's side, minus the stretches some piece of any photo
 * covers beyond it. A piece is a disc tile cut to its photo's box, so photos of any zoom or crop meet cleanly. */
export function heldEdge(photos: Iterable<{ bounds: Bounds; z: number }>): [number, number][][] {
	const pieces: Bounds[] = [];
	for (const { bounds: [w, s, e, n], z } of photos)
		for (const t of photoTilesFor([(w + e) / 2, (s + n) / 2], z)) {
			const p: Bounds = [Math.max(t.w, w), Math.max(t.s, s), Math.min(t.e, e), Math.min(t.n, n)];
			if (p[0] < p[2] && p[1] < p[3]) pieces.push(p);
		}
	const EPS = 1e-9;
	// A coarse grid, so a side is tested only against the pieces near it.
	const CELL = 0.02;
	const cells = new Map<string, Bounds[]>();
	const cellsOf = ([w, s, e, n]: Bounds) => {
		const keys: string[] = [];
		for (let i = Math.floor((w - EPS) / CELL); i <= Math.floor((e + EPS) / CELL); i++)
			for (let j = Math.floor((s - EPS) / CELL); j <= Math.floor((n + EPS) / CELL); j++) keys.push(`${i},${j}`);
		return keys;
	};
	for (const p of pieces) for (const k of cellsOf(p)) (cells.get(k) ?? cells.set(k, []).get(k)!).push(p);
	const out: [number, number][][] = [];
	// Each side: the line it sits on, its span, and whether a covering piece reaches past it the positive way.
	for (const piece of pieces) {
		const [w, s, e, n] = piece;
		const near = new Set(cellsOf(piece).flatMap((k) => cells.get(k)!));
		for (const [vertical, at, lo, hi, up] of [
			[false, n, w, e, true],
			[false, s, w, e, false],
			[true, e, s, n, true],
			[true, w, s, n, false],
		] as const) {
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
	}
	return out;
}

export interface SatImage {
	blob: Blob;
	bounds: Bounds;
	bakeVersion?: number;
	source?: string;
	/** At bake time; the registry can change under a stored photo. */
	zoom?: number;
	canvasPx?: number;
	/** ask → on disk: the satellite download and the bake together */
	ms?: number;
	/** where its tiles came from; absent on a photo baked before this was counted */
	wire?: PhotoWire;
}

/** A bake's tiles by origin: this phone's disk, a Worker cache hit (X-Cache HIT), or the source (MISS); `kept` says the Worker wrote those misses to R2. */
export interface PhotoWire {
	disk: number;
	hit: number;
	miss: number;
	kept: boolean;
}

const idb = makeKeyedIdbStore<SatImage>({ dbName: DB_NAME, storeName: STORE });

/** The one freshness test: the bake and the photo pass both ask it, so a stale photo cannot be kept by one and re-baked by the other. */
export function isCurrentPhoto(img: SatImage | undefined): img is SatImage {
	return !!img && img.bakeVersion === BAKE_VERSION && !!sourceNamed(img.source);
}

export async function deleteSatImage(key: string): Promise<void> {
	await idb.delete(key);
}

/** Pure read; a stale-geometry photo is absent, never mounted mis-bounded. */
export async function getSatImageByKey(
	key: string,
): Promise<SatImage | undefined> {
	const img = await idb.get(key);
	return img && img.bakeVersion === BAKE_VERSION ? img : undefined;
}

/** Every stored photo, full blobs — never on a timer: it materialises every photo in the heap at once (613 MB OOM-crashed the tab). Sizes: satImageMeta().
 * codestyle-allow-blob-getall: admin /blobs export, one click.
 */
export async function getAllSatImages(): Promise<{ key: string; img: SatImage }[]> {
	const [keys, vals] = await Promise.all([idb.keys(), idb.getAll()]);
	return keys.map((k, i) => ({ key: k, img: vals[i]! }));
}

/** Per-area metadata, never pixels; cursor-streamed so peak heap is one photo. */
export async function satImageMeta(): Promise<
	{
		key: string;
		bytes: number;
		bakeVersion?: number;
		source?: string;
		zoom?: number;
		canvasPx?: number;
		ms?: number;
		wire?: PhotoWire;
	}[]
> {
	const [keys, meta] = await Promise.all([
		idb.keys(),
		idb.getAllProjected((v) => ({
			bytes: v.blob.size,
			bakeVersion: v.bakeVersion,
			source: v.source,
			zoom: v.zoom,
			canvasPx: v.canvasPx,
			ms: v.ms,
			wire: v.wire,
		})),
	]);
	return keys.map((k, i) => ({ key: k, ...meta[i]! }));
}
export async function getSatKeys(): Promise<string[]> {
	return idb.keys();
}

/** A stable key for an area centre. */
export function satImageKey(c: [number, number]): string {
	return `${c[0].toFixed(4)},${c[1].toFixed(4)}`;
}

/** The bake's only way to tiles: `z/x/y` → bytes from `source` (the photo's own when omitted). A key missing from the
 * answer failed; an empty buffer is ground the source has no imagery for. */
export type PhotoTileSource = (keys: string[], source?: string) => Promise<Map<string, ArrayBuffer>>;

/** Fills ground the photo's source has no imagery for: free, and covers the whole world. */
const FILL = "sentinel";

type TileDraw = { buf: ArrayBuffer; dx: number; dy: number; dw: number; dh: number };
type BakeRes = { id: number; blob: Blob | null; loaded: number };
let bakeWorker: Worker | null = null;
let workerBroken = false;
let reqId = 0;
const pendingBakes = new Map<number, (r: BakeRes | null) => void>();

function offscreenSupported(): boolean {
	return (
		typeof Worker !== "undefined" &&
		typeof OffscreenCanvas !== "undefined" &&
		typeof createImageBitmap === "function" &&
		typeof OffscreenCanvas.prototype.convertToBlob === "function"
	);
}

function getBakeWorker(): Worker | null {
	if (workerBroken) return null;
	if (bakeWorker) return bakeWorker;
	try {
		bakeWorker = new Worker(new URL("./satBakeWorker.ts", import.meta.url), {
			type: "module",
		});
		bakeWorker.onmessage = (e: MessageEvent<BakeRes>) => {
			const cb = pendingBakes.get(e.data.id);
			if (cb) {
				pendingBakes.delete(e.data.id);
				cb(e.data);
			}
		};
		bakeWorker.onerror = () => {
			workerBroken = true;
			bakeWorker = null;
			for (const cb of pendingBakes.values()) cb(null);
			pendingBakes.clear();
		};
		return bakeWorker;
	} catch {
		workerBroken = true;
		return null;
	}
}

/** Resolves null only if the worker is unavailable or dies; a bake that ran and drew nothing is a result. */
function compositeInWorker(
	tiles: TileDraw[],
	w: number,
	h: number,
	quality: number,
): Promise<BakeRes | null> {
	const wk = getBakeWorker();
	if (!wk) return Promise.resolve(null);
	const id = ++reqId;
	return new Promise<BakeRes | null>((resolve) => {
		pendingBakes.set(id, resolve);
		wk.postMessage({ id, tiles, w, h, quality }, tiles.map((t) => t.buf));
	}).finally(() => {
		scheduleBakeWorkerTeardown();
	});
}

/** Retire the idle worker to free its heap; it respawns lazily. Never set `workerBroken` here. */
const BAKE_WORKER_IDLE_MS = 30_000;
let bakeTeardownTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleBakeWorkerTeardown(): void {
	clearTimeout(bakeTeardownTimer);
	bakeTeardownTimer = setTimeout(() => {
		// Terminating mid-bake would strand its resolver until the timeout.
		if (pendingBakes.size > 0) {
			scheduleBakeWorkerTeardown();
			return;
		}
		if (bakeWorker) {
			bakeWorker.terminate();
			bakeWorker = null;
		}
	}, BAKE_WORKER_IDLE_MS);
}

/** Bake the masked photo for a centre from `src`'s `tiles`. Null when too few drew.
 * `beforeSave` throws to keep the photo off disk. */
export async function bakeSatelliteImage(
	key: string,
	center: [number, number],
	src: SatelliteSource,
	tiles: PhotoTileSource,
	beforeSave?: () => Promise<void>,
	/** filled by `tiles` as they arrive; stored with the photo */
	wire?: PhotoWire,
): Promise<SatImage | null> {
	const existing = await idb.get(key);
	// A stale stamp is a miss; a photo from a source switched away from stays until it is re-baked.
	if (isCurrentPhoto(existing)) return existing;
	if (sessionCap.tripped) return existing ?? null;

	const t0 = performance.now();
	const out = await bakeFrom(src, center, tiles);
	if (!out) return existing ?? null;
	out.ms = Math.round(performance.now() - t0);
	out.wire = wire;
	await beforeSave?.();
	await idb.put(key, out);
	return out;
}

/** One source's bake. Null unless every tile of the disc drew. */
async function bakeFrom(
	src: SatelliteSource,
	center: [number, number],
	tiles: PhotoTileSource,
): Promise<SatImage | null> {
	const [clng, clat] = center;
	const z = src.zoom;
	const tileGeo = photoTilesFor(center, z);
	if (!tileGeo.length) return null;

	guardBakeGrid(tileGeo.length, { center, z, radiusKm: PHOTO_COVERAGE_RADIUS_KM });

	// A loop, not Math.min(...spread): the spread trips the arg-spread guard.
	let bw = Infinity;
	let be = -Infinity;
	let bn = -Infinity;
	let bs = Infinity;
	for (const t of tileGeo) {
		if (t.w < bw) bw = t.w;
		if (t.e > be) be = t.e;
		if (t.n > bn) bn = t.n;
		if (t.s < bs) bs = t.s;
	}
	// Crop to the pin's own box: the raw tile union snaps the pin off-centre; bounds and pixels both derive from cw/cs/ce/cn
	const span = kmToDegSpan(PHOTO_COVERAGE_RADIUS_KM, clat);
	const cw = Math.max(bw, clng - span.dLng);
	const ce = Math.min(be, clng + span.dLng);
	const cs = Math.max(bs, clat - span.dLat);
	const cn = Math.min(bn, clat + span.dLat);

	const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
	const yTop = mercY(cn);
	const yExt = yTop - mercY(cs);
	const xExt = ((ce - cw) * Math.PI) / 180;
	const W = src.canvasPx;
	const H = Math.max(1, Math.round((W * yExt) / xExt));

	const xf = (lng: number) => (((lng - cw) * Math.PI) / 180 / xExt) * W;
	const yf = (lat: number) => ((yTop - mercY(lat)) / yExt) * H;
	const keys = tileGeo.map((t) => `${z}/${t.x}/${t.y}`);
	const have = await tiles(keys);
	// A photo is saved whole or not at all: a stored photo is never baked again, so a hole saved now stays for good.
	if (keys.some((k) => !have.has(k))) return null;
	const tileDraw: TileDraw[] = [];
	const draw = (buf: ArrayBuffer, w: number, e: number, n: number, s: number): void => {
		const dx = Math.floor(xf(w));
		const dy = Math.floor(yf(n));
		// +1 px so adjacent tiles overlap (no plaid).
		tileDraw.push({ buf, dx, dy, dw: Math.ceil(xf(e) - dx) + 1, dh: Math.ceil(yf(s) - dy) + 1 });
	};
	const lacking = keys.filter((k) => !have.get(k)!.byteLength);
	if (lacking.length) {
		// Drawn first, so the source's own tiles land over the parent squares' spare ground.
		const fz = Math.min(z, SATELLITE_SOURCES[FILL].maxZ);
		const parents = [...new Set(lacking.map((k) => {
			const [, x, y] = k.split("/").map(Number) as [number, number, number];
			return `${fz}/${x >> (z - fz)}/${y >> (z - fz)}`;
		}))];
		const fill = await tiles(parents, FILL);
		for (const p of parents) {
			const buf = fill.get(p);
			if (!buf?.byteLength) return null;
			const [, x, y] = p.split("/").map(Number) as [number, number, number];
			draw(buf, tileToLng(x, fz), tileToLng(x + 1, fz), tileToLat(y, fz), tileToLat(y + 1, fz));
		}
	}
	tileGeo.forEach((t, i) => {
		const buf = have.get(keys[i]!)!;
		if (buf.byteLength) draw(buf, t.w, t.e, t.n, t.s);
	});
	const want = tileDraw.length;

	let blob: Blob | null = null;
	let loaded = 0;
	const res = offscreenSupported()
		? await compositeInWorker(tileDraw, W, H, src.quality)
		: null;
	if (res) {
		({ blob, loaded } = res);
	} else {
		const canvas = document.createElement("canvas");
		canvas.width = W;
		canvas.height = H;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		for (const t of tileDraw) {
			const bm = await createImageBitmap(new Blob([t.buf])).catch(() => null);
			if (!bm) continue;
			ctx.drawImage(bm, t.dx, t.dy, t.dw, t.dh);
			bm.close();
			loaded += 1;
		}
		// WebP keeps the alpha channel for the jagged mask; older WKWebView falls back to PNG.
		blob = await new Promise<Blob | null>((r) =>
			canvas.toBlob((b) => r(b), "image/webp", src.quality),
		);
	}
	if (!blob || loaded < want) return null;

	return {
		blob,
		bounds: [cw, cs, ce, cn],
		bakeVersion: BAKE_VERSION,
		source: src.name,
		zoom: src.zoom,
		canvasPx: src.canvasPx,
	};
}
