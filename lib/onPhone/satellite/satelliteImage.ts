import { guardBakeGrid } from "../store/downloadGuard";
import { sessionCap } from "../../shared/sessionByteCap.svelte";
import { kmBetween, kmToDegSpan } from "../../shared/kmGeo";
import { latToTileY, lngToTileX, tileToLat, tileToLng } from "../../contract/geo";
import { makeKeyedIdbStore } from "../store/keyedIdbStore";
import { isBestPhotoSource, PHOTO_SOURCES, type PhotoSource } from "./photoSources";

/** Satellite-photo radius (km); the page spaces line samples by it so discs overlap. */
export const BAKE_RADIUS_KM = 2;
const DB_NAME = "gc-offlineSatellite";
const STORE = "photos";

export type Bounds = [number, number, number, number]; // [w,s,e,n]

/** Bump whenever bake geometry changes, or a mis-bounded photo stays pinned forever. */
export const BAKE_VERSION = 10;

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

/** The zoom-z tiles whose ground reaches within BAKE_RADIUS_KM of the centre — the bake's and the eviction's one answer. */
export function photoTilesFor(center: [number, number], z: number): DiscTile[] {
	const [clng, clat] = center;
	const { dLat, dLng } = kmToDegSpan(BAKE_RADIUS_KM, clat);
	const out: DiscTile[] = [];
	for (let x = lngToTileX(clng - dLng, z); x <= lngToTileX(clng + dLng, z); x++) {
		for (let y = latToTileY(clat + dLat, z); y <= latToTileY(clat - dLat, z); y++) {
			const w = tileToLng(x, z);
			const e = tileToLng(x + 1, z);
			const n = tileToLat(y, z);
			const s = tileToLat(y + 1, z);
			const cx = Math.min(Math.max(clng, w), e);
			const cy = Math.min(Math.max(clat, s), n);
			if (kmBetween([clng, clat], [cx, cy]) <= BAKE_RADIUS_KM) out.push({ x, y, w, e, n, s });
		}
	}
	return out;
}

export interface SatImage {
	blob: Blob;
	bounds: Bounds;
	/** The exact point it was baked around; reuse is judged by this, never by parsing the key. */
	center: [number, number];
	bakeVersion?: number;
	source?: string;
	/** At bake time; the registry can change under a stored photo. */
	zoom?: number;
	canvasPx?: number;
	/** ask → on disk: the satellite download and the bake together */
	ms?: number;
}

const idb = makeKeyedIdbStore<SatImage>({ dbName: DB_NAME, storeName: STORE });

/** The one freshness test: the bake and the photo pass both ask it, so a stale photo cannot be kept by one and re-baked by the other. */
export function isCurrentPhoto(img: SatImage | undefined): img is SatImage {
	return !!img && img.bakeVersion === BAKE_VERSION && isBestPhotoSource(img.source);
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
		ms?: number;
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
		isBestPhotoSource(haveSource)
	);
}

/** The key dedups at ~11 m but a photo covers 2 km; this asks about the ground, by each photo's stored centre. Reads one blob: the one it returns. */
export async function photoCovering(
	ownKey: string,
	center: [number, number],
): Promise<SatImage | undefined> {
	// The pin's own key is the caller's to judge: stale there must re-bake, not be "reused".
	const [keys, have] = await Promise.all([
		idb.keys(),
		idb.getAllProjected((v) => ({ center: v.center, source: v.source })),
	]);
	let bestKey: string | null = null;
	let bestKm = PHOTO_REUSE_KM;
	keys.forEach((key, i) => {
		if (key === ownKey || !photoReusableFor(have[i].source, have[i].center, center)) return;
		const km = kmBetween(center, have[i].center);
		if (km <= bestKm) {
			bestKm = km;
			bestKey = key;
		}
	});
	return bestKey ? getSatImageByKey(bestKey) : undefined;
}

/** The bake's only way to tiles: `z/x/y` → bytes, from disk or the network. A key it cannot supply is simply absent. */
export type PhotoTileSource = (keys: string[]) => Promise<Map<string, ArrayBuffer>>;

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

/** Bake the masked photo for a centre from `tiles`; sources are tried in registry order. Null only if none drew.
 * `beforeSave` throws to keep the photo off disk. */
export async function bakeSatelliteImage(
	key: string,
	center: [number, number],
	tiles: PhotoTileSource,
	beforeSave?: () => Promise<void>,
): Promise<SatImage | null> {
	const existing = await idb.get(key);
	// A stale stamp or a since-beaten source is a miss, so a sharper source reaches ground already saved
	if (isCurrentPhoto(existing)) return existing;
	const covering = await photoCovering(key, center);
	if (covering) return covering;
	if (sessionCap.tripped) return existing ?? null;

	const t0 = performance.now();
	for (const src of PHOTO_SOURCES) {
		const out = await bakeFrom(src, center, tiles);
		if (out) {
			out.ms = Math.round(performance.now() - t0);
			await beforeSave?.();
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
	tiles: PhotoTileSource,
): Promise<SatImage | null> {
	const [clng, clat] = center;
	const z = src.zoom;
	const tileGeo = photoTilesFor(center, z);
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
	const keys = tileGeo.map((t) => `${z}/${t.x}/${t.y}`);
	const have = await tiles(keys);
	const tileDraw: TileDraw[] = [];
	tileGeo.forEach((t, i) => {
		const buf = have.get(keys[i]);
		if (!buf?.byteLength) return;
		const dx = Math.floor(xf(t.w));
		const dy = Math.floor(yf(t.n));
		// +1 px so adjacent tiles overlap (no plaid).
		tileDraw.push({ buf, dx, dy, dw: Math.ceil(xf(t.e) - dx) + 1, dh: Math.ceil(yf(t.s) - dy) + 1 });
	});

	// A mostly-empty disc is a throttled fetch, not a photo; fail so the reconcile retries.
	const minTiles = Math.max(1, Math.ceil(tileGeo.length * 0.4));
	if (tileDraw.length < minTiles) return null;

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
	if (!blob || loaded < minTiles) return null;

	return {
		blob,
		bounds: [cw, cs, ce, cn],
		center,
		bakeVersion: BAKE_VERSION,
		source: src.name,
		zoom: src.zoom,
		canvasPx: src.canvasPx,
	};
}
