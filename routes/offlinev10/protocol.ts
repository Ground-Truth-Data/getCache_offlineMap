/**
 * `v10://planet/{z}/{x}/{y}`: MapLibre reads the tile store; a miss is a 404 — airplane mode
 * is what you are testing. Every tile is served whole, a parent included: zoomed out, the
 * saved map widens tile by tile into a pyramid instead of stopping at the blob's border.
 */

import * as maplibregl from "maplibre-gl";
import { getTile, PHOTO_PREFIX } from "./store";

export const SCHEME = "v10";
export const PLANET_TILES = `${SCHEME}://planet/{z}/{x}/{y}`;
/** The satellite photo's own source tiles, served raw. */
export const PHOTO_TILES = `${SCHEME}://photo/{z}/{x}/{y}`;

const RE = /^v10:\/\/(planet|photo)\/(\d+)\/(\d+)\/(\d+)/;

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

let installed = false;

export function installProtocol(): void {
	if (installed) return;
	installed = true;
	maplibregl.addProtocol(SCHEME, async (params, abort) => {
		if (abort.signal.aborted)
			throw Object.assign(new Error("aborted"), { name: "AbortError" });
		const m = RE.exec(params.url);
		if (!m) throw notFound(params.url);
		const photo = m[1] === "photo";
		const key = `${m[2]}/${m[3]}/${m[4]}`;
		const data = await getTile(photo ? PHOTO_PREFIX + key : key);
		if (data && data.byteLength > 0) {
			counts.hit++;
			return { data };
		}
		counts.miss++;
		throw notFound(params.url);
	});
}
