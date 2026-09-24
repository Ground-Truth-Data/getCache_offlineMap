import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { guardPackDownload } from "../../../onPhone/store/downloadGuard";
import { migrateIdbDatabase } from "../../../onPhone/store/idbRename";
import {
    currentDbName,
    registerOfflineDbReset,
    registerWipeLatch,
} from "../../../shared/sandboxDbNames";
import { BLOB_RADIUS_KM, BLOB_ZOOMS } from "../../../contract/roadBlob";
import { pinTileKey } from "../../../contract/grid";
import {
    keysForAddress,
    shallowKeysForAddress,
} from "../../../onPhone/roads/pinTileLookup";
import { TileByteCache } from "../../../onPhone/roads/tileByteCache";
import { mergeSameFrameTiles } from "../../../onPhone/roads/tileMerge";
import {
    cellsFor,
    isShallowTileKey,
    shallowCellsFor,
    shallowTileKey,
} from "../../../contract/grid";
import { getWorkerTarget, packUrl } from "../tilesHost";
import { noteCircuit } from "../../../shared/workMeter.svelte";
import { satImageKey } from "../../../onPhone/satellite/satelliteImage";

// Bump on any pack wire/content change, and only AFTER the new Worker is live:
// the edge cache keys by full URL and is never purged, so a version built by
// the old Worker is poisoned for good. Never reuse a skipped number.
export const PACK_FORMAT_VERSION = 49;

// Renaming the DB wipes every device's tile pile.
export const DB_NAME = "gc-offlineTiles";
const STORE = "tiles";
// The shallow z6 tier's own store: a z6 beside `pin/…` z8 keys would be served
// mis-framed to z8 requests by the main lookup's containment.
const STORE_SHALLOW = "shallowTiles";
export const DB_VERSION = 2;

// The sweep must run after the migration settles: the source is also a sweep match.
const TILES_MIGRATION_SOURCE = "rt-tiles-v3";
if (typeof indexedDB !== "undefined") {
    void migrateIdbDatabase(TILES_MIGRATION_SOURCE, DB_NAME, STORE).then(() => {
        if (typeof indexedDB.databases === "function") {
            indexedDB
                .databases()
                .then((dbs) => {
                    for (const d of dbs) {
                        if (
                            (d.name?.startsWith("retreever-v4-tiles") ||
                                d.name?.startsWith("rt-tiles")) &&
                            d.name !== DB_NAME
                        ) {
                            indexedDB.deleteDatabase(d.name);
                        }
                    }
                })
                // codestyle-allow-swallow: best-effort stale-DB sweep, retried next boot
                .catch(() => {});
        }
    });
}

