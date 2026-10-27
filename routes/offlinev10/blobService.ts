/** The blob engine, app-wide: a pin dropped anywhere earns its blob while
 * there is signal, or the moment it comes back. One queue, one download at a time. A blob is its
 * pin's spot, not its ground — a pin over an older blob's tiles still earns
 * its own row and photo, fetching nothing. A deleted pin takes its blob, even one deleted while the engine was not watching. */

import type { HostPorts } from "../../lib/shared/hostPorts";
import { getSatImageByKey, isCurrentPhoto } from "../../lib/onPhone/satellite/satelliteImage";
import { BudgetError, isStale } from "./budget";
import { downloadRegion, type Progress, roomFor } from "./download";
import {
	AreaGone,
	checkRegions,
	deleteRegion,
	keepStorage,
	listRegions,
	pinAreas,
	choosePhoto,
	type Region,
	regionId,
	regionKnown,
	regionRow,
	touchRegions,
} from "./store";
import { ANCHOR_Z, type Box, boxesIntersect, rangeBox } from "./tiles";

export type BlobEvent =
	| { kind: "start"; at: [number, number]; id: string; photoKey?: string; photoCenter?: [number, number] }
	| { kind: "progress"; progress: Progress }
	| { kind: "landed"; region: Region }
	| { kind: "failed"; at: [number, number]; error: unknown }
	| { kind: "removed"; id: string }
	| { kind: "waiting"; sets: WaitingSet[] }
	| { kind: "pins" };

export type Spot = { at: [number, number]; photo: boolean };

/** A big import with pins on screen that were never saved: `here` on screen, `all` across the set. */
export interface WaitingSet {
	key: string;
	name: string;
	here: Spot[];
	all: Spot[];
}

export interface InFlight {
	at: [number, number];
	progress: Progress | null;
	startedAt: number;
}

interface Ask {
	at: [number, number];
	/** born once in queueBlob; nothing downstream re-derives it from `at` */
	id: string;
	/** a blob with no pin (follow-me) wants no photo; which photo is chosen when its download starts, against the rows then on disk */
	photo: boolean;
	pin?: boolean;
	/** the row being repaired: its missing tiles are fetched and the row keeps its place */
	keep?: Region;
	/** back in view: a removed row is fetched again rather than left alone */
	revive?: boolean;
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

// A removed area's row stays, so its pin is not fetched straight back — until it is back in view.
const onDisk = regionKnown;
const whole = async (id: string): Promise<boolean> => {
	const r = await regionRow(id);
	return !!r && !r.removed && !r.filling;
};

/** True when actually queued; false when disk or the queue already has this spot. `photo: false` for a blob with no pin; `pin` for one that goes with its pin; `revive` fetches a removed one again. */
export async function queueBlob(
	lng: number,
	lat: number,
	opts: { photo?: boolean; pin?: boolean; revive?: boolean } = {},
): Promise<boolean> {
	const id = regionId(lng, lat);
	if (queued.has(id)) return false;
	if (await (opts.revive ? whole : onDisk)(id)) return false;
	// A second ask for the same spot can land during the await.
	if (queued.has(id)) return false;
	queued.add(id);
	queue.push({ at: [lng, lat], id, photo: opts.photo !== false, pin: opts.pin, revive: opts.revive });
	void drain();
	return true;
}

/** Fetch what a blob on disk is missing; the row stays where it is. */
export async function repairBlob(r: Region): Promise<boolean> {
	if (queued.has(r.id)) return false;
	queued.add(r.id);
	queue.push({ at: [r.lng, r.lat], id: r.id, photo: !!r.photoKey, pin: r.pin, keep: r });
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
			if (ask.keep || !(await (ask.revive ? whole : onDisk)(ask.id))) await download(ask);
			queued.delete(ask.id);
		}
	} finally {
		draining = false;
	}
}

