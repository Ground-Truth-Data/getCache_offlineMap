/**
 * `v10://planet/{z}/{x}/{y}`: MapLibre reads the tile store; a miss is a 404 — airplane mode
 * is what you are testing. A tile above the cut is clipped on the way out to the blobs it
 * belongs to; the raw tile stays on disk because two blobs can share it and each wants a
 * different cut.
 */

import * as maplibregl from "maplibre-gl";
import { highwayTile } from "../../lib/route/highways";
import { clipTile, type Rect } from "./clip";
import { getTile, PHOTO_PREFIX, photoTilesWithin, regionsSnapshot } from "./store";
import { sourceOf } from "../../lib/contract/satelliteSources";
import { ANCHOR_Z, rangeBox, rangeContains, toMerc } from "./tiles";

export const SCHEME = "v10";
export const PLANET_TILES = `${SCHEME}://planet/{z}/{x}/{y}`;
/** A held area's satellite tiles, served raw at the source's zoom and shrunk from those below it; `{source}` is the source's id. */
export const PHOTO_TILES = `${SCHEME}://photo/{source}/{z}/{x}/{y}`;
/** The world's highways file, drawn under the blobs. */
export const HIGHWAY_TILES = `${SCHEME}://highways/{z}/{x}/{y}`;

const RE = /^v10:\/\/(planet|photo\/\w+|highways)\/(\d+)\/(\d+)\/(\d+)/;

export interface ReadCounts {
	hit: number;
	miss: number;
	net: number;
}

const counts: ReadCounts = { hit: 0, miss: 0, net: 0 };

export function readCounts(): ReadCounts {
	return { ...counts };
}

export function resetReadCounts(): void {
	counts.hit = counts.miss = counts.net = 0;
}

function notFound(url: string): Error {
	return Object.assign(new Error(`no tile: ${url}`), { status: 404 });
}

/** The borders of the blobs this tile is part of, as fractions of the tile. */
async function bordersIn(
	z: number,
	x: number,
	y: number,
): Promise<{ version: number; rects: Rect[] }> {
	const { version, regions } = regionsSnapshot();
	const n = 2 ** z;
	const rects: Rect[] = [];
	for (const r of await regions) {
		if (!rangeContains(r.range, { z, x, y })) continue;
		const b = rangeBox(r.range);
		const [w, nn] = toMerc(b.w, b.n);
		const [e, ss] = toMerc(b.e, b.s);
		rects.push({
			x0: w * n - x,
			y0: nn * n - y,
			x1: e * n - x,
			y1: ss * n - y,
		});
	}
	return { version, rects };
}

const clipped = new Map<string, { version: number; data: ArrayBuffer }>();

// MapLibre transfers the returned buffer to its worker, which detaches it, so every handout is a copy.
async function clippedTile(
	key: string,
	z: number,
	x: number,
	y: number,
	raw: ArrayBuffer,
): Promise<ArrayBuffer | null> {
	const { version, rects } = await bordersIn(z, x, y);
	const hit = clipped.get(key);
	if (hit && hit.version === version) return hit.data.slice(0);
	if (!rects.length) return null;
	const data = clipTile(new Uint8Array(raw), rects).buffer as ArrayBuffer;
	clipped.set(key, { version, data });
	return data.slice(0);
}

const SHRUNK_PX = 256;

/** A photo tile below its source's zoom, built only from the held `top` tiles under it, transparent where none is held:
 * nothing below `top` is ever fetched, and the patch keeps one shape at every zoom. */
export async function shrunkPhoto(source: string, top: number, z: number, x: number, y: number): Promise<ArrayBuffer | null> {
	const k = 2 ** (top - z);
	const held = await photoTilesWithin(source, top, [x * k, x * k + k - 1], [y * k, y * k + k - 1]);
	const real = [...held].filter(([, b]) => b.byteLength);
	if (!real.length) return null;
	const cell = SHRUNK_PX / k;
	const canvas = new OffscreenCanvas(SHRUNK_PX, SHRUNK_PX);
	const g = canvas.getContext("2d")!;
	for (const [key, buf] of real) {
		const [, cx, cy] = key.split("/").map(Number);
		g.drawImage(await createImageBitmap(new Blob([buf])), (cx! - x * k) * cell, (cy! - y * k) * cell, cell, cell);
	}
	return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

let installed = false;

export function installProtocol(): void {
	if (installed) return;
	installed = true;
	maplibregl.addProtocol(SCHEME, async (params, abort) => {
		if (abort.signal.aborted)
			throw Object.assign(new Error("aborted"), { name: "AbortError" });
		const m = RE.exec(params.url);
		if (!m) throw notFound(params.url);
		if (m[1] === "highways")
			return { data: (await highwayTile(Number(m[2]), Number(m[3]), Number(m[4]))) ?? new ArrayBuffer(0) };
		const photo = m[1] !== "planet";
		const key = `${m[2]}/${m[3]}/${m[4]}`;
		const [z, x, y] = [Number(m[2]), Number(m[3]), Number(m[4])];
		const top = photo ? sourceOf(m[1].slice(6))?.zoom : undefined;
		if (top !== undefined && z < top) {
			const data = await shrunkPhoto(m[1].slice(6), top, z, x, y);
			counts[data ? "hit" : "miss"]++;
			if (data) return { data };
			throw notFound(params.url);
		}
		const buf = await getTile(photo ? `${PHOTO_PREFIX}${m[1].slice(6)}/${key}` : key);
		if (buf && buf.byteLength > 0) {
			const data = !photo && z < ANCHOR_Z ? await clippedTile(key, z, x, y, buf) : buf;
			if (data) {
				counts.hit++;
				return { data };
			}
		}
		counts.miss++;
		throw notFound(params.url);
	});
}
