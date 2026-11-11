/** The tile store: one IndexedDB store keyed `z/x/y`, one copy per tile
 * however many blobs cover it; a second store lists the blobs. */

import { SATELLITE_SOURCES } from "../../lib/contract/satelliteSources";
import { deleteAllSatImages, deleteSatImage, pieceTileKeys, type RawTile } from "../../lib/onPhone/satellite/satelliteImage";
import { BudgetError, budgetBytes } from "./budget";
import type { Place } from "./places";
import {
	type Box,
	boxesIntersect,
	missingKeys,
	type Range,
	rangeContains,
	rangeTiles,
	tileKey,
} from "./tiles";

export const DB_NAME = "gc-offlineV10";
/** Bump when what a blob IS changes; an older blob is then wiped, never half-drawn. 7 keeps 6's blobs: it only names the source in a photo tile's key. 9: a photo is its pieces' rings, not a pin's disc. 10: a feature's blob carries its kind, not a bare pin flag. */
const DB_VERSION = 10;
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
	/** Where this blob's piece photo lives in the photo store, set once at birth. Absent on a pin's or line's blob: no photo. */
	photoKey?: string;
	/** The outer rings of the pieces that photo covers. Set with `photoKey`. */
	photoRings?: [number, number][][];
	/** null when its tiles hold no town; absent before it was looked up */
	place?: Place | null;
	/** ms epoch the map last showed it; absent = never, so `at` stands in */
	lastOpened?: number;
	/** ms epoch it was removed. The row stays so the engine does not fetch the feature's blob straight back. */
	removed?: number;
	/** Born before its first tile so no tile is ever on disk unnamed; still set means the download stopped and the engine fetches the rest. */
	filling?: true;
	/** The host feature it was born from, by the host's glyph name; once the host is ready, a blob whose feature is gone goes. Absent on follow-me. */
	kind?: string;
}