// Derived, never hand-written: edit BLOB_RADIUS_KM / BLOB_ZOOMS and bump PACK_FORMAT_VERSION.
export const RINGS: ReadonlyArray<{ km: number; z: number }> = BLOB_ZOOMS.map(
    (z) => ({ km: BLOB_RADIUS_KM, z }),
);
export const DETAIL_INNER_Z = 15;
export const V4_SOURCE_MAXZOOM = DETAIL_INNER_Z;

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(currentDbName(DB_NAME), DB_VERSION);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE))
                req.result.createObjectStore(STORE);
            if (!req.result.objectStoreNames.contains(STORE_SHALLOW))
                req.result.createObjectStore(STORE_SHALLOW);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbPutMany(
    items: Array<[string, ArrayBuffer]>,
    onStored?: (done: number) => void,
): Promise<void> {
    // A persisted 0-byte tile makes Mapbox throw "Unimplemented type: 4" on every render pass until the DB is wiped.
    items = items.filter(([, b]) => b.byteLength > 0);
    if (!items.length) return;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
        // Both stores in one transaction: a pack is all-or-nothing across tiers.
        const tx = db.transaction([STORE, STORE_SHALLOW], "readwrite");
        let done = 0;
        for (const [k, b] of items) {
            const req = tx
                .objectStore(isShallowTileKey(k) ? STORE_SHALLOW : STORE)
                .put(b, k);
            req.onsuccess = () => onStored?.(++done);
        }
        tx.oncomplete = () => {
            noteKeysWritten(items.map(([k]) => k));
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

/** One transaction: a half-deleted area leaves a coverage record saying "gone" over tiles still on disk. */
export async function idbDeleteMany(keys: readonly string[]): Promise<void> {
    if (!keys.length) return;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE, STORE_SHALLOW], "readwrite");
        for (const k of keys)
            tx.objectStore(isShallowTileKey(k) ? STORE_SHALLOW : STORE).delete(
                k,
            );
        tx.oncomplete = () => {
            noteKeysDeleted(keys);
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

/** codestyle-allow-blob-getall: on-demand only, never on a render path. */
async function idbEntries(): Promise<Array<[string, ArrayBuffer]>> {
    const db = await openDb();
    const out = await new Promise<Array<[string, ArrayBuffer]>>(
        (resolve, reject) => {
            const tx = db.transaction(STORE, "readonly");
            const store = tx.objectStore(STORE);
            const keysReq = store.getAllKeys();
            // codestyle-allow-blob-getall: on-demand only
            const valsReq = store.getAll();
            tx.oncomplete = () =>
                resolve(
                    (keysReq.result as string[])
                        .map(
                            (k, i) =>
                                [k, valsReq.result[i] as ArrayBuffer] as [
                                    string,
                                    ArrayBuffer,
                                ],
                        )
                        .filter(([, b]) => b?.byteLength > 0),
                );
            tx.onerror = () => reject(tx.error);
        },
    );
    db.close();
    return out;
}

// One long-lived handle: idbGetTile runs per visible tile.
let rawDb: IDBDatabase | null = null;

// A cached connection blocks deleteDatabase; every module caching an IDBDatabase must register here.
registerOfflineDbReset(() => {
    rawDb?.close();
    rawDb = null;
    invalidateTileCaches();
});

registerWipeLatch({
    latch: () => {
        rawDb?.close();
        rawDb = null;
        invalidateTileCaches();
    },
    unlatch: () => {},
});

// Render-hot caches in front of IndexedDB, maintained by the write path and
// cleared on wipe/reset/purge: a zoom gesture re-requests every visible tile,
// and re-listing keys and re-merging per read froze the UI for seconds.

/** ~2 screens of z8 merges; a miss re-merges, so this is latency, never data. */
const MERGED_CACHE_BYTES = 48 * 1024 * 1024;
const mergedTiles = new TileByteCache(MERGED_CACHE_BYTES);
const inFlightReads = new Map<string, Promise<ArrayBuffer | null>>();
let allKeysCache: Set<string> | null = null;
let allKeysLoad: Promise<Set<string>> | null = null;
let allKeysEpoch = 0;
const shallowMerged = new TileByteCache(MERGED_CACHE_BYTES);
const inFlightShallowReads = new Map<string, Promise<ArrayBuffer | null>>();
let shallowKeysCache: Set<string> | null = null;
let shallowKeysLoad: Promise<Set<string>> | null = null;
let shallowKeysEpoch = 0;

function invalidateTileCaches(): void {
    allKeysEpoch++;
    allKeysCache = null;
    allKeysLoad = null;
    mergedTiles.clear();
    inFlightReads.clear();
    shallowKeysEpoch++;
    shallowKeysCache = null;
    shallowKeysLoad = null;
    shallowMerged.clear();
    inFlightShallowReads.clear();
}

/** An unparseable key drops everything: correctness over cache. */
function dropTilesFor(keys: Iterable<string>): void {
    for (const k of keys) {
        const addr = parseTileAddress(k);
        if (!addr) {
            invalidateTileCaches();
            return;
        }
        mergedTiles.delete(`${addr.z}/${addr.x}/${addr.y}`);
        shallowMerged.delete(`${addr.z}/${addr.x}/${addr.y}`);
    }
}

function noteKeysWritten(keys: readonly string[]): void {
    for (const k of keys) {
        if (isShallowTileKey(k)) {
            if (shallowKeysCache) shallowKeysCache.add(k);
        } else if (allKeysCache) {
            allKeysCache.add(k);
        }
    }
    dropTilesFor(keys);
}

function noteKeysDeleted(keys: readonly string[]): void {
    for (const k of keys) {
        if (isShallowTileKey(k)) {
            if (shallowKeysCache) shallowKeysCache.delete(k);
        } else if (allKeysCache) {
            allKeysCache.delete(k);
        }
    }
    dropTilesFor(keys);
}

const mergedReads = new Set<string>();
const mergedCount = new Map<string, number>();
// One line at the first merge proves the merged read path is live in the running
// build; then one per 100 addresses, since a line per address was 16,000 rows.
function noteMergedRead(tag: string): void {
    const n = (mergedCount.get(tag) ?? 0) + 1;
    mergedCount.set(tag, n);
    if (n === 1 || n % 100 === 0)
        console.warn(
            `[${tag}] merged pins' blobs at ${n} address(es) this session`,
        );
}

/** Every owner layer-merged into one tile, memoized per address; null on miss. */
export async function idbGetTileForAddress(
    z: number,
    x: number,
    y: number,
): Promise<ArrayBuffer | null> {
    const addr = `${z}/${x}/${y}`;
    const job = inFlightReads.get(addr) ?? computeTileForAddress(z, x, y, addr);
    const buf = await job;
    // A fresh copy per caller: MapLibre transfers the buffer to its worker, detaching it.
    return buf ? buf.slice(0) : null;
}

function computeTileForAddress(
    z: number,
    x: number,
    y: number,
    addr: string,
): Promise<ArrayBuffer | null> {
    const job = (async () => {
        const keys = keysForAddress(await getAllTileKeys(), z, x, y);
        if (!keys.length) return null;
        const cached = mergedTiles.get(addr);
        if (
            cached &&
            cached.owners.length === keys.length &&
            cached.owners.every((k, i) => k === keys[i])
        ) {
            return cached.buf;
        }
        if (keys.length === 1) {
            const solo = await idbGetTile(keys[0]);
            if (!solo) return null;
            cacheMergedTile(addr, keys, solo);
            return solo;
        }
        const parts: ArrayBuffer[] = [];
        for (const k of keys) {
            const b = await idbGetTile(k);
            if (b?.byteLength) parts.push(b);
        }
        if (!parts.length) return null;
        if (parts.length === 1) {
            cacheMergedTile(addr, keys, parts[0]);
            return parts[0];
        }

        // Layer-merge, never byte-concat: the MVT parser indexes layers by name, so
        // the last duplicate `roads` silently wins and one pin's roads erase the other's.
        if (!mergedReads.has(addr)) {
            mergedReads.add(addr);
            noteMergedRead("roads");
        }
        const merged = mergeSameFrameTiles(
            parts.map((b) => new Uint8Array(b)),
        ).buffer;
        cacheMergedTile(addr, keys, merged);
        return merged;
    })();
    inFlightReads.set(addr, job);
    void job
        .catch(() => {})
        .then(() => {
            if (inFlightReads.get(addr) === job) inFlightReads.delete(addr);
        });
    return job;
}

function cacheMergedTile(
    addr: string,
    owners: string[],
    buf: ArrayBuffer,
): void {
    mergedTiles.set(addr, owners, buf);
}

export async function idbGetTile(key: string): Promise<ArrayBuffer | null> {
    // Never gate this read on the wipe latch: every read becomes a miss and the map silently draws nothing.
    if (!rawDb) {
        rawDb = await openDb();
        rawDb.onclose = () => {
            rawDb = null;
        };
    }
    const db = rawDb;
    return new Promise<ArrayBuffer | null>((resolve) => {
        let tx: IDBTransaction;
        try {
            tx = db.transaction(STORE, "readonly");
        } catch {
            rawDb = null;
            resolve(null);
            return;
        }
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => {
            const b = req.result as ArrayBuffer | undefined;
            resolve(b?.byteLength ? b : null);
        };
        req.onerror = () => resolve(null);
    });
}

export async function idbGetShallowTile(
    key: string,
): Promise<ArrayBuffer | null> {
    if (!rawDb) {
        rawDb = await openDb();
        rawDb.onclose = () => {
            rawDb = null;
        };
    }
    const db = rawDb;
    return new Promise<ArrayBuffer | null>((resolve) => {
        let tx: IDBTransaction;
        try {
            tx = db.transaction(STORE_SHALLOW, "readonly");
        } catch {
            rawDb = null;
            resolve(null);
            return;
        }
        const req = tx.objectStore(STORE_SHALLOW).get(key);
        req.onsuccess = () => {
            const b = req.result as ArrayBuffer | undefined;
            resolve(b?.byteLength ? b : null);
        };
        req.onerror = () => resolve(null);
    });
}

export async function getAllShallowTileKeys(): Promise<Set<string>> {
    if (shallowKeysCache) return shallowKeysCache;
    if (!shallowKeysLoad) {
        const epoch = shallowKeysEpoch;
        shallowKeysLoad = (async () => {
            const db = await openDb();
            const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
                const tx = db.transaction(STORE_SHALLOW, "readonly");
                const req = tx.objectStore(STORE_SHALLOW).getAllKeys();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            const loaded = new Set(keys.map(String));
            // A wipe that fired during the load must not resurrect a stale set.
            if (epoch === shallowKeysEpoch) shallowKeysCache = loaded;
            return loaded;
        })();
    }
    try {
        return await shallowKeysLoad;
    } finally {
        shallowKeysLoad = null;
    }
}

async function idbCount(): Promise<number> {
    const db = await openDb();
    const n = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    db.close();
    return n;
}

export async function hasV4Tiles(): Promise<boolean> {
    return (await idbCount()) > 0;
}

export async function purgeEmptyTiles(): Promise<number> {
    const db = await openDb();
    const removed = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        let n = 0;
        const cur = store.openCursor();
        cur.onsuccess = () => {
            const c = cur.result;
            if (!c) return;
            const v = c.value as ArrayBuffer | undefined;
            if (!v || v.byteLength === 0) {
                c.delete();
                n++;
            }
            c.continue();
        };
        tx.oncomplete = () => resolve(n);
        tx.onerror = () => reject(tx.error);
    });
    db.close();
    if (removed > 0) invalidateTileCaches();
    return removed;
}

