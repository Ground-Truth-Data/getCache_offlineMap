import type { PMTiles } from "pmtiles";
import { allowlistOf, filterMvtToLayers } from "./mvtFilter";
import { BLOB_DETAIL_LEVEL } from "./blob";
import { PACK_LAYER_NAMES, SHALLOW_LAYER_RULES } from "./packLayers";
import { boxFrame, buildBlobTile } from "./oneBlob";
import {
    GRID_RADIUS_KM,
    cellBox,
    cellsFor,
    pinTileKey,
    radiusBox,
    shallowCellsFor,
    shallowTileKey,
} from "./grid";

// Corridor packs (a LINE feature's route ribbon) ship roads only.
const ROADS_ONLY = new Set(["roads"]);
const PACK_KEEP: ReadonlySet<string> = new Set(PACK_LAYER_NAMES);

export function keepSet(corridor: boolean): ReadonlySet<string> {
    return corridor ? ROADS_ONLY : PACK_KEEP;
}

const SHALLOW_ALLOW = allowlistOf(SHALLOW_LAYER_RULES);

// R2 reads in flight: 8 gave a 56 s cold build, 100 blew the 128 MB Worker limit.
const PACK_POOL = 32;

function lngToTileX(lng: number, z: number): number {
    return Math.floor(((lng + 180) / 360) * 2 ** z);
}
function latToTileY(lat: number, z: number): number {
    const r = (lat * Math.PI) / 180;
    return Math.floor(
        ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
    );
}

export interface DiscTile {
    z: number;
    x: number;
    y: number;
}

/** Every source tile overlapping `box` at zoom `z`. */
export function tilesForBox(
    box: { w: number; s: number; e: number; n: number },
    z: number,
): DiscTile[] {
    const out: DiscTile[] = [];
    const max = 2 ** z - 1;
    const x0 = Math.max(0, lngToTileX(box.w, z));
    const x1 = Math.min(max, lngToTileX(box.e, z));
    const y0 = Math.max(0, latToTileY(box.n, z));
    const y1 = Math.min(max, latToTileY(box.s, z));
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) out.push({ z, x, y });
    }
    return out;
}

interface PackedTile {
    k: string;
    data: ArrayBuffer;
}

async function readDisc(
    archive: PMTiles,
    disc: DiscTile[],
    corridor: boolean,
): Promise<{ tiles: PackedTile[]; empty: number; failed: number }> {
    const results: Array<PackedTile | null> = new Array(disc.length).fill(null);
    let failed = 0;
    let next = 0;
    const keep = keepSet(corridor);
    async function worker(): Promise<void> {
        while (next < disc.length) {
            const i = next++;
            const { z, x, y } = disc[i];
            try {
                const t = await archive.getZxy(z, x, y);
                if (t?.data?.byteLength) {
                    // A 0-byte tile must never ship: the phone persists it and Mapbox
                    // throws "Unimplemented type: 4" on every render pass.
                    const data = filterMvtToLayers(t.data, keep);
                    if (data.byteLength > 0)
                        results[i] = { k: `${z}/${x}/${y}`, data };
                }
            } catch {
                // Distinct from a void tile: counted so the caller retries on a warm directory.
                failed++;
            }
        }
    }
    await Promise.all(Array.from({ length: PACK_POOL }, () => worker()));
    let empty = 0;
    const tiles: PackedTile[] = [];
    for (const r of results) {
        if (r) tiles.push(r);
        else empty++;
    }
    return { tiles, empty, failed };
}

/** Wire format the phone unpacks:
 *    [uint32 LE manifestByteLen][manifest JSON utf8][tile bytes, concatenated]
 *  `box` must travel with the pack: MVT coordinates are relative to it, and a
 *  renderer assuming the tile's own box lands the data 89 km off. */
