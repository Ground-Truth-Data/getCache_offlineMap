/** The tile store: one IndexedDB store keyed `z/x/y`, one copy per tile however many blobs cover it; a second store lists the blobs. */

import { BudgetError, budgetBytes } from "./budget";
import { toEvict } from "./evict";
import type { Place } from "./places";
import {
	missingKeys,
	type Range,
	rangeContains,
	rangeTiles,
	tileKey,
} from "./tiles";

export const DB_NAME = "gc-offlineV10";
/** Bump when what a blob IS changes; an older blob is then wiped, never half-drawn. */
const DB_VERSION = 2;
const TILES = "tiles";
const REGIONS = "regions";

export interface Region {
	id: string;
	lng: number;
	lat: number;
	range: Range;
	/** ms epoch */
	at: number;
	tiles: number;
	/** tiles fetched for this blob (the rest were already on disk) */
	fetched: number;
	/** size on disk, shared tiles included */
	bytes: number;
	/** bytes this blob added, shared ground excluded; absent = unknown, never 0 */
	newBytes?: number;
	/** ask → all on disk */
	ms: number;
	/** on disk → painted (idle) */
	msPaint?: number;
	/** the camera moved before idle, so there is no honest paint time */
	paintMoved?: true;
	/** false on a follow-me blob: no pin, no photo. Absent means a photo. */
	photo?: false;
	/** null when its tiles hold no town; absent before it was looked up */
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

// Running total so the budget check costs nothing per write; photos live in another store and report here.
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

/** Size on disk of these tiles; shared tiles count for every blob covering them. Cursor, never getAll(). */
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

/**
 * Evict the oldest blobs until `adding` fits, at the write boundary so no download path can bypass it.
 * A blob bigger than the whole budget evicts nothing and lets the caller's BudgetError stand.
 */
export async function makeRoom(adding: number): Promise<Region[]> {
	// Rows carry `bytes: 0` until sized; a policy fed zeroes evicts nothing.
	await healRegionBytes(await listRegions());
	const doomed = toEvict(await listRegions(), {
		adding,
		budget: budgetBytes(),
		used: await usedBytes(),
	});
	for (const r of doomed) await deleteRegion(r.id);
	return doomed;
}

export async function putTiles(
	entries: Array<[string, ArrayBuffer]>,
): Promise<void> {
	if (entries.length === 0) return;
	const adding = entries.reduce((a, [, b]) => a + b.byteLength, 0);
	let used = await usedBytes();
	const budget = budgetBytes();
	if (used + adding > budget) {
		await makeRoom(adding);
		used = await usedBytes();
	}
	if (used + adding > budget) throw new BudgetError(used, budget, adding);
	const db = await open();
	const tx = db.transaction(TILES, "readwrite");
	const st = tx.objectStore(TILES);
	for (const [k, b] of entries) st.put(b, k);
	await done(tx);
	tileBytes = Promise.resolve(used - photoBytes + adding);
}

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

// Cached so a parent-tile read never opens a transaction; `version` invalidates the protocol's clipped tiles.
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

/** The blob-count wall is here, not `putTiles`: a blob over already-covered ground writes no tiles. */
export async function putRegion(r: Region): Promise<void> {
	const have = (await listRegions()).filter((x) => x.id !== r.id);
	const room = { adding: 0, budget: budgetBytes(), used: await usedBytes() };
	for (const gone of toEvict(have, room)) await deleteRegion(gone.id);
	const db = await open();
	const tx = db.transaction(REGIONS, "readwrite");
	tx.objectStore(REGIONS).put(r);
	await done(tx);
	regionsChanged();
}

/** Per blob, the count of its tiles not on disk; zero is whole. An empty tile is a 0-byte row, so this is a set difference. */
export async function checkRegions(): Promise<Record<string, number>> {
	const [regions, have] = await Promise.all([listRegions(), allTileKeys()]);
	const out: Record<string, number> = {};
	for (const r of regions) out[r.id] = missingKeys(r.range, have).length;
	await healRegionBytes(regions);
	return out;
}

/** Sizes every `bytes: 0` blob in one cursor pass. */
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

/** Full scan, for the rail; not on any hot path. */
export async function stats(): Promise<{ tiles: number; bytes: number }> {
	const db = await open();
	const tx = db.transaction(TILES, "readonly");
	const st = tx.objectStore(TILES);
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

/** Delete a blob and only the tiles no other blob still covers; coverage is geometry, so no refcount to drift. */
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

// Storage is best-effort until asked (Safari evicts after seven days unvisited); the browser answers without a prompt.
export type Kept = "kept" | "evictable" | "unknown";
let kept: Promise<Kept> | null = null;

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