// One-time: a recurring purge makes areas look un-fetched and feeds a purge → re-download loop.
const PURGE_FLAG = "rtV4EmptyTilesPurged";
export async function purgeEmptyTilesOnce(): Promise<void> {
    try {
        if (typeof localStorage === "undefined") return;
        if (localStorage.getItem(PURGE_FLAG)) return;
        const removed = await purgeEmptyTiles();
        localStorage.setItem(PURGE_FLAG, "1");
        if (removed > 0) {
            console.warn(
                `[v4] purged ${removed} zero-byte tiles left by the pre-guard pack Worker`,
            );
        }
    } catch (err) {
        // codestyle-allow-swallow: best-effort one-time sweep
        console.warn(
            "[v4] empty-tile purge failed (read-side skip still applies)",
            err,
        );
    }
}

export interface DownloadResult {
    downloaded: number;
    empty: number;
    total: number;
    bytes: number;
    build?: string;
    cache?: string;
    diag?: string;
}

/** [uint32 LE manifestLen][manifest JSON][tile bytes in manifest order]. */
interface PackManifest {
    total: number;
    empty: number;
    tiles: Array<{ k: string; n: number }>;
    /** The renderer must use this box, not the tile's: MVT coords are relative to it. */
    box?: { w: number; s: number; e: number; n: number };
}

