/**
 * The photo pass: one small satellite photo per blob, baked once. A blob in the wilderness
 * is a green field with a pin on it; the photo is the frame of reference.
 */

import {
	PHOTO_SOURCES,
	photoSourcesFor,
} from "../../lib/onPhone/satellite/photoSources";
import {
	BAKE_RADIUS_KM,
	bakeSatelliteImage,
	deleteSatImage,
	getSatImageByKey,
	satImageKey,
	satImageMeta,
} from "../../lib/onPhone/satellite/satelliteImage";
import { passQueue } from "../../lib/shared/passQueue";
import { onBlob } from "./blobService";
import { notePhotoBytes, regionsSnapshot } from "./store";

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
}

const WORLD = PHOTO_SOURCES[PHOTO_SOURCES.length - 1];

/** Metadata per photo key, never the pixels; the total is reported to the tile store's budget. */
export async function photoInfo(): Promise<Record<string, PhotoInfo>> {
	const out: Record<string, PhotoInfo> = {};
	let total = 0;
	for (const m of await satImageMeta()) {
		total += m.bytes;
		out[m.key] = {
			bytes: m.bytes,
			source: m.source ?? WORLD.name,
			zoom: m.zoom ?? WORLD.zoom,
			canvasPx: m.canvasPx ?? WORLD.canvasPx,
		};
	}
	notePhotoBytes(total);
	return out;
}

export function photoSourceFor(lng: number, lat: number): string {
	return photoSourcesFor(lng, lat)[0].name;
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
		if (await getSatImageByKey(photoKey(lng, lat))) continue;
		let img: Awaited<ReturnType<typeof bakeSatelliteImage>> = null;
		try {
			img = await bakeSatelliteImage([lng, lat]);
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