/** The area a write names has no live row. `removed`: the row says so, a feature was deleted or a download failed. `missing`: no row at all, so whoever named it holds an id no blob was born with. */
export class AreaGone extends Error {
	constructor(
		readonly id: string,
		readonly why: "removed" | "missing",
	) {
		super(`offline area ${id} is ${why === "removed" ? "removed" : "missing (no row has this id)"}`);
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
		let emptied = false;
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const name of [TILES, REGIONS])
				if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
			db.createObjectStore(TILES);
			db.createObjectStore(REGIONS, { keyPath: "id" });
			emptied = true;
		};
		req.onsuccess = () => {
			const db = req.result;
			// A wipe from another tab must not be blocked by this connection.
			db.onversionchange = () => {
				db.close();
				dbp = null;
			};
			if (emptied) deleteAllSatImages().then(() => resolve(db), reject);
			else resolve(db);
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

// Running total so the budget check costs nothing per write.
let tileBytes: Promise<number> | null = null;

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

/** Bytes the budget sees: every tile on disk, roads and satellite. */
export function usedBytes(): Promise<number> {
	return scanTileBytes();
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
	// The last wall, for a bad guess: eviction happened before the download, in makeRoom.
	if (used + adding > budget) throw new BudgetError(used, budget, adding);
	const db = await open();
	const tx = db.transaction([TILES, REGIONS], "readwrite");
	const st = tx.objectStore(TILES);
	const row = tx.objectStore(REGIONS).get(owner) as IDBRequest<Region | undefined>;
	let gone: AreaGone | null = null;
	row.onsuccess = () => {
		if (row.result && !row.result.removed) for (const [k, b] of entries) st.put(b, k);
		else {
			gone = new AreaGone(owner, row.result ? "removed" : "missing");
			tx.abort();
		}
	};
	await done(tx).catch((e) => {
		throw gone ?? e;
	});
	tileBytes = Promise.resolve(used + adding);
}

/** Satellite tiles share the road tiles' store and budget, keyed `p/<source>/z/x/y`; the prefix keeps them off a road tile. */
export const PHOTO_PREFIX = "p/";

/** An empty buffer is kept too: it records ground the source has no imagery for. */
export function putPhotoTiles(tiles: RawTile[], owner: string, source: string): Promise<void> {
	return putTiles(tiles.map(([k, b]) => [`${PHOTO_PREFIX}${source}/${k}`, b]), owner);
}

/** `source`'s tiles on disk among `keys` (`z/x/y`), one transaction. */
export async function getPhotoTiles(keys: readonly string[], source: string): Promise<Map<string, ArrayBuffer>> {
	const db = await open();
	const tx = db.transaction(TILES, "readonly");
	const st = tx.objectStore(TILES);
	const out = new Map<string, ArrayBuffer>();
	for (const k of keys) {
		const req = st.get(`${PHOTO_PREFIX}${source}/${k}`) as IDBRequest<ArrayBuffer | undefined>;
		req.onsuccess = () => {
			if (req.result) out.set(k, req.result);
		};
	}
	await done(tx);
	return out;
}

/** Every satellite tile a blob's piece could hold, from any source: geometry, so a delete needs no record. None without a piece. */
function photoKeysOf(r: Region): string[] {
	const rings = r.photoRings;
	if (!rings) return [];
	return Object.entries(SATELLITE_SOURCES).flatMap(([id, s]) => pieceTileKeys(rings, s.zoom).map((k) => `${PHOTO_PREFIX}${id}/${k}`));
}

function ringsBox(r: Region, pad: number): Box | null {
	const pts = r.photoRings?.flat();
	if (!pts?.length) return null;
	const lng = pts.map((p) => p[0]);
	const lat = pts.map((p) => p[1]);
	return { w: Math.min(...lng) - pad, e: Math.max(...lng) + pad, s: Math.min(...lat) - pad, n: Math.max(...lat) + pad };
}

/** A blob's photo tiles on disk, all it covers, in one cursor pass. What a bake added is on its record's wire. */
export interface CloseUp {
	tiles: number;
	bytes: number;
}

export async function photoTileBytes(regions: readonly Region[]): Promise<Map<string, CloseUp>> {
	const owners = new Map<string, string[]>();
	const out = new Map<string, CloseUp>();
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
			const size = (cur.value as ArrayBuffer).byteLength;
			for (const id of owners.get(cur.key as string) ?? []) {
				const o = out.get(id) as CloseUp;
				o.tiles += 1;
				o.bytes += size;
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
	if (!r || r.removed) throw new AreaGone(id, r ? "removed" : "missing");
}

/** Every feature-born row, removed ones included: what the engine judges against the features once the host is ready. */
export async function featureAreas(): Promise<Region[]> {
	const db = await open();
	const tx = db.transaction(REGIONS, "readonly");
	const rows = await result(tx.objectStore(REGIONS).getAll() as IDBRequest<Region[]>);
	return rows.filter((r) => r.kind);
}

export async function regionRow(id: string): Promise<Region | undefined> {
	const db = await open();
	const tx = db.transaction(REGIONS, "readonly");
	return result(tx.objectStore(REGIONS).get(id) as IDBRequest<Region | undefined>);
}

// Cached so a parent-tile read never opens a transaction; `version` invalidates the protocol's clipped tiles.
let regionsVersion = 0;
let regionsCache: Promise<Region[]> | null = null;

const regionWatchers = new Set<() => void>();

function regionsChanged(): void {
	regionsVersion++;
	regionsCache = null;
	for (const fn of regionWatchers) fn();
}

/** A blob started, finished or went: whatever was read from the pack before may be stale. */
export function onRegionsChanged(fn: () => void): () => void {
	regionWatchers.add(fn);
	return () => regionWatchers.delete(fn);
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

/** Per blob, its tiles not on disk (zero is whole) — an empty tile is a 0-byte row, so this is a set difference.
 * Given ids, only those blobs, read column by column: the map checks the few on screen, never the whole store. */
export async function checkRegions(ids?: readonly string[]): Promise<Record<string, number>> {
	const all = await listRegions();
	const regions = ids ? all.filter((r) => ids.includes(r.id)) : all;
	const have = ids ? await keysUnder(regions) : await allTileKeys();
	const out: Record<string, number> = {};
	for (const r of regions) out[r.id] = missingKeys(r.range, have).length;
	await healRegionBytes(regions);
	return out;
}

/** One request per `z/x/` column under these blobs — keys sort by column, so it reads just those tiles. */
function columnsUnder(regions: readonly Region[]): IDBKeyRange[] {
	const cols = new Set<string>();
	for (const r of regions) for (const t of rangeTiles(r.range)) cols.add(`${t.z}/${t.x}/`);
	return [...cols].map((c) => IDBKeyRange.bound(c, `${c}￿`));
}

async function keysUnder(regions: readonly Region[]): Promise<Set<string>> {
	const db = await open();
	const st = db.transaction(TILES, "readonly").objectStore(TILES);
	const keys = await Promise.all(columnsUnder(regions).map((c) => result(st.getAllKeys(c))));
	return new Set(keys.flat() as string[]);
}

/** Sizes every `bytes: 0` blob, reading only its own columns. */
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
	await Promise.all(
		columnsUnder(stale).map(
			(c) =>
				new Promise<void>((resolve, reject) => {
					const req = st.openCursor(c);
					req.onsuccess = () => {
						const cur = req.result;
						if (!cur) return resolve();
						const mine = owners.get(cur.key as string);
						if (mine) {
							const n = (cur.value as ArrayBuffer).byteLength;
							for (const r of mine) sized.set(r.id, (sized.get(r.id) as number) + n);
						}
						cur.continue();
					};
					req.onerror = () => reject(req.error);
				}),
		),
	);
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
 * `keepRow` leaves a `removed` row behind so the feature's blob is not fetched straight back; without it a removed row goes too.
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
	// Only a piece within one coarsest photo tile can share a tile: tiling every piece at z18 froze the app 8 s.
	const near = ringsBox(gone, 360 / 2 ** Math.min(...Object.values(SATELLITE_SOURCES).map((s) => s.zoom)));
	const keepPhoto = new Set(others.filter((r) => near && r.photoRings && boxesIntersect(near, ringsBox(r, 0)!)).flatMap(photoKeysOf));
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
	// Another blob may use this photo: it goes with the last of them. Judged after this delete committed, against the rows now on disk: of two deletes at once the later one sees both gone.
	if (gone.photoKey && !(await listRegions()).some((r) => r.photoKey === gone.photoKey)) await deleteSatImage(gone.photoKey);
	return doomed.length;
}

/** Marks the areas the map just showed and returns those it marked; a write only when the mark is an hour old, so panning costs nothing. */
export async function touchRegions(ids: readonly string[], now = Date.now()): Promise<string[]> {
	if (ids.length === 0) return [];
	const want = new Set(ids);
	const db = await open();
	const tx = db.transaction(REGIONS, "readwrite");
	const st = tx.objectStore(REGIONS);
	const req = st.getAll() as IDBRequest<Region[]>;
	const wrote: string[] = [];
	req.onsuccess = () => {
		for (const r of req.result)
			if (want.has(r.id) && !r.removed && now - (r.lastOpened ?? 0) > 3_600_000) {
				st.put({ ...r, lastOpened: now });
				wrote.push(r.id);
			}
	};
	await done(tx);
	if (wrote.length) regionsChanged();
	return wrote;
}


export async function wipe(): Promise<void> {
	const db = await open();
	const tx = db.transaction([TILES, REGIONS], "readwrite");
	tx.objectStore(TILES).clear();
	tx.objectStore(REGIONS).clear();
	await done(tx);
	await deleteAllSatImages();
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