export async function downloadV4Area(
    lng: number,
    lat: number,
    onProgress?: (done: number, total: number) => void,
    corridor = false,
): Promise<DownloadResult> {
    guardPackDownload({ lng, lat });
    const ringParam = corridor ? "&ring=corridor" : "";
    // The actual pin, never the cell centre: the Worker builds around whatever point it is given.
    const qLng = lng.toFixed(6);
    const qLat = lat.toFixed(6);
    const packEndpoint = packUrl();
    if (packEndpoint === null) {
        throw new Error(
            "[v4] no tiles host configured — call configureTilesHost(<origin>) at app boot before downloading a pack.",
        );
    }
    // Area-tagged so a background re-bake of an old pin cannot repaint the new pin's lights.
    const wk = `worker:${getWorkerTarget()}`;
    const area = satImageKey([lng, lat]);
    const lit = (state: "transit" | "ok" | "err", note = "") => {
        noteCircuit(wk, state, note, area);
        noteCircuit("pack", state, note, area);
    };
    lit("transit");
    let res: Response;
    try {
        res = await fetch(
            `${packEndpoint}?lng=${qLng}&lat=${qLat}&pv=${PACK_FORMAT_VERSION}${ringParam}`,
            // Must exceed the Worker's cold build (~66 s).
            { signal: AbortSignal.timeout(150_000) },
        );
    } catch (err) {
        lit("err", err instanceof Error ? err.message : String(err));
        throw err;
    }
    if (!res.ok) {
        // The body names the cause; statusText alone cannot be acted on.
        const body = (await res.text().catch(() => "")).slice(0, 200);
        lit("err", `${res.status} ${body || res.statusText}`);
        throw new Error(
            `[v4] pack fetch failed: ${res.status} ${res.statusText} — ${body}`,
        );
    }

    // gzip is application-layer, not Content-Encoding, so the edge cannot double-compress.
    if (!res.body) throw new Error("[v4] pack response has no body");
    const buf = new Uint8Array(
        await new Response(
            res.body.pipeThrough(new DecompressionStream("gzip")),
        ).arrayBuffer(),
    );
    if (buf.byteLength < 4) throw new Error("[v4] pack response too short");

    const manifestLen = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(
        0,
        true,
    );
    const manifest = JSON.parse(
        new TextDecoder().decode(buf.subarray(4, 4 + manifestLen)),
    ) as PackManifest;

    // .slice() copies; a subarray view would alias the whole pack into IndexedDB.
    const items: Array<[string, ArrayBuffer]> = [];
    let off = 4 + manifestLen;
    let bytes = 0;
    for (const t of manifest.tiles) {
        items.push([t.k, buf.slice(off, off + t.n).buffer]);
        off += t.n;
        bytes += t.n;
    }

    onProgress?.(0, items.length);
    await idbPutMany(items, (done) => onProgress?.(done, items.length));
    lit(
        "ok",
        `${items.length} tiles · ${(bytes / 1e6).toFixed(2)} MB · cache ${res.headers.get("x-pack-cache") ?? "?"}`,
    );

    return {
        downloaded: items.length,
        empty: manifest.empty,
        total: manifest.total,
        bytes,
        build: res.headers.get("x-pack-build") ?? "",
        cache: res.headers.get("x-pack-cache") ?? "",
        diag: res.headers.get("x-diag") ?? "",
    };
}

