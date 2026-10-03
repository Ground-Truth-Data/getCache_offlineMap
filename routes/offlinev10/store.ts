/** The tile store: one IndexedDB store keyed `z/x/y`, one copy per tile
 * however many blobs cover it; a second store lists the blobs. */

import { deleteSatImage, photoTilesFor, type RawTile, satImageKey } from "../../lib/onPhone/satellite/satelliteImage";
import { PHOTO_SOURCES } from "../../lib/onPhone/satellite/photoSources";
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
/** Bump when what a blob IS changes; an older blob is then wiped, never half-drawn. */
const DB_VERSION = 3;
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
	/** tap → photo on screen (the map, for a blob without one): what the person waited */
	msWait?: number;
	/** on disk → painted (idle) */
	msPaint?: number;
	/** the camera moved before idle, so there is no honest paint time */
	paintMoved?: true;
	/** false on a follow-me blob: no pin, no photo. Absent means a photo. */
	photo?: false;
	/** null when its tiles hold no town; absent before it was looked up */
	place?: Place | null;
	/** ms epoch the map last showed it; absent = never, so `at` stands in */
	lastOpened?: number;
	/** ms epoch it was removed. The row stays so the engine does not fetch the pin's blob straight back. */
	removed?: number;
	/** Born before its first tile so no tile is ever on disk unnamed; still set means the download stopped and the engine fetches the rest. */
	filling?: true;
	/** Born from a pin at this spot; once the host is ready, a pin-born area with no pin here goes. Absent on follow-me. */
	pin?: true;
}

/** The area a write names has no live row: removed, or its pin deleted. */
export class AreaGone extends Error {
	constructor(id: string) {
		super(`offline area ${id} is gone`);
		this.name = "AreaGone";
	}
}

/** A blob is its pin's spot — the same spot is the same blob, a pace away is another. */
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

// One write at a time: each reads the running total and writes it back, so two at once lose bytes.
let writing: Promise<void> = Promise.resolve();

/** Every tile is written under its area's live row, checked in the same transaction, so a write can never outlive the area. */
export function putTiles(entries: Array<[string, ArrayBuffer]>, owner: string): Promise<void> {
	const run = writing.then(() => putNow(entries, owner));
	writing = run.catch(() => undefined);
	return run;
}

async function putNow(entries: Array<[string, ArrayBuffer]>, owner: string): Promise<void> {
	if (entries.length === 0) return;
	const adding = entries.reduce((a, [, b]) => a + b.byteLength, 0);
	const used = await usedBytes();
	const budget = budgetBytes();
	// Refuse, never evict: what is on disk is what someone chose to keep.
	if (used + adding > budget) throw new BudgetError(used, budget, adding);
	const db = await open();
	const tx = db.transaction([TILES, REGIONS], "readwrite");
	const st = tx.objectStore(TILES);
	const row = tx.objectStore(REGIONS).get(owner) as IDBRequest<Region | undefined>;
	let gone = false;
	row.onsuccess = () => {
		if (row.result && !row.result.removed) for (const [k, b] of entries) st.put(b, k);
		else {
			gone = true;
			tx.abort();
		}
	};
	await done(tx).catch((e) => {
		throw gone ? new AreaGone(owner) : e;
	});
	tileBytes = Promise.resolve(used - photoBytes + adding);
}

/** Photo tiles share the road tiles' store and budget; the prefix keeps a z13 photo tile off a z13 road tile. */
export const PHOTO_PREFIX = "p/";

export function putPhotoTiles(tiles: RawTile[], owner: string): Promise<void> {
	return putTiles(tiles.map(([k, b]) => [PHOTO_PREFIX + k, b]), owner);
}

/** The photo tiles on disk among `keys` (`z/x/y`), one transaction. */
export async function getPhotoTiles(keys: readonly string[]): Promise<Map<string, ArrayBuffer>> {
	const db = await open();
	const tx = db.transaction(TILES, "readonly");
	const st = tx.objectStore(TILES);
	const out = new Map<string, ArrayBuffer>();
	for (const k of keys) {
		const req = st.get(PHOTO_PREFIX + k) as IDBRequest<ArrayBuffer | undefined>;
		req.onsuccess = () => {
			if (req.result?.byteLength) out.set(k, req.result);
		};
	}
	await done(tx);
	return out;
}

/** The photo tiles under a blob's pin; none for a follow-me blob. */
function photoKeysOf(r: Region): string[] {
	if (r.photo === false) return [];
	const z = PHOTO_SOURCES[0].zoom;
	return photoTilesFor([r.lng, r.lat], z).map((t) => `${PHOTO_PREFIX}${z}/${t.x}/${t.y}`);
}

