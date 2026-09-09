/**
 * THE blob engine, app-wide. Started once by the (getcache) layout, so a pin
 * dropped or moved anywhere — the online map above all — earns its blob the
 * moment it lands, while there is still signal. People open the offline map
 * when they need it, and by then it is too late to fetch anything.
 *
 * One queue, one download at a time, in drop order; the V10 page, the dock
 * buttons and follow-me all feed this queue and listen here for what lands.
 *
 * A blob is its pin's spot, not its ground. A pin inside an older blob's
 * tiles still earns its own row and its own photo — the download finds every
 * tile on disk and fetches nothing. Only the same spot is skipped.
 *
 * A deleted pin takes its blob and photo with it. Blobs with no pin — map
 * centre, follow-me — have no pin to lose, so only the dock deletes them.
 */

import {
	deleteSatImage,
	satImageKey,
} from "../../lib/onPhone/satellite/satelliteImage";
import type { HostPorts } from "../../lib/shared/hostPorts";
import { downloadRegion, type Progress } from "./download";
import {
	deleteRegion,
	keepStorage,
	type Region,
	regionId,
	regionsSnapshot,
} from "./store";

export type BlobEvent =
	| { kind: "start"; at: [number, number] }
	| { kind: "progress"; progress: Progress }
	| { kind: "landed"; region: Region }
	| { kind: "failed"; at: [number, number]; error: unknown }
	| { kind: "removed"; id: string };

export interface InFlight {
	at: [number, number];
	progress: Progress | null;
	startedAt: number;
}

interface Ask {
	at: [number, number];
	photo: boolean;
	/** the row being repaired: its missing tiles are fetched and the row keeps its place */
	keep?: Region;
}

const queue: Ask[] = [];
const queued = new Set<string>();
let draining = false;
let current: InFlight | null = null;
const listeners = new Set<(e: BlobEvent) => void>();

function emit(e: BlobEvent): void {
	for (const fn of listeners) fn(e);
}

export function onBlob(fn: (e: BlobEvent) => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

/** A download running or waiting — follow-me must not stack another behind it. */
export function blobBusy(): boolean {
	return draining || queue.length > 0;
}

export function blobInFlight(): InFlight | null {
	return current;
}

/** A blob already on disk at this exact spot. */
async function onDisk(id: string): Promise<boolean> {
	const regions = await regionsSnapshot().regions;
	return regions.some((r) => r.id === id);
}

/** True when a blob was actually queued; false when disk or the queue already has this spot. `photo: false` for a blob with no pin (follow-me). */
export async function queueBlob(
	lng: number,
	lat: number,
	opts: { photo?: boolean } = {},
): Promise<boolean> {
	const id = regionId(lng, lat);
	if (queued.has(id)) return false;
	if (await onDisk(id)) return false;
	// a second ask for the same spot can land during the await above
	if (queued.has(id)) return false;
	queued.add(id);
	queue.push({ at: [lng, lat], photo: opts.photo !== false });
	void drain();
	return true;
}

/** Fetch what a blob on disk is missing — after an eviction, or a download cut short. The row stays where it is. */
export async function repairBlob(r: Region): Promise<boolean> {
	if (queued.has(r.id)) return false;
	queued.add(r.id);
	queue.push({ at: [r.lng, r.lat], photo: r.photo !== false, keep: r });
	void drain();
	return true;
}

/** The id stays queued until the blob is on disk, so a store change mid-download cannot queue it again. */
async function drain(): Promise<void> {
	if (draining) return;
	draining = true;
	try {
		while (queue.length) {
			const ask = queue.shift() as Ask;
			const id = regionId(ask.at[0], ask.at[1]);
			if (ask.keep || !(await onDisk(id))) await download(ask);
			queued.delete(id);
		}
	} finally {
		draining = false;
	}
}

async function download({ at, photo, keep }: Ask): Promise<void> {
	current = { at, progress: null, startedAt: performance.now() };
	emit({ kind: "start", at });
	try {
		const region = await downloadRegion(
			at[0],
			at[1],
			(p) => {
				const progress = { ...p };
				if (current) current.progress = progress;
				emit({ kind: "progress", progress });
			},
			{ photo, keep },
		);
		console.info(
			`[offlineV10] blob ${region.id}: ${region.tiles} tiles, ${region.fetched} fetched, ${(region.bytes / 1048576).toFixed(1)} MB, ${region.ms} ms to disk`,
		);
		emit({ kind: "landed", region });
	} catch (error) {
		console.error("[offlineV10] download failed", error);
		emit({ kind: "failed", at, error });
	} finally {
		current = null;
	}
}

/** The blob and photo at a pin's spot, when the pin goes. Nothing to do when no blob was ever made there. */
async function removeBlob(id: string, at: [number, number]): Promise<void> {
	const regions = await regionsSnapshot().regions;
	if (!regions.some((r) => r.id === id)) return;
	await deleteSatImage(satImageKey(at));
	const tiles = await deleteRegion(id);
	console.info(
		`[offlineV10] pin gone — blob ${id} removed, ${tiles} tiles freed`,
	);
	emit({ kind: "removed", id });
}

let stop: (() => void) | null = null;

/**
 * Watch the app's places: a pin dropped or moved from now on gets its blob,
 * the pins that were already there do not — 440 pins is 2 GB.
 *
 * A corridor (a line, a polygon, a plot) bakes here too, at each of its
 * anchors, with NO photo — roads are what you follow a line for, and a photo
 * per anchor is what makes long geometry expensive.
 *
 * THE AGE GATE DOES NOT APPLY TO A CORRIDOR. `since` is stamped when this
 * starts, so it means "newer than this page", not "not yet baked" — a line
 * imported before the page opened would never bake, which is every line,
 * since nobody imports a route while watching the blob dock. The gate guards
 * against 440 old PINS costing 2 GB in photos; a corridor takes no photo and
 * `anchorsOf` caps it at ten anchors, so it was never what the gate was for.
 * Re-baking is free either way: `queueBlob` returns early on a spot already
 * on disk, which is the real "have I got this?" answer.
 */
export function startBlobService(ports: HostPorts): () => void {
	if (stop)
		return () => {
			/* already running — the first start's stop owns shutdown */
		};
	const since = new Date().toISOString();
	console.info(
		`[offlineV10] blob engine on — pins dropped after ${since.slice(11, 19)} earn blobs`,
	);
	// Ask while there is nothing to lose yet; the answer is a light on the blobs dock.
	void keepStorage();
	// Every pin spot seen while the host was ready; a spot that leaves this set was deleted (or moved — the new spot earns its own blob).
	let seen: Map<string, [number, number]> | null = null;
	const off = ports.onPlacesChanged(() => {
		if (!ports.ready()) return;
		const now = new Map<string, [number, number]>();
		for (const p of ports.places()) {
			for (const [lng, lat] of p.anchors) {
				now.set(regionId(lng, lat), [lng, lat]);
				if (p.corridor || p.lastTouched > since)
					void queueBlob(lng, lat, { photo: !p.corridor });
			}
		}
		if (seen)
			for (const [id, at] of seen) if (!now.has(id)) void removeBlob(id, at);
		seen = now;
	});
	stop = () => {
		off();
		stop = null;
	};
	return stop;
}
