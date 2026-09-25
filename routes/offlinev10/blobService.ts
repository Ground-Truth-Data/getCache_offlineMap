/** The blob engine, app-wide: a pin dropped anywhere earns its blob while
 * there is still signal. One queue, one download at a time. A blob is its
 * pin's spot, not its ground — a pin over an older blob's tiles still earns
 * its own row and photo, fetching nothing. A deleted pin takes its blob. */

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

// The only account of what the engine pulled; off unless the debug route turns it on.
let narrate = false;
export function setBlobNarration(on: boolean): void {
	narrate = on;
}
function say(...args: unknown[]): void {
	if (narrate) console.info(...args);
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

export function blobBusy(): boolean {
	return draining || queue.length > 0;
}

export function blobInFlight(): InFlight | null {
	return current;
}

async function onDisk(id: string): Promise<boolean> {
	const regions = await regionsSnapshot().regions;
	return regions.some((r) => r.id === id);
}

/** True when actually queued; false when disk or the queue already has this spot. `photo: false` for a blob with no pin. */
export async function queueBlob(
	lng: number,
	lat: number,
	opts: { photo?: boolean } = {},
): Promise<boolean> {
	const id = regionId(lng, lat);
	if (queued.has(id)) return false;
	if (await onDisk(id)) return false;
	// A second ask for the same spot can land during the await.
	if (queued.has(id)) return false;
	queued.add(id);
	queue.push({ at: [lng, lat], photo: opts.photo !== false });
	void drain();
	return true;
}

/** Fetch what a blob on disk is missing; the row stays where it is. */
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
		say(
			`[offlineV10] blob ${region.id}: ${region.fetched} new of ${region.tiles} tiles, ${((region.newBytes ?? 0) / 1048576).toFixed(1)} MB added (${(region.bytes / 1048576).toFixed(1)} MB on the ground), ${region.ms} ms to disk`,
		);
		emit({ kind: "landed", region });
	} catch (error) {
		console.error("[offlineV10] download failed", error);
		emit({ kind: "failed", at, error });
	} finally {
		current = null;
	}
}

async function removeBlob(id: string, at: [number, number]): Promise<void> {
	const regions = await regionsSnapshot().regions;
	if (!regions.some((r) => r.id === id)) return;
	await deleteSatImage(satImageKey(at));
	const tiles = await deleteRegion(id);
	say(
		`[offlineV10] pin gone — blob ${id} removed, ${tiles} tiles freed`,
	);
	emit({ kind: "removed", id });
}

let stop: (() => void) | null = null;

/** Every pin earns its blob. A corridor bakes at each anchor with NO photo —
 * a photo per anchor is what makes long geometry expensive. */
export function startBlobService(ports: HostPorts): () => void {
	if (stop)
		return () => {
			/* the first start's stop owns shutdown */
		};
	say("[offlineV10] blob engine on — every pin earns a blob");
	// Ask while there is nothing to lose yet.
	void keepStorage();
	// A spot that leaves this set was deleted or moved.
	let seen: Map<string, [number, number]> | null = null;
	const off = ports.onPlacesChanged(() => {
		if (!ports.ready()) return;
		const now = new Map<string, [number, number]>();
		for (const p of ports.places()) {
			for (const [lng, lat] of p.anchors) {
				now.set(regionId(lng, lat), [lng, lat]);
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