export interface V4LayerStat {
    layer: string;
    features: number;
    bytes: number;
}

export function shallowAreaTileKeys(lng: number, lat: number): string[] {
    return shallowCellsFor(lng, lat).map((c) => shallowTileKey(lng, lat, c));
}

export function areaTileKeys(lng: number, lat: number): string[] {
    // Keyed by the pin: a bare cell key serves one pin's roads to another.
    return cellsFor(lng, lat).map((c) => pinTileKey(lng, lat, c));
}

export interface GeoBox {
    w: number;
    s: number;
    e: number;
    n: number;
}

export interface V4TileIndex {
    byTile: Record<string, Record<string, { features: number; bytes: number }>>;
    /** The box the decoded geometry really covers, not what the key implies. */
    boxByTile: Record<string, GeoBox>;
    tiles: number;
}

export function metresBetween(
    aLng: number,
    aLat: number,
    bLng: number,
    bLat: number,
): number {
    const R = 6_371_008.8;
    const toRad = (d: number): number => (d * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const la1 = toRad(aLat);
    const la2 = toRad(bLat);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

export function boxOfTileKey(key: string): GeoBox | null {
    const [z, x, y] = key.split("/").map(Number);
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y))
        return null;
    const n = 2 ** z;
    const lng = (i: number): number => (i / n) * 360 - 180;
    const lat = (j: number): number => {
        const t = Math.PI - 2 * Math.PI * (j / n);
        return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t)));
    };
    return { w: lng(x), e: lng(x + 1), n: lat(y), s: lat(y + 1) };
}

/** `pin/<lng>,<lat>/z/x/y`, `shallow/<lng>,<lat>/z/x/y` or `z/x/y`; null, never NaN, for anything else. */
export function parseTileAddress(
    key: string,
): { z: number; x: number; y: number } | null {
    const parts = key.split("/");
    const tail =
        parts.length === 5 && (parts[0] === "pin" || parts[0] === "shallow")
            ? parts.slice(2)
            : parts;
    if (tail.length !== 3) return null;
    const [z, x, y] = tail.map(Number);
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y))
        return null;
    return { z, x, y };
}

