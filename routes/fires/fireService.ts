/**
 * The fire pass, app-wide. Hotspots go stale by the hour, tiles never do, so
 * the pass is its own thing: every centre the app hands over (each blob's)
 * gets a FIRE_RADIUS_KM fire disc from the tiles Worker, kept in the fire
 * cache the flame layer paints from. A FRESH disc within FIRE_TRIGGER_KM
 * already covers a centre; the cache's TTL says when it has gone stale. The
 * pass runs when the app says a centre landed, on coming back online or to
 * the front, and every TTL meanwhile. A dead feed pauses the pass for a
 * minute, never the map.
 *
 * The Worker's address comes from tilesHost.ts, configured by the app at boot
 * — this package names no host of its own.
 */

import { FIRE_RADIUS_KM } from "../../lib/shared/fireContract";
import { needsFireDisc } from "../../lib/shared/liveAnchor";
import { passQueue } from "../../lib/shared/passQueue";
import { fetchAreaFires } from "../../lib/worker/worker-local-dev/fires/fireFetch";
import {
	FIRE_TTL_MS,
	fireCoverage,
	isCoverageFresh,
	isFresh,
	readFireCache,
	writeFireCache,
} from "./fireCache";

export const FIRE_RETRY_MS = 60_000;

type LngLat = readonly [number, number];

const listeners = new Set<() => void>();

/** Fires landed in the cache — the flame layer repaints on this. */
export function onFires(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

/** The cache's own key shape for an area centre. */
export function fireKey(lng: number, lat: number): string {
	return `${lng.toFixed(4)},${lat.toFixed(4)}`;
}

let pausedUntil = 0;

/** Centres ride the queue as their cache keys — primitives, so a re-ask dedupes. */
const askQueue = passQueue<string>((keys) =>
	pass(keys.map((k) => k.split(",").map(Number) as unknown as LngLat)),
);

/** Fetch a fire disc for every centre that no fresh disc covers. Returns how many discs landed. One pass at a time; a centre asked for mid-pass gets the next one. */
export function refreshFires(centres: readonly LngLat[]): Promise<number> {
	return askQueue(centres.map(([lng, lat]) => fireKey(lng, lat)));
}

async function pass(centres: readonly LngLat[]): Promise<number> {
	if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
	if (Date.now() < pausedUntil) return 0;
	let landed = 0;
	for (const [lng, lat] of centres) {
		const key = fireKey(lng, lat);
		const prev = await readFireCache(key);
		if (prev && isFresh(prev)) continue;
		const fresh = (await fireCoverage())
			.filter((c) => isCoverageFresh(c))
			.map((c) => c.center);
		if (!needsFireDisc([lng, lat], fresh)) continue;
		try {
			const r = await fetchAreaFires(lng, lat);
			await writeFireCache(key, {
				fetchedAt: r.fetchedAt,
				center: [lng, lat],
				radiusKm: FIRE_RADIUS_KM,
				sourcesOk: r.sourcesOk,
				hotspots: [...r.hotspots],
			});
			landed++;
			console.info(
				`[fires] ${r.hotspots.length} hotspots within ${FIRE_RADIUS_KM} km of ${lat.toFixed(4)},${lng.toFixed(4)} (${(r.bytes / 1024).toFixed(1)} KB, ${r.sourcesOk}/3 satellites)`,
			);
			for (const fn of listeners) fn();
		} catch (error) {
			pausedUntil = Date.now() + FIRE_RETRY_MS;
			console.warn(
				`[fires] feed failed at ${lat.toFixed(4)},${lng.toFixed(4)} — pass paused ${FIRE_RETRY_MS / 1000}s, cached hotspots kept`,
				error,
			);
			break;
		}
	}
	return landed;
}

export interface FireServiceOptions {
	/** Every centre that wants a disc — read at every run. */
	centres: () => Promise<readonly LngLat[]> | readonly LngLat[];
	/** The app's own signal that a centre landed; call `refresh` with it (or with nothing for all), return the unsubscribe. */
	onCentresChanged?: (
		refresh: (centres?: readonly LngLat[]) => void,
	) => () => void;
}

let stop: (() => void) | null = null;

export function startFireService(opts: FireServiceOptions): () => void {
	if (stop)
		return () => {
			/* already running — the first start's stop owns shutdown */
		};
	const refresh = (centres?: readonly LngLat[]): void => {
		// Fired from timers, visibility and online events — there is no caller
		// to hand a rejection to, so `void` alone leaves an unhandled one when
		// the Worker is unreachable. Fires are best-effort: log and let the
		// next tick retry.
		(centres
			? refreshFires(centres)
			: Promise.resolve(opts.centres()).then(refreshFires)
		).catch((e) => {
			console.warn("[fires] refresh failed", e);
		});
	};
	const all = (): void => refresh();
	const visible = (): void => {
		if (document.visibilityState === "visible") all();
	};
	const offCentres = opts.onCentresChanged?.(refresh) ?? (() => undefined);
	window.addEventListener("online", all);
	document.addEventListener("visibilitychange", visible);
	const timer = setInterval(all, FIRE_TTL_MS);
	all();
	stop = () => {
		offCentres();
		window.removeEventListener("online", all);
		document.removeEventListener("visibilitychange", visible);
		clearInterval(timer);
		stop = null;
	};
	return stop;
}