async function download({ at, id, photo, pin, keep }: Ask): Promise<void> {
	try {
		// Before "start": a refused area must not get its photo baked either.
		await makeRoom(at, id);
	} catch (error) {
		emit({ kind: "failed", at, error });
		return;
	}
	// A repair keeps the photo its row was born with; a new blob chooses against the rows on disk now, the one before it included.
	const chosen = keep ? (keep.photoKey && keep.photoCenter ? { photoKey: keep.photoKey, photoCenter: keep.photoCenter } : undefined) : photo ? choosePhoto(at, await listRegions()) : undefined;
	current = { at, progress: null, startedAt: performance.now() };
	emit({ kind: "start", at, id, ...chosen });
	try {
		const region = await downloadRegion(
			at[0],
			at[1],
			(p) => {
				const progress = { ...p };
				if (current) current.progress = progress;
				emit({ kind: "progress", progress });
			},
			{ id, ...chosen, pin, keep },
		);
		say(
			`[offlineV10] blob ${region.id}: ${region.fetched} new of ${region.tiles} tiles, ${((region.newBytes ?? 0) / 1048576).toFixed(1)} MB added (${(region.bytes / 1048576).toFixed(1)} MB on the ground), ${region.ms} ms to disk`,
		);
		// Firefox asks with a popup — so ask once there is a map worth keeping, never on first open.
		await keepStorage();
		emit({ kind: "landed", region });
	} catch (error) {
		current = null;
		// Its row went mid-download: whoever removed it already said so.
		if (error instanceof AreaGone) emit({ kind: "removed", id });
		else {
			// A full phone is an answer, not a fault: its red line on the dock says so.
			if (!(error instanceof BudgetError)) console.error("[offlineV10] download failed", error);
			emit({ kind: "failed", at, error });
		}
	} finally {
		current = null;
	}
}

/** The LRU stack: removes the least recently touched areas until this one fits, never one on the
 * visible map; refuses only when nothing else may go. */
async function makeRoom(at: [number, number], id: string): Promise<void> {
	const victims = (await listRegions())
		.filter((r) => r.id !== id && !(shown && boxesIntersect(rangeBox(r.range), shown)))
		.sort((a, b) => lastSeen(a) - lastSeen(b));
	for (;;) {
		try {
			return await roomFor(at[0], at[1]);
		} catch (error) {
			const victim = victims.shift();
			if (!(error instanceof BudgetError) || !victim) throw error;
			await removeArea(victim);
		}
	}
}

// What the map shows; an area under it is never evicted.
let shown: Box | null = null;
// lastOpened is written at most hourly; this keeps the order exact between writes.
const seenAt = new Map<string, number>();
const lastSeen = (r: Region): number => seenAt.get(r.id) ?? r.lastOpened ?? r.at;

/** The map just showed this box. Areas under it go to the top of the stack, and every pin on it
 * gets its whole blob — roads, water and photo — fetched again if it was evicted, never fetched or
 * is missing a piece. Zoomed out past a region's own zoom, nothing is "seen". */
export async function viewing(box: Box, zoom: number): Promise<void> {
	shown = zoom >= ANCHOR_Z - 2 ? box : null;
	if (!shown) return emit({ kind: "waiting", sets: [] });
	return look(shown);
}

async function look(box: Box): Promise<void> {
	const rows = await listRegions();
	const onScreen = rows.filter((r) => boxesIntersect(rangeBox(r.range), box)).map((r) => r.id);
	for (const id of onScreen) seenAt.set(id, Date.now());
	const touched = new Set(await touchRegions(onScreen));
	// Checked when its hourly touch is due, so panning does not scan the store.
	if (touched.size) {
		const missing = await checkRegions();
		const pins = photoIds();
		for (const r of rows)
			if (touched.has(r.id) && ((missing[r.id] ?? 0) > 0 || (r.photoKey && pins?.has(r.id) && !isCurrentPhoto(await getSatImageByKey(r.photoKey))))) void repairBlob(r);
	}
	// Any row, a removed one included, means the planter once had this pin saved.
	const saved = new Set(rows.map((r) => r.id));
	const sets = new Map<string, WaitingSet>();
	for (const p of host?.places() ?? [])
		for (const at of p.anchors) {
			const here = at[0] >= box.w && at[0] <= box.e && at[1] >= box.s && at[1] <= box.n;
			const id = regionId(at[0], at[1]);
			if (!p.set || saved.has(id) || queued.has(id)) {
				if (here) void queueBlob(at[0], at[1], { photo: p.photo, pin: true, revive: true });
				continue;
			}
			let s = sets.get(p.set.key);
			if (!s) sets.set(p.set.key, (s = { ...p.set, here: [], all: [] }));
			// A plain pair: the host's anchors can be reactive proxies, and the size estimate reads each one hundreds of times.
			const spot = { at: [at[0], at[1]] as [number, number], photo: p.photo };
			s.all.push(spot);
			if (here) s.here.push(spot);
		}
	emit({ kind: "waiting", sets: [...sets.values()].filter((s) => s.here.length) });
}

