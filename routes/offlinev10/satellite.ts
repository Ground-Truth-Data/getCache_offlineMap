/**
 * The photo pass: one small satellite photo per blob, baked once. A blob in the wilderness
 * is a green field with a pin on it; the photo is the frame of reference.
 */

import { DEFAULT_SOURCE, SATELLITE_SOURCES, type SatelliteSource, sourceAt, sourceOf } from "../../lib/contract/satelliteSources";
import {
	PHOTO_COVERAGE_RADIUS_KM,
	bakeSatelliteImage,
	deleteSatImage,
	getSatImageByKey,
	CLOSE_UP,
	isCurrentPhoto,
	satImageMeta,
} from "../../lib/onPhone/satellite/satelliteImage";
import { noteSatelliteTiles } from "../../lib/onPhone/store/downloadGuard";
import { noteBytes } from "../../lib/shared/dataMeter.svelte";
import { passQueue } from "../../lib/shared/passQueue";
import { sessionCap, spendBytes } from "../../lib/shared/sessionByteCap.svelte";
import { satelliteTileUrl, squirrelUrl } from "../../lib/worker/tilesHost";
import { onBlob } from "./blobService";
import { getEach, RateLimited } from "./download";
import {
	AreaGone,
	claimArea,
	type CloseUp,
	getPhotoTiles,
	notePhotoBytes,
	photoTileBytes,
	putPhotoTiles,
	regionsSnapshot,
} from "./store";

// Why photos are not baking, in the host's words; null while they are. The dock shows it.
let issue: string | null = null;
let lastTileFailure: string | null = null;
const issueListeners = new Set<() => void>();

export const photoIssue = (): string | null => issue;

export function onPhotoIssue(fn: () => void): () => void {
	issueListeners.add(fn);
	return () => {
		issueListeners.delete(fn);
	};
}

function setIssue(next: string | null): void {
	if (next === issue) return;
	issue = next;
	for (const fn of issueListeners) fn();
}

/** The host's reason out of a failed tile read: what follows "HTTP 502", without the tile it names. */
const reasonOf = (e: unknown): string =>
	String(e instanceof Error ? e.message : e)
		.replace(/^.*?HTTP \d+ /, "")
		.replace(/ for \d+\/\d+\/\d+$/, "")
		.trim() || "tile request failed";

