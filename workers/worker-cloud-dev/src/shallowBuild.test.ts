// A hand-encoded z13 source tile → buildPack → the pack's shallow/ tile decoded
// back. Synthetic tiles must speak the archive's vocabulary (highway,
// major_road, minor_road…): fictional kinds once kept CI green while the real
// tile shipped highways alone.

import { describe, expect, it } from "vitest";
import { readVarint, writeVarint } from "./mvtFilter";

function strBytes(s: string): number[] {
    return Array.from(new TextEncoder().encode(s));
}
function lenDelim(field: number, payload: number[]): number[] {
    const out = [(field << 3) | 2];
    writeVarint(out, payload.length);
    return out.concat(payload);
}
function valueStr(s: string): number[] {
    return lenDelim(1, strBytes(s));
}
const zz = (n: number) => (n << 1) ^ (n >> 31);
function vi(n: number): number[] {
    const out: number[] = [];
    writeVarint(out, n);
    return out;
}
/** 9 = MoveTo×1, 10 = LineTo×1. */
function lineGeom(): number[] {
    return [9].concat(
        vi(zz(1000)),
        vi(zz(1000)),
        [10],
        vi(zz(500)),
        vi(zz(500)),
    );
}
function pointGeom(): number[] {
    return [9].concat(vi(zz(2048)), vi(zz(2048)));
}
function feature(tags: number[], geom: number[], type = 2): number[] {
    const body = lenDelim(2, tags).concat(
        [(3 << 3) | 0, type],
        lenDelim(4, geom),
    );
    return lenDelim(2, body);
}
function layer(
    name: string,
    keys: string[],
    values: string[],
    feats: number[][],
): number[] {
    let body = lenDelim(1, strBytes(name));
    for (const f of feats) body = body.concat(f);
    for (const k of keys) body = body.concat(lenDelim(3, strBytes(k)));
    for (const v of values) body = body.concat(lenDelim(4, valueStr(v)));
    body.push((5 << 3) | 0);
    writeVarint(body, 4096);
    return lenDelim(3, body);
}
function tileOf(layers: number[][]): ArrayBuffer {
    let out: number[] = [];
    for (const l of layers) out = out.concat(l);
    return new Uint8Array(out).buffer;
}

// places: a town under kind_detail, the Protomaps v4 shape.
const SOURCE = tileOf([
    layer(
        "roads",
        ["kind"],
        ["highway", "major_road", "minor_road", "path", "service"],
        [
            feature([0, 0], lineGeom()),
            feature([0, 1], lineGeom()),
            feature([0, 2], lineGeom()),
            feature([0, 3], lineGeom()),
            feature([0, 4], lineGeom()),
        ],
    ),
    layer(
        "places",
        ["kind", "kind_detail"],
        ["locality", "town"],
        [feature([0, 0, 1, 1], pointGeom(), 1)],
    ),
]);

const archive = {
    getHeader: async () => ({}),
    getZxy: async () => ({ data: new Uint8Array(SOURCE) }),
} as never;

interface Manifest {
    tiles: Array<{ k: string; n: number }>;
}
function manifestOf(pack: ArrayBuffer): Manifest {
    const buf = new Uint8Array(pack);
    const len = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, true);
    return JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + len)));
}
function tileBytesOf(pack: ArrayBuffer, key: string): Uint8Array {
    const buf = new Uint8Array(pack);
    const m = manifestOf(pack);
    let off = 4 + new TextEncoder().encode(JSON.stringify(m)).length;
    for (const t of m.tiles) {
        if (t.k === key) return buf.subarray(off, off + t.n);
        off += t.n;
    }
    throw new Error(`no tile ${key}`);
}

function skipField(buf: Uint8Array, w: number, p: number): number {
    if (w === 0) {
        const [, q] = readVarint(buf, p);
        return q;
    }
    if (w === 2) {
        let n: number;
        [n, p] = readVarint(buf, p);
        return p + n;
    }
    throw new Error(`unsupported wire type ${w}`);
}

const LNG = -123.0694;
const LAT = 49.2606;