/** The planter chose these pins of a big import. */
export function saveSpots(spots: readonly Spot[]): void {
	for (const { at, photo } of spots) void queueBlob(at[0], at[1], { photo, pin: true, revive: true });
}

async function removeBlob(id: string): Promise<void> {
	const tiles = await deleteRegion(id);
	if (tiles === null) return;
	say(
		`[offlineV10] pin gone — blob ${id} removed, ${tiles} tiles freed`,
	);
	emit({ kind: "removed", id });
}

/** Removes an area and its photo, keeping the row so the engine leaves the pin alone. */
export async function removeArea(r: Region): Promise<void> {
	await deleteRegion(r.id, true);
	emit({ kind: "removed", id: r.id });
}

/** Areas the map has not shown for STALE_AREA_MONTHS; no prompt, the tiles can be fetched again. */
export async function removeStaleAreas(now = Date.now()): Promise<Region[]> {
	const stale = (await listRegions()).filter((r) => isStale(r, now));
	for (const r of stale) await removeArea(r);
	if (stale.length) console.info(`[offlineV10] ${stale.length} offline area(s) unopened for a year removed`);
	return stale;
}

let stop: (() => void) | null = null;
let host: HostPorts | null = null;

/** The blobs a photo may bake for: a pin the host lists now. Null until the host has read its maps. */
export function photoIds(): Set<string> | null {
	if (!host?.ready()) return null;
	const ids = new Set<string>();
	for (const p of host.places()) if (p.photo) for (const [lng, lat] of p.anchors) ids.add(regionId(lng, lat));
	return ids;
}

/** Every place earns a blob at each anchor; only a pin's also bakes a photo. */
export function startBlobService(ports: HostPorts): () => void {
	if (stop)
		return () => {
			/* the first start's stop owns shutdown */
		};
	host = ports;
	say("[offlineV10] blob engine on — every pin earns a blob");
	void removeStaleAreas().catch((e) => console.error("[offlineV10] stale sweep failed", e));
	// A spot that leaves this set was deleted or moved. Until the first ready read it is the pin-born rows on
	// disk, so a pin deleted while the engine was not watching still takes its area.
	let seen: Promise<Set<string>> | null = null;
	// Diff the pins against disk rather than remember what failed: a pin that missed its signal is just a pin with no blob.
	const reconcile = (): Set<string> | null => {
		if (!ports.ready()) return null;
		const now = new Set<string>();
		for (const p of ports.places()) {
			for (const [lng, lat] of p.anchors) {
				now.add(regionId(lng, lat));
				if (!p.set) void queueBlob(lng, lat, { photo: p.photo, pin: true });
			}
		}
		return now;
	};
	const off = ports.onPlacesChanged(() => {
		const now = reconcile();
		if (!now) return;
		emit({ kind: "pins" });
		// The map's first look can land before the pins load, and an import lands under a still camera.
		if (shown) void look(shown);
		// Only a place change deletes; a reconnect never does.
		const before = seen ?? pinAreas().then((rows) => new Set(rows.map((r) => r.id)));
		seen = Promise.resolve(now);
		void before.then((ids) => {
			for (const id of ids) if (!now.has(id)) void removeBlob(id);
		});
	});
	const online = (): void => void reconcile();
	window.addEventListener("online", online);
	stop = () => {
		off();
		window.removeEventListener("online", online);
		stop = null;
		host = null;
		shown = null;
	};
	return stop;
}