export async function decodeV4TileLayerStats(): Promise<V4TileIndex> {
    const byTile: V4TileIndex["byTile"] = {};
    const boxByTile: V4TileIndex["boxByTile"] = {};
    let tiles = 0;
    for (const [key, bytes] of await idbEntries()) {
        const addr = parseTileAddress(key);
        if (!addr) continue;
        const { z, x, y } = addr;
        let vt: VectorTile;
        try {
            // pbf@4 lacks the PbfReader type vector-tile's d.ts imports.
            vt = new VectorTile(
                new Pbf(
                    new Uint8Array(bytes),
                ) as unknown as ConstructorParameters<typeof VectorTile>[0],
            );
        } catch {
            continue;
        }
        tiles++;
        const perLayer: Record<string, { features: number; bytes: number }> =
            {};
        let w = Infinity;
        let s2 = Infinity;
        let e = -Infinity;
        let n2 = -Infinity;
        const eat = (c: unknown): void => {
            if (!Array.isArray(c)) return;
            if (typeof c[0] === "number" && typeof c[1] === "number") {
                const [lo, la] = c as [number, number];
                if (!Number.isFinite(lo) || !Number.isFinite(la)) return;
                if (lo < w) w = lo;
                if (lo > e) e = lo;
                if (la < s2) s2 = la;
                if (la > n2) n2 = la;
                return;
            }
            for (const part of c) eat(part);
        };
        for (const name of Object.keys(vt.layers)) {
            const layer = vt.layers[name];
            const feats: GeoJSON.Feature[] = [];
            for (let i = 0; i < layer.length; i++) {
                const f = layer
                    .feature(i)
                    .toGeoJSON(x, y, z) as GeoJSON.Feature;
                feats.push(f);
                const g = f.geometry as { coordinates?: unknown } | null;
                if (g && "coordinates" in g) eat(g.coordinates);
            }
            perLayer[name] = {
                features: feats.length,
                bytes: JSON.stringify(feats).length,
            };
        }
        byTile[key] = perLayer;
        if (Number.isFinite(w) && Number.isFinite(s2))
            boxByTile[key] = { w, s: s2, e, n: n2 };
    }
    return { byTile, boxByTile, tiles };
}

/** Verifies tiles on disk, never a registry flag: eviction leaves the flag behind. */
export async function areaTilesPresent(
    lng: number,
    lat: number,
): Promise<boolean> {
    // Exact, not any-hit: a fuzzy probe stamps areas current while holding none of the new ring.
    const keys = areaTileKeys(lng, lat);
    if (!keys.length) return false;
    const db = await openDb();
    const present = await new Promise<boolean>((resolve) => {
        const tx = db.transaction(STORE, "readonly");
        const store = tx.objectStore(STORE);
        let pending = keys.length;
        let hits = 0;
        const tick = () => {
            if (--pending === 0) resolve(hits === keys.length);
        };
        for (const k of keys) {
            const req = store.getKey(k);
            req.onsuccess = () => {
                if (req.result !== undefined) hits++;
                tick();
            };
            req.onerror = () => tick();
        }
    });
    db.close();
    return present;
}

/** The live key-set cache; callers must not mutate it. */
export async function getAllTileKeys(): Promise<Set<string>> {
    if (allKeysCache) return allKeysCache;
    if (!allKeysLoad) {
        const epoch = allKeysEpoch;
        allKeysLoad = (async () => {
            const db = await openDb();
            const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
                const tx = db.transaction(STORE, "readonly");
                const req = tx.objectStore(STORE).getAllKeys();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            const loaded = new Set(keys.map(String));
            if (epoch === allKeysEpoch) allKeysCache = loaded;
            return loaded;
        })();
    }
    try {
        return await allKeysLoad;
    } finally {
        allKeysLoad = null;
    }
}

/** idbGetTileForAddress over `shallow/…` keys; serves `rtraw://shallow/{z}/{x}/{y}` at camera z6–z7. */
export async function idbGetShallowTileForAddress(
    z: number,
    x: number,
    y: number,
): Promise<ArrayBuffer | null> {
    const addr = `${z}/${x}/${y}`;
    const job =
        inFlightShallowReads.get(addr) ??
        computeShallowTileForAddress(z, x, y, addr);
    const buf = await job;
    return buf ? buf.slice(0) : null;
}

