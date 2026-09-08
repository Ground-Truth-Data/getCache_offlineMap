/**
 * The tile store: ONE IndexedDB object store keyed by `z/x/y`, one copy of
 * each tile no matter how many blobs cover it. A second store lists the blobs.
 * Nothing here knows about pins, merging or ownership — that is the point.
 */

import { BudgetError, budgetBytes } from "./budget";
import type { Place } from "./places";
import {
	missingKeys,
	type Range,
	rangeContains,
	rangeTiles,
	tileKey,
} from "./tiles";

export const DB_NAME = "gc-offlineV10";
/** Bump when what a blob IS changes; an older blob is then wiped, never half-drawn. v2: parents above the cut. */
const DB_VERSION = 2;
const TILES = "tiles";
const REGIONS = "regions";

export interface Region {
	id: string;
	lng: number;
	lat: number;
	/** the anchor tiles the blob is cut on — its border and its contents */
	range: Range;
	/** ms epoch */
	at: number;
	/** every tile the blob spans */
	tiles: number;
	/** tiles fetched for this blob (the rest were already on disk) */
	fetched: number;
	/** what this blob's tiles weigh on disk — shared tiles included, so an
	 *  overlapping blob that fetched nothing still reports its true size */
	bytes: number;
	/** ask → all on disk */
	ms: number;
	/** on disk → painted (idle) */
	msPaint?: number;
	/** the camera moved before the map went idle, so there is no honest paint time */
	paintMoved?: true;
	/** false on a follow-me blob: no pin, no photo. Absent means a photo. */
	photo?: false;
	/** the nearest town in the blob's own tiles; null when its tiles hold none; absent before it was looked up */
	place?: Place | null;
}

/** A blob is its pin's spot: the same spot is the same blob, a neighbour a pace away is another. */
export function regionId(lng: number, lat: number): string {
	return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
	if (dbp) return dbp;
	dbp = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const name of [TILES, REGIONS])
				if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
			db.createObjectStore(TILES);
			db.createObjectStore(REGIONS, { keyPath: "id" });
		};
		req.onsuccess = () => {
			const db = req.result;
			// A wipe from another tab must not be blocked by this connection.
			db.onversionchange = () => {
				db.close();
				dbp = null;
			};
			resolve(db);
		};
		req.onerror = () => reject(req.error);
		req.onblocked = () => reject(new Error("indexedDB open blocked"));
	});
	return dbp;
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error ?? new Error("aborted"));
	});
}

function result<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function getTile(key: string): Promise<ArrayBuffer | undefined> {
	const db = await open();
	const tx = db.transaction(TILES, "readonly");
	return result(
		tx.objectStore(TILES).get(key) as IDBRequest<ArrayBuffer | undefined>,
	);
}

// THE BUDGET WALL. Tile bytes on disk are kept as a running total so the
// check costs nothing per write; the photos live in another store and report
// their total here. A delete or wipe drops the total, and the next reader
// scans it afresh.
let tileBytes: Promise<number> | null = null;
let photoBytes = 0;

function scanTileBytes(): Promise<number> {
	if (tileBytes) return tileBytes;
	tileBytes = (async () => {
		const db = await open();
		const st = db.transaction(TILES, "readonly").objectStore(TILES);
		// Cursor, never getAll(): a full read holds every tile in the heap at once.
		return new Promise<number>((resolve, reject) => {
			let sum = 0;
			const req = st.openCursor();
			req.onsuccess = () => {
				const cur = req.result;
				if (!cur) return resolve(sum);
				sum += (cur.value as ArrayBuffer).byteLength;
				cur.continue();
			};
			req.onerror = () => reject(req.error);
		});
	})();
	tileBytes.catch(() => {
		tileBytes = null;
	});
	return tileBytes;
}

/** The photo store's bytes, counted against the same budget; reported by whoever reads that store. */
export function notePhotoBytes(bytes: number): void {
	photoBytes = bytes;
}

/** Bytes the budget sees: tiles on disk plus the photos last reported. */
export async function usedBytes(): Promise<number> {
	return (await scanTileBytes()) + photoBytes;
}

