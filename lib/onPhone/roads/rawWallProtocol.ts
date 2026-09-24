/**
 * Serve downloaded tiles to MapLibre with no decode. A zoom band that is
 * stored but unserved renders a silent blank map, not an error.
 */

import maplibregl from "maplibre-gl";

import { vlog } from "../../shared/verboseLog";

import { BLOB_MAX_Z, BLOB_MIN_Z } from "../../contract/roadBlob";
import { SHALLOW_Z } from "../../contract/grid";

import {
	idbGetShallowTileForAddress,
	idbGetTileForAddress,
} from "../../worker/worker-local-dev/roads/packDownload";

/** One disc, one source, every zoom; per-band sources let tiles fall between them. */
export const RAW_SOURCE = "v4-raw";
export const RAW_SCHEME = "rtraw";

export const RAW_TILE_URL = `${RAW_SCHEME}://disc/{z}/{x}/{y}`;

/** The shallow z6 tier: its own host, store and source, never merged into the disc's namespace. */
export const SHALLOW_SOURCE = "v4-raw-shallow";
export const SHALLOW_TILE_URL = `${RAW_SCHEME}://shallow/{z}/{x}/{y}`;

/** The floor equals the shallowest stored level; a z8 tile served at a z6 address paints 4x off-place. */
export const RAW_MIN_Z = BLOB_MIN_Z;
export const RAW_MAX_Z = BLOB_MAX_Z;

let installed = false;

/** Registers the raw-tile protocol: one IndexedDB read per request, bytes returned untouched. */
export function installRawWallProtocol(): void {
	if (installed) return;
	installed = true;

	maplibregl.addProtocol(RAW_SCHEME, async (params, abortController) => {
		// Resolving an aborted request leaves the promise pending forever.
		if (abortController.signal.aborted) {
			throw Object.assign(new Error("aborted"), { name: "AbortError" });
		}

		// `rtraw://disc/15/5245/11454`: the host names the tier.
		const m = /^rtraw:\/\/([a-z]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
		if (!m) throw notFound(params.url);

		const [, tier, z, x, y] = m;
		// Every owning pin, layer-merged into one tile: roads are keyed by pin,
		// and byte-concat keeps only the last same-named layer.
		const buf =
			tier === "shallow"
				? await idbGetShallowTileForAddress(Number(z), Number(x), Number(y))
				: await idbGetTileForAddress(Number(z), Number(x), Number(y));
		noteTileRead(!!buf && buf.byteLength > 0);
		if (!buf || buf.byteLength === 0) throw notFound(params.url);

		// The buffer is transferred to MapLibre's worker and detached.
		return { data: buf.slice(0) };
	});
}

// Tile-read tally that speaks only when the reading flips and the flip holds
// for SETTLE_MS, or panning across a jagged disc edge alternates warnings.
let hits = 0;
let misses = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** Seeded `false`, not null, or the first burst prints as a recovery. */
let lastBlind: boolean | null = false;
let onBlind: (() => void) | undefined;

/** Register the recovery to run when a blind reading is confirmed. */
export function setRawWallBlindHandler(fn: () => void): void {
	onBlind = fn;
}
let pendingBlind: boolean | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const SETTLE_MS = 2500;
function noteTileRead(found: boolean): void {
	if (found) hits++;
	else misses++;
	if (flushTimer) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		const read = hits + misses;
		const blind = hits === 0;
		vlog("wall", `read ${read} tiles — ${hits} found, ${misses} not on disk`);
		if (blind === lastBlind) {
			if (settleTimer) clearTimeout(settleTimer);
			settleTimer = null;
			pendingBlind = null;
		} else if (blind !== pendingBlind) {
			if (settleTimer) clearTimeout(settleTimer);
			pendingBlind = blind;
			settleTimer = setTimeout(() => {
				settleTimer = null;
				lastBlind = blind;
				pendingBlind = null;
				if (blind) {
					// console.warn: DevTools' default filter hides info-level output.
					console.warn(
						`[roads] ⚠️ map is reading NOTHING from disk (${read} tiles asked, 0 found) — nothing will draw`,
					);
					// MapLibre never retries a cached 404 on its own.
					onBlind?.();
				}
				else console.warn(`[roads] ✅ reading tiles from disk again`);
			}, SETTLE_MS);
		}
		hits = 0;
		misses = 0;
	}, 700);
}

function notFound(url: string): Error {
	// A 404-shaped rejection renders nothing, silently: right for a sparse pyramid.
	return Object.assign(new Error(`no tile: ${url}`), { status: 404 });
}

/** The span must match the stored levels exactly: wider 404s, narrower hides tiles that exist. */
export function rawSourceSpec(): maplibregl.VectorSourceSpecification {
	return {
		type: "vector",
		tiles: [RAW_TILE_URL],
		// Source min/maxzoom describe the pyramid, not the camera; minzoom 0
		// means z0 addresses get requested and 404.
		minzoom: RAW_MIN_Z,
		maxzoom: RAW_MAX_Z,
	};
}

/** Same law as the disc: the span equals the stored level; z7 overzooms. */
export function shallowSourceSpec(): maplibregl.VectorSourceSpecification {
	return {
		type: "vector",
		tiles: [SHALLOW_TILE_URL],
		minzoom: SHALLOW_Z,
		maxzoom: SHALLOW_Z,
	};
}

/**
 * MapLibre caches a 404 from before the download landed. `setTiles` with the
 * same URL only invalidates the tile cache; re-adding the source would drop
 * the per-pin satellite layers. Both tiers go stale together.
 */
export function refreshRawTiles(map: maplibregl.Map): void {
	for (const [id, url] of [
		[RAW_SOURCE, RAW_TILE_URL],
		[SHALLOW_SOURCE, SHALLOW_TILE_URL],
	] as const) {
		const src = map.getSource(id);
		if (!src || typeof (src as maplibregl.VectorTileSource).setTiles !== "function") {
			vlog("wall", `refresh skipped — ${id} not mounted yet`);
			continue;
		}
		vlog("wall", `new tiles on disk → telling ${id} to re-request`);
		(src as maplibregl.VectorTileSource).setTiles([url]);
	}
}