/** Every feature's `kind` in layer `want`, resolved through the layer's own tables. */
function layerKinds(tile: Uint8Array, want: string): string[] {
    const found: string[] = [];
    let p = 0;
    while (p < tile.length) {
        let tag: number;
        [tag, p] = readVarint(tile, p);
        const w = tag & 7;
        if (tag >>> 3 !== 3 || w !== 2) {
            p = skipField(tile, w, p);
            continue;
        }
        let len: number;
        [len, p] = readVarint(tile, p);
        const layer = tile.subarray(p, p + len);
        p += len;

        let name = "";
        const keys: string[] = [];
        const values: string[] = [];
        let q = 0;
        while (q < layer.length) {
            let ltag: number;
            [ltag, q] = readVarint(layer, q);
            const lf = ltag >>> 3;
            const lw = ltag & 7;
            if (lf !== 1 && lf !== 2 && lf !== 3 && lf !== 4) {
                q = skipField(layer, lw, q);
                continue;
            }
            let n: number;
            [n, q] = readVarint(layer, q);
            const field = layer.subarray(q, q + n);
            q += n;
            if (lf === 1) name = new TextDecoder().decode(field);
            else if (lf === 3) keys.push(new TextDecoder().decode(field));
            else if (lf === 4) {
                let r = 0;
                let s = "";
                while (r < field.length) {
                    let vtag: number;
                    [vtag, r] = readVarint(field, r);
                    if (vtag >>> 3 === 1 && (vtag & 7) === 2) {
                        let sn: number;
                        [sn, r] = readVarint(field, r);
                        s = new TextDecoder().decode(field.subarray(r, r + sn));
                        r += sn;
                    } else {
                        r = skipField(field, vtag & 7, r);
                    }
                }
                values.push(s);
            }
        }
        if (name !== want) continue;

        q = 0;
        while (q < layer.length) {
            let ltag: number;
            [ltag, q] = readVarint(layer, q);
            const lf = ltag >>> 3;
            const lw = ltag & 7;
            if (lf !== 2 || lw !== 2) {
                q = skipField(layer, lw, q);
                continue;
            }
            let n: number;
            [n, q] = readVarint(layer, q);
            const feat = layer.subarray(q, q + n);
            q += n;
            let r = 0;
            while (r < feat.length) {
                let ftag: number;
                [ftag, r] = readVarint(feat, r);
                const fw = ftag & 7;
                if (ftag >>> 3 === 2 && fw === 2) {
                    let tn: number;
                    [tn, r] = readVarint(feat, r);
                    const tags = feat.subarray(r, r + tn);
                    r += tn;
                    let t = 0;
                    while (t < tags.length) {
                        let ki: number;
                        let vi: number;
                        [ki, t] = readVarint(tags, t);
                        [vi, t] = readVarint(tags, t);
                        if (keys[ki] === "kind") found.push(values[vi]);
                    }
                } else {
                    r = skipField(feat, fw, r);
                }
            }
        }
    }
    return found;
}

describe("direction2.4 — the shallow z6 tile is BUILT from the disc reads", () => {
    it("shallow roads thin to highways + major roads — ARCHIVE vocabulary: highway/major_road ship, minor_road/path/service drop", async () => {
        const { buildPack } = await import("./packBuilder");
        const pack = await buildPack(archive, LNG, LAT);
        const m = manifestOf(pack);
        const shallowKey = m.tiles.find((t) => t.k.startsWith("shallow/"))!.k;
        const kinds = layerKinds(tileBytesOf(pack, shallowKey), "roads");
        expect(kinds).toContain("highway");
        expect(kinds).toContain("major_road");
        expect(kinds).not.toContain("minor_road");
        expect(kinds).not.toContain("path");
        expect(kinds).not.toContain("service");
    });

    it("the z8 pin tile still ships EVERY road kind — only the shallow tier thins", async () => {
        const { buildPack } = await import("./packBuilder");
        const pack = await buildPack(archive, LNG, LAT);
        const m = manifestOf(pack);
        const pinKey = m.tiles.find((t) => t.k.startsWith("pin/"))!.k;
        const kinds = layerKinds(tileBytesOf(pack, pinKey), "roads");
        for (const k of [
            "highway",
            "major_road",
            "minor_road",
            "path",
            "service",
        ])
            expect(kinds).toContain(k);
    });

    it("non-road rules ride along — a places town survives the z6 cut", async () => {
        const { buildPack } = await import("./packBuilder");
        const pack = await buildPack(archive, LNG, LAT);
        const m = manifestOf(pack);
        const shallowKey = m.tiles.find((t) => t.k.startsWith("shallow/"))!.k;
        // The fake archive returns the same tile for every read, so the z6 frame collects one copy per read.
        const kinds = layerKinds(tileBytesOf(pack, shallowKey), "places");
        expect(kinds.length).toBeGreaterThan(0);
        expect(kinds.every((k) => k === "locality")).toBe(true);
    });
});