/** Writes nothing when the batch would cross the budget — the whole batch, so a blob is never half over the line. */
/**
 * What this blob's tiles weigh on disk — its OWN size, not what it downloaded.
 * A blob laid over ground another blob already covers fetches nothing, so a
 * download-side counter reports 0 MB for a blob that plainly holds tiles.
 * Shared tiles count for every blob that covers them: each one would need
 * them if the others went away.
 *
 * Cursor, never getAll(), for the same reason as `stats()` — a full read holds
 * every tile in the heap at once.
 */
export async function bytesOfTiles(keys: readonly string[]): Promise<number> {
	if (keys.length === 0) return 0;
	const want = new Set(keys);
	const db = await open();
	const tx = db.transaction(TILES, "readonly");
	const st = tx.objectStore(TILES);
	let bytes = 0;
	return new Promise<number>((resolve, reject) => {
		const req = st.openCursor();
		req.onsuccess = () => {
			const cur = req.result;
			if (!cur) return resolve(bytes);
			if (want.has(cur.key as string))
				bytes += (cur.value as ArrayBuffer).byteLength;
			cur.continue();
		};
		req.onerror = () => reject(req.error);
	});
}

export async function putTiles(
	entries: Array<[string, ArrayBuffer]>,
): Promise<void> {
	if (entries.length === 0) return;
	const adding = entries.reduce((a, [, b]) => a + b.byteLength, 0);
	const used = await usedBytes();
	const budget = budgetBytes();
	if (used + adding > budget) throw new BudgetError(used, budget, adding);
	const db = await open();
	const tx = db.transaction(TILES, "readwrite");
	const st = tx.objectStore(TILES);
	for (const [k, b] of entries) st.put(b, k);
	await done(tx);
	tileBytes = Promise.resolve(used - photoBytes + adding);
}

/** Drop tiles by key — a failed download takes back what it wrote, so no tile is on disk without a blob. */
export async function deleteTiles(keys: string[]): Promise<void> {
	if (keys.length === 0) return;
	const db = await open();
	const tx = db.transaction(TILES, "readwrite");
	const st = tx.objectStore(TILES);
	for (const k of keys) st.delete(k);
	await done(tx);
	tileBytes = null;
}

export async function allTileKeys(): Promise<Set<string>> {
	const db = await open();
	const tx = db.transaction(TILES, "readonly");
	const keys = await result(tx.objectStore(TILES).getAllKeys());
	return new Set(keys as string[]);
}

export async function listRegions(): Promise<Region[]> {
	const db = await open();
	const tx = db.transaction(REGIONS, "readonly");
	const rows = await result(
		tx.objectStore(REGIONS).getAll() as IDBRequest<Region[]>,
	);
	return rows.sort((a, b) => b.at - a.at);
}

// The protocol reads the region list on every parent-tile read; it is served
// from here so a tile read never opens a transaction, and `version` lets the
// clipped tiles it caches be dropped the moment a blob comes or goes.
let regionsVersion = 0;
let regionsCache: Promise<Region[]> | null = null;

function regionsChanged(): void {
	regionsVersion++;
	regionsCache = null;
}

export function regionsSnapshot(): {
	version: number;
	regions: Promise<Region[]>;
} {
	if (!regionsCache) regionsCache = listRegions();
	return { version: regionsVersion, regions: regionsCache };
}

export async function putRegion(r: Region): Promise<void> {
	const db = await open();
	const tx = db.transaction(REGIONS, "readwrite");
	tx.objectStore(REGIONS).put(r);
	await done(tx);
	regionsChanged();
}

/**
 * Every blob against the keys on disk: the count of its tiles that are not
 * there. Zero is a whole blob. An empty tile is stored as a 0-byte row, so
 * "whole" is a set difference, never a guess about what the Worker had.
 */
export async function checkRegions(): Promise<Record<string, number>> {
	const [regions, have] = await Promise.all([listRegions(), allTileKeys()]);
	const out: Record<string, number> = {};
	for (const r of regions) out[r.id] = missingKeys(r.range, have).length;
	await healRegionBytes(regions);
	return out;
}

/**
 * Blobs written before `bytes` meant size-on-disk carry the download-side
 * count, which is 0 for any blob whose ground another blob already covered.
 * The audit is where they get their true size: one cursor pass sizes every
 * blob at once, so healing 74 rows costs the same scan as sizing one.
 */
