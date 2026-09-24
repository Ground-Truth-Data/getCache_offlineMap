/**
 * `v10://planet/{z}/{x}/{y}`: MapLibre reads the tile store. A miss is a 404; with read-through
 * on it goes to the Worker instead, off by default so airplane mode is what you are testing.
 * A tile above the cut is clipped on the way out to the blobs it belongs to; the raw tile
 * stays on disk because two blobs can share it and each wants a different cut.
 */

import maplibregl from "maplibre-gl";
import { tileUrl } from "../../lib/worker/worker-local-dev/tilesHost";
import { clipTile, type Rect } from "./clip";
import { getTile, regionsSnapshot } from "./store";
import { ANCHOR_Z, rangeBox, rangeContains, toMerc } from "./tiles";

export const SCHEME = "v10";
export const PLANET_TILES = `${SCHEME}://planet/{z}/{x}/{y}`;

const RE = /^v10:\/\/planet\/(\d+)\/(\d+)\/(\d+)/;

export interface ReadCounts {
	hit: number;
	miss: number;
	net: number;
}

const counts: ReadCounts = { hit: 0, miss: 0, net: 0 };
let readThrough = false;

export function setReadThrough(on: boolean): void {
	readThrough = on;
}

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

let installed = false;

export function installProtocol(): void {
	if (installed) return;
	installed = true;
	maplibregl.addProtocol(SCHEME, async (params, abort) => {
		if (abort.signal.aborted)
			throw Object.assign(new Error("aborted"), { name: "AbortError" });
		const m = RE.exec(params.url);
		if (!m) throw notFound(params.url);
		const key = `${m[1]}/${m[2]}/${m[3]}`;
		const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
		const buf = await getTile(key);
		if (buf && buf.byteLength > 0) {
			const data = z < ANCHOR_Z ? await clippedTile(key, z, x, y, buf) : buf;
			if (data) {
				counts.hit++;
				return { data };
			}
		}
		const url = readThrough && navigator.onLine ? tileUrl(z, x, y) : null;
		if (url !== null) {
			const res = await fetch(url, { signal: abort.signal });
			if (res.status === 200) {
				counts.net++;
				return { data: await res.arrayBuffer() };
			}
		}
		counts.miss++;
		throw notFound(params.url);
	});
}