function serializePack(
    packed: PackedTile[],
    totalDisc: number,
    empty: number,
    box?: { w: number; s: number; e: number; n: number },
): ArrayBuffer {
    // One filtered list drives both manifest and body so an n:0 entry cannot appear.
    const kept = packed.filter((t) => t.data.byteLength > 0);
    const tiles: Array<{ k: string; n: number }> = [];
    let bodyBytes = 0;
    for (const t of kept) {
        tiles.push({ k: t.k, n: t.data.byteLength });
        bodyBytes += t.data.byteLength;
    }
    const manifestBytes = new TextEncoder().encode(
        JSON.stringify({ total: totalDisc, empty, tiles, box }),
    );
    const out = new Uint8Array(4 + manifestBytes.byteLength + bodyBytes);
    new DataView(out.buffer).setUint32(0, manifestBytes.byteLength, true);
    out.set(manifestBytes, 4);
    let off = 4 + manifestBytes.byteLength;
    for (const t of kept) {
        out.set(new Uint8Array(t.data), off);
        off += t.data.byteLength;
    }
    return out.buffer;
}

/** Build one pin's pack: read the source tiles overlapping its radius, cut one
 *  blob per grid cell, serialise. `diag` is filled for the X-Diag header. */
export async function buildPack(
    archive: PMTiles,
    lng: number,
    lat: number,
    corridor = false,
    diag?: Record<string, number>,
): Promise<ArrayBuffer> {
    const box = radiusBox(lng, lat);
    const union = tilesForBox(box, BLOB_DETAIL_LEVEL);

    let read = await readDisc(archive, union, corridor);
    // The first build of an area can hit a PMTiles directory race; one retry on the warm directory.
    if (read.failed > 0) read = await readDisc(archive, union, corridor);

    // Each cell is framed to its OWN box; framing to the pin's box draws it in the wrong place.
    const cells = cellsFor(lng, lat);
    const out: PackedTile[] = [];
    let features = 0;
    let emptyCells = 0;
    for (const c of cells) {
        const blob = buildBlobTile(
            read.tiles.map((t) => {
                const [z, x, y] = t.k.split("/").map(Number);
                return { tile: { z, x, y }, data: new Uint8Array(t.data) };
            }),
            boxFrame(cellBox(c)),
        );
        features += blob.features;
        if (blob.bytes.byteLength > 0) {
            // Keyed by the pin, never the cell: a cell key is shared by neighbouring
            // pins, so one pin's roads would answer another's lookup 50 km away.
            out.push({
                k: pinTileKey(lng, lat, c),
                data: blob.bytes.buffer as ArrayBuffer,
            });
        } else {
            emptyCells++;
        }
    }

    // Shallow tier: one z6 tile per pin, cut from the same z13 reads with roads
    // thinned, so roads survive camera z6–z7 where z8 blobs are silent (MapLibre
    // overzooms up, never down). Its own `shallow/` namespace: a z6 under `pin/`
    // would be served mis-framed to z8 requests by the main lookup's containment.
    const shallowCells = shallowCellsFor(lng, lat);
    let shallowEmpty = 0;
    let shallowFeatures = 0;
    for (const c of shallowCells) {
        const blob = buildBlobTile(
            read.tiles.map((t) => {
                const [z, x, y] = t.k.split("/").map(Number);
                return {
                    tile: { z, x, y },
                    data: new Uint8Array(
                        filterMvtToLayers(
                            t.data,
                            keepSet(corridor),
                            SHALLOW_ALLOW,
                        ),
                    ),
                };
            }),
            boxFrame(cellBox(c)),
        );
        shallowFeatures += blob.features;
        if (blob.bytes.byteLength > 0) {
            out.push({
                k: shallowTileKey(lng, lat, c),
                data: blob.bytes.buffer as ArrayBuffer,
            });
        } else {
            shallowEmpty++;
        }
    }

    if (diag) {
        diag.discTiles = union.length;
        diag.outerKm = GRID_RADIUS_KM;
        diag.blobFeatures = features;
        diag.blobBytes = out.reduce((n, t) => n + t.data.byteLength, 0);
        diag.cells = cells.length;
        const shallowOut = out.filter((t) => t.k.startsWith("shallow/"));
        diag.shallowTiles = shallowOut.length;
        diag.shallowBytes = shallowOut.reduce(
            (n, t) => n + t.data.byteLength,
            0,
        );
        diag.shallowFeatures = shallowFeatures;
    }

    return serializePack(out, union.length, emptyCells + shallowEmpty, box);
}