async function healRegionBytes(regions: readonly Region[]): Promise<void> {
	const stale = regions.filter((r) => r.bytes === 0 && r.tiles > 0);
	if (stale.length === 0) return;
	const owners = new Map<string, Region[]>();
	for (const r of stale)
		for (const t of rangeTiles(r.range)) {
			const k = tileKey(t);
			const list = owners.get(k);
			if (list) list.push(r);
			else owners.set(k, [r]);
		}
	const sized = new Map<string, number>(stale.map((r) => [r.id, 0]));
	const db = await open();
	const st = db.transaction(TILES, "readonly").objectStore(TILES);
	await new Promise<void>((resolve, reject) => {
		const req = st.openCursor();
		req.onsuccess = () => {
			const cur = req.result;
			if (!cur) return resolve();
			const mine = owners.get(cur.key as string);
			if (mine) {
				const n = (cur.value as ArrayBuffer).byteLength;
				for (const r of mine)
					sized.set(r.id, (sized.get(r.id) as number) + n);
			}
			cur.continue();
		};
		req.onerror = () => reject(req.error);
	});
	for (const r of stale) {
		const n = sized.get(r.id) as number;
		if (n > 0) await putRegion({ ...r, bytes: n });
	}
}

/** Tile count and byte total of the whole store — a full scan, for the rail; not on any hot path. */
export async function stats(): Promise<{ tiles: number; bytes: number }> {
	const db = await open();
	const tx = db.transaction(TILES, "readonly");
	const st = tx.objectStore(TILES);
	// Cursor, never getAll(): a full read holds every tile in the heap at once.
	let bytes = 0;
	const summed = new Promise<void>((resolve, reject) => {
		const req = st.openCursor();
		req.onsuccess = () => {
			const cur = req.result;
			if (!cur) return resolve();
			bytes += (cur.value as ArrayBuffer).byteLength;
			cur.continue();
		};
		req.onerror = () => reject(req.error);
	});
	const [tiles] = await Promise.all([result(st.count()), summed]);
	return { tiles, bytes };
}

/**
 * Delete a blob, and only the tiles no OTHER blob still covers. Coverage is
 * geometry (is this tile under a surviving blob's anchor tiles?), so there
 * is no refcount to drift.
 */
export async function deleteRegion(id: string): Promise<number> {
	const regions = await listRegions();
	const gone = regions.find((r) => r.id === id);
	if (!gone) return 0;
	const keep = regions.filter((r) => r.id !== id).map((r) => r.range);
	const doomed = rangeTiles(gone.range)
		.filter((t) => !keep.some((r) => rangeContains(r, t)))
		.map(tileKey);
	const db = await open();
	const tx = db.transaction([TILES, REGIONS], "readwrite");
	const st = tx.objectStore(TILES);
	for (const k of doomed) st.delete(k);
	tx.objectStore(REGIONS).delete(id);
	await done(tx);
	tileBytes = null;
	regionsChanged();
	return doomed.length;
}

export async function wipe(): Promise<void> {
	const db = await open();
	const tx = db.transaction([TILES, REGIONS], "readwrite");
	tx.objectStore(TILES).clear();
	tx.objectStore(REGIONS).clear();
	await done(tx);
	tileBytes = Promise.resolve(0);
	regionsChanged();
}

// KEEPING THE DATA. Storage is best-effort until the page asks: Chrome drops
// a whole origin under disk pressure, Safari after seven days unvisited. The
// browser answers without a prompt (Chrome grants on engagement, Safari on
// install), so the answer is a fact to show, not a dialog to expect.
export type Kept = "kept" | "evictable" | "unknown";
let kept: Promise<Kept> | null = null;

/** Ask once per boot; every later call returns the same answer. */
export function keepStorage(): Promise<Kept> {
	if (kept) return kept;
	kept = (async () => {
		try {
			const s = navigator.storage;
			if (!s?.persist) return "unknown";
			if (await s.persisted()) return "kept";
			return (await s.persist()) ? "kept" : "evictable";
		} catch {
			return "unknown";
		}
	})();
	return kept;
}
