/**
 * The photo pass: one small satellite photo per blob, baked once. A blob in the wilderness
 * is a green field with a pin on it; the photo is the frame of reference.
 */

import { PHOTO_SOURCES } from "../../lib/onPhone/satellite/photoSources";
import {
	BAKE_RADIUS_KM,
	bakeSatelliteImage,
	deleteSatImage,
	getSatImageByKey,
	isCurrentPhoto,
	satImageKey,
	satImageMeta,
} from "../../lib/onPhone/satellite/satelliteImage";
import { noteSatelliteTiles } from "../../lib/onPhone/store/downloadGuard";
import { noteBytes } from "../../lib/shared/dataMeter.svelte";
import { passQueue } from "../../lib/shared/passQueue";
import { sessionCap, spendBytes } from "../../lib/shared/sessionByteCap.svelte";
import { satelliteBatchUrl } from "../../lib/worker/worker-local-dev/tilesHost";
import { onBlob } from "./blobService";
import { readPack } from "./pack";
import { getPhotoTiles, notePhotoBytes, photoTileBytes, putPhotoTiles, regionsSnapshot } from "./store";

// Tiles per request; the Worker refuses more than 300.
const SAT_PER_REQUEST = 300;

/** A photo's tiles: disk first, the rest in as few requests as the Worker allows, written before they are drawn. */
export async function photoTiles(keys: string[]): Promise<Map<string, ArrayBuffer>> {
	const have = await getPhotoTiles(keys);
	const missing = keys.filter((k) => !have.has(k));
	if (missing.length === 0 || (typeof navigator !== "undefined" && navigator.onLine === false)) return have;
	const url = satelliteBatchUrl();
	if (url === null) throw new Error("no tiles host configured — configureTilesHost() must run before a photo bakes.");
	for (let i = 0; i < missing.length; i += SAT_PER_REQUEST) {
		if (sessionCap.tripped) break;
		const chunk = missing.slice(i, i + SAT_PER_REQUEST);
		noteSatelliteTiles(chunk.length);
		const res = await fetch(url, { method: "POST", body: JSON.stringify(chunk.map((k) => k.split("/").map(Number))) });
		if (!res.ok) throw new Error(`satellite batch: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
		const got: Array<[string, ArrayBuffer]> = [];
		for (const [k, b] of readPack(new Uint8Array(await res.arrayBuffer()))) {
			if (!b) continue;
			got.push([k, b]);
			noteBytes("satellite", b.byteLength);
			spendBytes(b.byteLength);
		}
		await putPhotoTiles(got);
		for (const [k, b] of got) have.set(k, b);
	}
	return have;
}

// The only per-photo account of what the pass pulled; off unless the debug route turns it on.
let narrate = false;
export function setPhotoNarration(on: boolean): void {
	narrate = on;
}
function say(...args: unknown[]): void {
	if (narrate) console.info(...args);
}

export const PHOTO_RETRY_MS = 60_000;
export { BAKE_RADIUS_KM as PHOTO_RADIUS_KM };
export const PHOTO_SPEC = {
	radiusKm: BAKE_RADIUS_KM,
	sources: PHOTO_SOURCES.map(({ name, zoom, canvasPx }) => ({
		name,
		zoom,
		canvasPx,
	})),
};

export interface PhotoInfo {
	bytes: number;
	source: string;
	zoom: number;
	canvasPx: number;
	/** download + bake; absent on a photo baked before it was timed */
	ms?: number;
	/** The raw source tiles kept for the close-up; they live in the tile store, so its budget already counts them. */
	closeUp: { tiles: number; bytes: number };
}

const WORLD = PHOTO_SOURCES[0];

/** Metadata per photo key, never the pixels; the total is reported to the tile store's budget. */
export async function photoInfo(): Promise<Record<string, PhotoInfo>> {
	const regions = await regionsSnapshot().regions;
	const [meta, close] = await Promise.all([satImageMeta(), photoTileBytes(regions)]);
	const closeByKey = new Map(regions.map((r) => [photoKey(r.lng, r.lat), close.get(r.id)]));
	const out: Record<string, PhotoInfo> = {};
	let total = 0;
	for (const m of meta) {
		total += m.bytes;
		out[m.key] = {
			bytes: m.bytes,
			source: m.source ?? WORLD.name,
			zoom: m.zoom ?? WORLD.zoom,
			canvasPx: m.canvasPx ?? WORLD.canvasPx,
			ms: m.ms,
			closeUp: closeByKey.get(m.key) ?? { tiles: 0, bytes: 0 },
		};
	}
	notePhotoBytes(total);
	return out;
}

const listeners = new Set<() => void>();

export function onPhoto(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

export function photoKey(lng: number, lat: number): string {
	return satImageKey([lng, lat]);
}

let pausedUntil = 0;

// Centres ride the queue as their photo keys: primitives, so a re-ask dedupes.
const askQueue = passQueue<string>((keys) =>
	pass(keys.map((k) => k.split(",").map(Number) as [number, number])),
);

/** Bake a photo for every centre without one; returns how many landed. */
export function bakePhotos(
	centres: readonly [number, number][],
): Promise<number> {
	return askQueue(centres.map(([lng, lat]) => photoKey(lng, lat)));
}

async function pass(centres: readonly [number, number][]): Promise<number> {
	if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
	if (Date.now() < pausedUntil) return 0;
	let landed = 0;
	for (const [lng, lat] of centres) {
		if (isCurrentPhoto(await getSatImageByKey(photoKey(lng, lat)))) continue;
		let img: Awaited<ReturnType<typeof bakeSatelliteImage>> = null;
		try {
			img = await bakeSatelliteImage([lng, lat], photoTiles);
		} catch (error) {
			console.warn(
				`[offlineV10] photo bake threw at ${lat.toFixed(4)},${lng.toFixed(4)}`,
				error,
			);
		}
		if (!img) {
			// The remaining centres would only fail against the same host.
			pausedUntil = Date.now() + PHOTO_RETRY_MS;
			console.warn(
				`[offlineV10] photo: no imagery for ${lat.toFixed(4)},${lng.toFixed(4)} — pass paused ${PHOTO_RETRY_MS / 1000}s`,
			);
			break;
		}
		landed++;
		say(
			`[offlineV10] photo: ${BAKE_RADIUS_KM} km around ${lat.toFixed(4)},${lng.toFixed(4)} (${(img.blob.size / 1024).toFixed(0)} KB)`,
		);
		for (const fn of listeners) fn();
	}
	return landed;
}

export async function bakeAllPhotos(): Promise<number> {
	const regions = await regionsSnapshot().regions;
	return bakePhotos(
		regions
			.filter((r) => r.photo !== false)
			.map((r) => [r.lng, r.lat] as [number, number]),
	);
}

export async function dropPhoto(lng: number, lat: number): Promise<void> {
	await deleteSatImage(photoKey(lng, lat));
}

let stop: (() => void) | null = null;

export function startPhotoService(): () => void {
	if (stop)
		return () => {
			/* the first start's stop owns shutdown */
		};
	const all = (): void => {
		bakeAllPhotos().catch((e) => {
			console.warn("[photos] bake-all failed", e);
		});
	};
	const offBlob = onBlob((e) => {
		if (e.kind === "landed" && e.region.photo !== false)
			bakePhotos([[e.region.lng, e.region.lat]]).catch((err) => {
				console.warn("[photos] bake failed", err);
			});
	});
	window.addEventListener("online", all);
	all();
	stop = () => {
		offBlob();
		window.removeEventListener("online", all);
		stop = null;
	};
	return stop;
}