/** Bytes of each blob's photo tiles, one cursor pass; shared tiles count for every blob covering them. */
export async function photoTileBytes(regions: readonly Region[]): Promise<Map<string, { tiles: number; bytes: number }>> {
	const owners = new Map<string, string[]>();
	const out = new Map<string, { tiles: number; bytes: number }>();
	for (const r of regions) {
		out.set(r.id, { tiles: 0, bytes: 0 });
		for (const k of photoKeysOf(r)) owners.set(k, [...(owners.get(k) ?? []), r.id]);
	}
	const db = await open();
	const st = db.transaction(TILES, "readonly").objectStore(TILES);
	await new Promise<void>((resolve, reject) => {
		const req = st.openCursor(IDBKeyRange.bound(PHOTO_PREFIX, `${PHOTO_PREFIX}￿`));
		req.onsuccess = () => {
			const cur = req.result;
			if (!cur) return resolve();
			for (const id of owners.get(cur.key as string) ?? []) {
				const o = out.get(id) as { tiles: number; bytes: number };
				o.tiles += 1;
				o.bytes += (cur.value as ArrayBuffer).byteLength;
			}
			cur.continue();
		};
		req.onerror = () => reject(req.error);
	});
	return out;
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

/** The areas on disk, newest first; removed rows are not areas. */
export async function listRegions(): Promise<Region[]> {
	const db = await open();
	const tx = db.transaction(REGIONS, "readonly");
	const rows = await result(
		tx.objectStore(REGIONS).getAll() as IDBRequest<Region[]>,
	);
	return rows.filter((r) => !r.removed).sort((a, b) => b.at - a.at);
}

/** Whether the engine leaves this spot alone: its area is whole, or removed. A row still filling is fetched again. */
export async function regionKnown(id: string): Promise<boolean> {
	const r = await regionRow(id);
	return !!r && (!!r.removed || !r.filling);
}

/** Throws `AreaGone` unless the area has a live row; the photo's last word before it is saved. */
export async function claimArea(id: string): Promise<void> {
	const r = await regionRow(id);
	if (!r || r.removed) throw new AreaGone(id);
}

/** Every pin-born row, removed ones included: what the engine judges against the pins once the host is ready. */
export async function pinAreas(): Promise<Region[]> {
	const db = await open();
	const tx = db.transaction(REGIONS, "readonly");
	const rows = await result(tx.objectStore(REGIONS).getAll() as IDBRequest<Region[]>);
	return rows.filter((r) => r.pin);
}

async function regionRow(id: string): Promise<Region | undefined> {
	const db = await open();
	const tx = db.transaction(REGIONS, "readonly");
	return result(tx.objectStore(REGIONS).get(id) as IDBRequest<Region | undefined>);
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

export async function putRegion(r: Region): Promise<void> {
	removing.delete(r.id);
	const db = await open();
	const tx = db.transaction(REGIONS, "readwrite");
	tx.objectStore(REGIONS).put(r);
	await done(tx);
	regionsChanged();
}

/** Updates only a row still on disk — `put` is an upsert, so a late write from a copy would resurrect a deleted blob. */
export async function patchRegion(id: string, patch: Partial<Omit<Region, "id">>): Promise<void> {
	const db = await open();
	const tx = db.transaction(REGIONS, "readwrite");
	const st = tx.objectStore(REGIONS);
	const req = st.get(id) as IDBRequest<Region | undefined>;
	req.onsuccess = () => {
		if (req.result) st.put({ ...req.result, ...patch });
	};
	await done(tx);
	regionsChanged();
}

/** Per blob, its tiles not on disk (zero is whole) — an empty tile is a 0-byte row, so this is a set difference. */
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
		if (n > 0) await patchRegion(r.id, { bytes: n });
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

/** Delete a blob, its photo, and only the tiles no other blob still covers — coverage is geometry, so no refcount to drift.
 * `keepRow` leaves a `removed` row behind so the pin's blob is not fetched straight back; without it a removed row goes too.
 * Null when the spot has no row. */
// Marked before the first await, so a download in flight stops at its next fetch, not its next write.
const removing = new Set<string>();
export const isRemoving = (id: string): boolean => removing.has(id);

export async function deleteRegion(id: string, keepRow = false): Promise<number | null> {
	removing.add(id);
	const gone = await regionRow(id);
	if (!gone) return null;
	const others = (await listRegions()).filter((r) => r.id !== id);
	const keep = others.map((r) => r.range);
	const keepPhoto = new Set(others.flatMap(photoKeysOf));
	const doomed = rangeTiles(gone.range)
		.filter((t) => !keep.some((r) => rangeContains(r, t)))
		.map(tileKey)
		.concat(photoKeysOf(gone).filter((k) => !keepPhoto.has(k)));
	const db = await open();
	const tx = db.transaction([TILES, REGIONS], "readwrite");
	const st = tx.objectStore(TILES);
	for (const k of doomed) st.delete(k);
	if (keepRow) tx.objectStore(REGIONS).put({ ...gone, removed: Date.now() });
	else tx.objectStore(REGIONS).delete(id);
	await done(tx);
	tileBytes = null;
	regionsChanged();
	await deleteSatImage(satImageKey([gone.lng, gone.lat]));
	return doomed.length;
}

/** Marks the areas the map just showed; a write only when the mark is an hour old, so panning costs nothing. */
export async function touchRegions(ids: readonly string[], now = Date.now()): Promise<void> {
	if (ids.length === 0) return;
	const want = new Set(ids);
	const db = await open();
	const tx = db.transaction(REGIONS, "readwrite");
	const st = tx.objectStore(REGIONS);
	const req = st.getAll() as IDBRequest<Region[]>;
	let wrote = false;
	req.onsuccess = () => {
		for (const r of req.result)
			if (want.has(r.id) && !r.removed && now - (r.lastOpened ?? 0) > 3_600_000) {
				st.put({ ...r, lastOpened: now });
				wrote = true;
			}
	};
	await done(tx);
	if (wrote) regionsChanged();
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

// Storage is best-effort until asked (Safari evicts after seven days unvisited). Chrome and Safari answer silently; Firefox prompts.
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
