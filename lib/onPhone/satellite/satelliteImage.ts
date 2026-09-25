import {
	guardBakeGrid,
	noteSatelliteTiles,
} from "../store/downloadGuard";
import { kmBetween, kmToDegSpan } from "../../shared/kmGeo";
import { makeKeyedIdbStore } from "../store/keyedIdbStore";
import {
	isBestPhotoSource,
	type PhotoSource,
	photoSourcesFor,
} from "./photoSources";

/** Against Chrome's per-host ceiling; higher risks EOX throttling and starves the concurrent roads download. */
const SAT_FETCH_CONCURRENCY = 16;
/** Satellite-photo radius (km); the page spaces line samples by it so discs overlap. */
export const BAKE_RADIUS_KM = 2;
const DB_NAME = "gc-offlineSatellite";
const STORE = "images";

export type Bounds = [number, number, number, number]; // [w,s,e,n]

/** Bump whenever bake geometry changes, or a mis-bounded photo stays pinned forever. */
export const BAKE_VERSION = 7;

export interface SatImage {
	blob: Blob;
	bounds: Bounds;
	bakeVersion?: number;
	source?: string;
	/** At bake time; the registry can change under a stored photo. */
	zoom?: number;
	canvasPx?: number;
}

const idb = makeKeyedIdbStore<SatImage>({ dbName: DB_NAME, storeName: STORE });

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
	return keys.map((k, i) => ({ key: k, img: vals[i] }));
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
		})),
	]);
	return keys.map((k, i) => ({ key: k, ...meta[i] }));
}
export async function getSatKeys(): Promise<string[]> {
	return idb.keys();
}

/** A stable key for an area centre. */
export function satImageKey(c: [number, number]): string {
	return `${c[0].toFixed(4)},${c[1].toFixed(4)}`;
}

/** Well inside BAKE_RADIUS_KM: a centre near the disc's edge sits where the mask fades. */
export const PHOTO_REUSE_KM = 1;

/** Both halves live here so the bake and the dedup sweep answer identically. */
export function photoReusableFor(
	haveSource: string | undefined,
	haveCenter: [number, number],
	wantCenter: [number, number],
): boolean {
	return (
		kmBetween(haveCenter, wantCenter) <= PHOTO_REUSE_KM &&
		isBestPhotoSource(haveSource, wantCenter[0], wantCenter[1])
	);
}

function centerOfKey(key: string): [number, number] | null {
	const [lng, lat] = key.split(",").map(Number);
	return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

/** The key dedups at ~11 m but a photo covers 2 km; this asks about the ground. Keys only, never blobs. */
export async function photoCovering(
	center: [number, number],
): Promise<SatImage | undefined> {
	const exact = await getSatImageByKey(satImageKey(center));
	if (exact) return exact;
	let bestKey: string | null = null;
	let bestKm = PHOTO_REUSE_KM;
	for (const key of await idb.keys()) {
		const c = centerOfKey(key);
		if (!c) continue;
		const km = kmBetween(center, c);
		if (km <= bestKm) {
			bestKm = km;
			bestKey = key;
		}
	}
	if (!bestKey) return undefined;
	const near = await getSatImageByKey(bestKey);
	if (!near) return undefined;
	const c = centerOfKey(bestKey);
	return c && photoReusableFor(near.source, c, center) ? near : undefined;
}

function lngToTileX(lng: number, z: number): number {
	return Math.floor(((lng + 180) / 360) * 2 ** z);
}
function latToTileY(lat: number, z: number): number {
	const r = (lat * Math.PI) / 180;
	return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
}
function tileToLng(x: number, z: number): number {
	return (x / 2 ** z) * 360 - 180;
}
function tileToLat(y: number, z: number): number {
	const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
	return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function loadImage(url: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const img = new Image();
		// <img> has no AbortSignal, so the lie-fi timeout is a timer.
		const timer = setTimeout(() => resolve(null), 20_000);
		img.crossOrigin = "anonymous";
		img.onload = () => {
			clearTimeout(timer);
			resolve(img);
		};
		img.onerror = () => {
			clearTimeout(timer);
			resolve(null);
		};
		img.src = url;
	});
}
async function pool(n: number, limit: number, fn: (i: number) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < n) {
			const i = next++;
			await fn(i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, n) }, worker));
}

type TileSrc = ImageBitmap | HTMLImageElement;
/** Keep in sync with CACHE_MAX in satBakeWorker.ts. 48 × 262 KB ≈ 12 MB. */
const TILE_CACHE_MAX = 48;
const tileCache = new Map<string, Promise<TileSrc | null>>();
function loadTileBitmap(url: string): Promise<TileSrc | null> {
	const hit = tileCache.get(url);
	if (hit) {
		tileCache.delete(url);
		tileCache.set(url, hit); // LRU bump
		return hit;
	}
	const p = (async (): Promise<TileSrc | null> => {
		try {
			if (typeof createImageBitmap === "function") {
				// A stalled tile otherwise pins the connection for the full TCP timeout.
				const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
				if (!r.ok) return null;
				return await createImageBitmap(await r.blob());
			}
			return await loadImage(url);
		} catch {
			return null;
		}
	})();
	tileCache.set(url, p);
	p.then((v) => {
		if (!v) tileCache.delete(url);
	}).catch(() => tileCache.delete(url));
	// `while`, not `if`: an `if` cannot shrink an already-over cache.
	while (tileCache.size > TILE_CACHE_MAX) {
		const oldest = tileCache.keys().next().value as string | undefined;
		if (oldest === undefined || oldest === url) break;
		const ev = tileCache.get(oldest);
		tileCache.delete(oldest);
		ev?.then((v) => {
			if (v && "close" in v) v.close();
		// codestyle-allow-swallow: bitmap cache eviction is best-effort; close() failure leaves GPU memory until GC, not a data loss
		}).catch(() => { /* best-effort eviction */ });
	}
	return p;
}