function computeShallowTileForAddress(
    z: number,
    x: number,
    y: number,
    addr: string,
): Promise<ArrayBuffer | null> {
    const job = (async () => {
        const keys = shallowKeysForAddress(
            await getAllShallowTileKeys(),
            z,
            x,
            y,
        );
        if (!keys.length) return null;
        const cached = shallowMerged.get(addr);
        if (
            cached &&
            cached.owners.length === keys.length &&
            cached.owners.every((k, i) => k === keys[i])
        ) {
            return cached.buf;
        }
        if (keys.length === 1) {
            const solo = await idbGetShallowTile(keys[0]);
            if (!solo) return null;
            cacheShallowTile(addr, keys, solo);
            return solo;
        }
        const parts: ArrayBuffer[] = [];
        for (const k of keys) {
            const b = await idbGetShallowTile(k);
            if (b?.byteLength) parts.push(b);
        }
        if (!parts.length) return null;
        if (parts.length === 1) {
            cacheShallowTile(addr, keys, parts[0]);
            return parts[0];
        }
        if (!mergedReads.has(`shallow:${addr}`)) {
            mergedReads.add(`shallow:${addr}`);
            noteMergedRead("roads/shallow");
        }
        const merged = mergeSameFrameTiles(
            parts.map((b) => new Uint8Array(b)),
        ).buffer;
        cacheShallowTile(addr, keys, merged);
        return merged;
    })();
    inFlightShallowReads.set(addr, job);
    void job
        .catch(() => {})
        .then(() => {
            if (inFlightShallowReads.get(addr) === job)
                inFlightShallowReads.delete(addr);
        });
    return job;
}

function cacheShallowTile(
    addr: string,
    owners: string[],
    buf: ArrayBuffer,
): void {
    shallowMerged.set(addr, owners, buf);
}

export function areaTilesPresentIn(
    stored: Set<string>,
    lng: number,
    lat: number,
): boolean {
    const keys = areaTileKeys(lng, lat);
    return keys.length > 0 && keys.every((k) => stored.has(k));
}

/** Must ask the same question as areaTilesPresent; a looser probe stamps areas current without the tiles. */
export async function areaCentreCovered(
    lng: number,
    lat: number,
): Promise<boolean> {
    return areaTilesPresent(lng, lat);
}

// rtwall:// and rtraw:// must be listed: a blocked "Tile" gets BLANK_PNG fed to the protobuf parser.
const LOCAL_PREFIXES = [
    "blob:",
    "data:",
    "capacitor://",
    "file://",
    "rtwall://",
    "rtraw://",
];
// A false negative substitutes BLANK_PNG, so loopback, proxies and capacitor must all pass.
const isSameOrigin = (url: string): boolean => {
    if (typeof location === "undefined") return false;
    if (url.startsWith(`${location.origin}/`)) return true;
    try {
        const u = new URL(url, location.href);
        if (u.host === location.host) return true;
        if (u.protocol === "capacitor:" || u.protocol === "ionic:") return true;
        return false;
    } catch {
        // codestyle-allow-swallow: unparseable URL is not same-origin
        return false;
    }
};
const BLANK_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const IMAGE_RESOURCES = new Set(["Image", "SpriteImage", "Tile"]);
let blockedLogged = 0;

/** A blocked non-image resource gets ""; a PNG handed to a parsed resource corrupts every render pass. */
export function v4TransformRequest(
    url: string,
    resourceType?: string,
): { url: string } {
    if (url.startsWith("/")) {
        // Mapbox's worker is a blob: URL, where a root-relative URL throws.
        return {
            url:
                typeof location === "undefined"
                    ? url
                    : new URL(url, location.href).href,
        };
    }
    if (LOCAL_PREFIXES.some((p) => url.startsWith(p)) || isSameOrigin(url)) {
        return { url };
    }
    if (blockedLogged < 8) {
        blockedLogged++;
        console.warn(
            `[v4] blocked non-local map request (${resourceType ?? "unknown"}): ${url}`,
        );
    }
    if (resourceType && IMAGE_RESOURCES.has(resourceType)) {
        return { url: BLANK_PNG };
    }
    return { url: "" };
}