/** A photo's tiles from `source`: disk first, the rest one GET each. Only the close-up source's are kept, under `owner`'s row, before they are drawn. */
export async function photoTiles(keys: string[], owner: string, source: string = DEFAULT_SOURCE): Promise<Map<string, ArrayBuffer>> {
	const keep = sourceOf(source) === CLOSE_UP;
	lastTileFailure = null;
	const have = keep ? await getPhotoTiles(keys) : new Map<string, ArrayBuffer>();
	const missing = keys.filter((k) => !have.has(k));
	if (missing.length === 0 || (typeof navigator !== "undefined" && navigator.onLine === false)) return have;
	const urls = missing.map((k) => satelliteTileUrl(source, ...(k.split("/").map(Number) as [number, number, number])));
	if (urls.some((u) => u === null)) throw new Error("no tiles host configured — configureTilesHost() must run before a photo bakes.");
	noteSatelliteTiles(missing.length);
	const got: Array<[string, ArrayBuffer]> = [];
	try {
		await getEach(
			urls as string[],
			(i, b) => {
				if (!b) return;
				got.push([missing[i], b]);
				have.set(missing[i], b);
				noteBytes("satellite", b.byteLength);
				spendBytes(b.byteLength);
			},
			() => sessionCap.tripped,
			// MapTiler lacks some tiles; the bake already tolerates gaps.
			true,
			(e) => {
				lastTileFailure = reasonOf(e);
			},
			SAT_IN_FLIGHT,
		);
	} finally {
		if (keep) await putPhotoTiles(got, owner);
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
// MapTiler rate-limits a burst; roads come from our own R2 and keep the full pool.
const SAT_IN_FLIGHT = 6;
export const PHOTO_SPEC = {
	radiusKm: PHOTO_COVERAGE_RADIUS_KM,
	sources: Object.values(SATELLITE_SOURCES).map(({ name, zoom, canvasPx }) => ({
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
	closeUp: CloseUp;
}

const WORLD = SATELLITE_SOURCES[DEFAULT_SOURCE];

/** Metadata per photo key, never the pixels; the total is reported to the tile store's budget. */
export async function photoInfo(): Promise<Record<string, PhotoInfo>> {
	const regions = await regionsSnapshot().regions;
	const [meta, close] = await Promise.all([satImageMeta(), photoTileBytes(regions)]);
	// Blobs sharing a photo share its tiles: the covered totals agree, and what was added is the sum of what each credited.
	const closeByKey = new Map<string, CloseUp>();
	for (const r of regions) {
		const c = r.photoKey ? close.get(r.id) : undefined;
		if (!r.photoKey || !c) continue;
		const have = closeByKey.get(r.photoKey);
		closeByKey.set(r.photoKey, have ? { ...c, addedTiles: have.addedTiles + c.addedTiles, addedBytes: have.addedBytes + c.addedBytes } : c);
	}
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
			closeUp: closeByKey.get(m.key) ?? { tiles: 0, bytes: 0, addedTiles: 0, addedBytes: 0 },
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

let pausedUntil = 0;

/** A photo to bake as its blob's record names it: the row id that owns the tiles, the key it is stored under, the exact centre. */
export interface PhotoAsk {
	id: string;
	photoKey: string;
	at: [number, number];
}

// Asks ride the queue as their row ids: primitives, so a re-ask dedupes. The asks themselves wait here, so no coordinate is ever turned into a key and back.
const asked = new Map<string, PhotoAsk>();
const askQueue = passQueue<string>((ids) => pass(ids.map((id) => asked.get(id) as PhotoAsk)));

/** Bake a photo for every ask without one; returns how many landed. */
export function bakePhotos(asks: readonly PhotoAsk[]): Promise<number> {
	for (const a of asks) asked.set(a.id, a);
	return askQueue(asks.map((a) => a.id));
}

async function pass(asks: readonly PhotoAsk[]): Promise<number> {
	if (typeof navigator !== "undefined" && navigator.onLine === false) {
		say("[offlineV10] photo: offline, pass skipped");
		return 0;
	}
	if (Date.now() < pausedUntil) {
		say(`[offlineV10] photo: paused ${Math.ceil((pausedUntil - Date.now()) / 1000)}s more, pass skipped`);
		return 0;
	}
	let active: [string, SatelliteSource];
	try {
		active = await activeSource();
	} catch (error) {
		pausedUntil = Date.now() + PHOTO_RETRY_MS;
		console.warn(`[offlineV10] photo: no satellite source — pass paused ${PHOTO_RETRY_MS / 1000}s`, error);
		setIssue(reasonOf(error));
		return 0;
	}
	let landed = 0;
	for (const { id, photoKey, at } of asks) {
		const sid = sourceAt(at, active[0]);
		const src = sid === active[0] ? active[1] : sourceOf(sid)!;
		if (isCurrentPhoto(await getSatImageByKey(photoKey))) {
			say(`[offlineV10] photo: ${id} already has its photo`);
			continue;
		}
		let img: Awaited<ReturnType<typeof bakeSatelliteImage>> = null;
		try {
			img = await bakeSatelliteImage(photoKey, at, src, (keys) => photoTiles(keys, id, sid), () => claimArea(id));
		} catch (error) {
			if (error instanceof RateLimited) {
				pausedUntil = Date.now() + error.ms;
				console.warn(`[offlineV10] photo: imagery host rate-limited us — pass paused ${error.ms / 1000}s`);
				setIssue(`imagery host busy, retrying in ${Math.round(error.ms / 1000)} s`);
				break;
			}
			if (error instanceof AreaGone) {
				// `missing` is a bug: the ask names a row no blob was born with. `removed` is the area going mid-bake, not the host's fault, so no pause.
				if (error.why === "missing") console.warn(`[offlineV10] photo: ${error.message} — the ask holds an id no blob was born with`);
				else console.info(`[offlineV10] photo: ${error.message}, photo not saved`);
				continue;
			}
			console.warn(`[offlineV10] photo bake threw for ${id}`, error);
		}
		if (!img) {
			// The remaining asks would only fail against the same host.
			pausedUntil = Date.now() + PHOTO_RETRY_MS;
			console.warn(`[offlineV10] photo: no imagery for ${id} — pass paused ${PHOTO_RETRY_MS / 1000}s${lastTileFailure ? ` (${lastTileFailure})` : ""}`);
			setIssue(lastTileFailure ?? "no imagery came back");
			break;
		}
		setIssue(null);
		landed++;
		say(`[offlineV10] photo: ${PHOTO_COVERAGE_RADIUS_KM} km around ${id} (${(img.blob.size / 1024).toFixed(0)} KB)`);
		for (const fn of listeners) fn();
	}
	return landed;
}

/** The source the Worker says photos bake from; asked once a pass, so a switch on /app/squirrel lands on the next one. */
async function activeSource(): Promise<[string, SatelliteSource]> {
	const url = squirrelUrl("/active");
	if (!url) throw new Error("no tiles host configured — configureTilesHost() must run before a photo bakes.");
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} the Worker would not say which satellite source is on`);
	const { active } = (await res.json()) as { active: string };
	const src = sourceOf(active);
	if (!src) throw new Error(`the Worker serves satellite source "${active}", which this build does not know`);
	return [active, src];
}

export async function bakeAllPhotos(): Promise<number> {
	const regions = await regionsSnapshot().regions;
	return bakePhotos(regions.flatMap((r) => (r.photoKey && r.photoCenter ? [{ id: r.id, photoKey: r.photoKey, at: r.photoCenter }] : [])));
}

export async function dropPhoto(photoKey: string): Promise<void> {
	await deleteSatImage(photoKey);
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
		// Beside the tiles, not after them: neither needs the other.
		if (e.kind === "start" && e.photoKey && e.photoCenter)
			bakePhotos([{ id: e.id, photoKey: e.photoKey, at: e.photoCenter }]).catch((err) => {
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