type TileDraw = { url: string; dx: number; dy: number; dw: number; dh: number };
type BakeRes = { id: number; blob: Blob | null; loaded: number; fetched: number };
let bakeWorker: Worker | null = null;
let workerBroken = false;
let reqId = 0;
const pendingBakes = new Map<number, (r: BakeRes) => void>();

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
		};
		return bakeWorker;
	} catch {
		workerBroken = true;
		return null;
	}
}

/** Resolves null if the worker is unavailable or hangs; the caller falls back to the main thread. */
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
		const timer = setTimeout(() => {
			if (pendingBakes.has(id)) {
				pendingBakes.delete(id);
				resolve(null);
			}
		}, 30000);
		const done = pendingBakes.get(id);
		if (done) {
			pendingBakes.set(id, (r) => {
				clearTimeout(timer);
				resolve(r);
			});
		}
		wk.postMessage({ id, tiles, w, h, quality });
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

/** Bake the masked photo for a centre; sources are tried in registry order. Null only if none drew. */
export async function bakeSatelliteImage(
	center: [number, number],
): Promise<SatImage | null> {
	const key = satImageKey(center);
	const existing = await idb.get(key);
	// A stale stamp or a since-beaten source is a miss, so a sharper source reaches ground already saved
	if (
		existing &&
		existing.bakeVersion === BAKE_VERSION &&
		isBestPhotoSource(existing.source, center[0], center[1])
	)
		return existing;
	const covering = await photoCovering(center);
	if (covering) return covering;
	// Offline, every tile fetch would fail and trip the session breaker.
	if (typeof navigator !== "undefined" && navigator.onLine === false)
		return existing ?? null;

	for (const src of photoSourcesFor(center[0], center[1])) {
		const out = await bakeFrom(src, center);
		if (out) {
			await idb.put(key, out);
			return out;
		}
	}
	return existing ?? null;
}

/** One source's bake. Null when fewer than 40% of the disc's tiles drew. */
async function bakeFrom(
	src: PhotoSource,
	center: [number, number],
): Promise<SatImage | null> {
	const [clng, clat] = center;
	const z = src.zoom;
	const { dLat, dLng } = kmToDegSpan(BAKE_RADIUS_KM, clat);
	const xMin = lngToTileX(clng - dLng, z);
	const xMax = lngToTileX(clng + dLng, z);
	const yMin = latToTileY(clat + dLat, z);
	const yMax = latToTileY(clat - dLat, z);

	const tileGeo: { x: number; y: number; w: number; e: number; n: number; s: number }[] = [];
	for (let x = xMin; x <= xMax; x++) {
		for (let y = yMin; y <= yMax; y++) {
			const w = tileToLng(x, z);
			const e = tileToLng(x + 1, z);
			const n = tileToLat(y, z);
			const s = tileToLat(y + 1, z);
			const cx = Math.min(Math.max(clng, w), e);
			const cy = Math.min(Math.max(clat, s), n);
			if (kmBetween([clng, clat], [cx, cy]) > BAKE_RADIUS_KM) continue;
			tileGeo.push({ x, y, w, e, n, s });
		}
	}
	if (!tileGeo.length) return null;

	guardBakeGrid(tileGeo.length, { center, z, radiusKm: BAKE_RADIUS_KM });

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
	const span = kmToDegSpan(BAKE_RADIUS_KM, clat);
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
	const tileDraw: TileDraw[] = tileGeo.map((t) => {
		const dx = Math.floor(xf(t.w));
		const dy = Math.floor(yf(t.n));
		return {
			url: src.url(z, t.x, t.y),
			dx,
			dy,
			// +1 px so adjacent tiles overlap (no plaid).
			dw: Math.ceil(xf(t.e) - dx) + 1,
			dh: Math.ceil(yf(t.s) - dy) + 1,
		};
	});

	let blob: Blob | null = null;
	let fetched = 0;
	let loaded = 0;

	if (offscreenSupported()) {
		const res = await compositeInWorker(tileDraw, W, H, src.quality);
		if (res?.blob) {
			blob = res.blob;
			fetched = res.fetched;
			loaded = res.loaded;
		}
	}

	if (!blob) {
		const canvas = document.createElement("canvas");
		canvas.width = W;
		canvas.height = H;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		let mtFetched = 0;
		await pool(tileDraw.length, SAT_FETCH_CONCURRENCY, async (i) => {
			const t = tileDraw[i];
			const wasCached = tileCache.has(t.url);
			const src = await loadTileBitmap(t.url);
			if (!src) return;
			if (!wasCached) mtFetched += 1;
			ctx.drawImage(src, t.dx, t.dy, t.dw, t.dh);
			loaded += 1;
		});
		if (!loaded) return null;
		// WebP keeps the alpha channel for the jagged mask; older WKWebView falls back to PNG.
		blob = await new Promise<Blob | null>((res) =>
			canvas.toBlob((b) => res(b), "image/webp", src.quality),
		);
		fetched = mtFetched;
	}

	if (!blob) return null;

	// A mostly-empty disc is a throttled fetch, not a photo; fail so the reconcile retries.
	const minTiles = Math.max(1, Math.ceil(tileGeo.length * 0.4));
	if (loaded < minTiles) return null;

	if (fetched > 0) noteSatelliteTiles(fetched);
	return {
		blob,
		bounds: [cw, cs, ce, cn],
		bakeVersion: BAKE_VERSION,
		source: src.name,
		zoom: src.zoom,
		canvasPx: src.canvasPx,
	};
}
