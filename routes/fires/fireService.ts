/**
 * The fire pass, app-wide: every centre the app hands over gets a fire disc from the tiles Worker.
 * Runs when a centre lands, on coming back online and on coming to the front, never on a clock.
 * A dead feed pauses the pass for a minute, never the map.
 */

import { FIRE_RADIUS_KM } from "../../lib/shared/fireContract";
import {
    fireCentresWorthFetching,
    fireDiscCentres,
    needsFireDisc,
} from "../../lib/shared/liveAnchor";
import { passQueue } from "../../lib/shared/passQueue";
import { fetchAreaFires } from "../../lib/worker/worker-local-dev/fires/fireFetch";
import {
    fireCoverage,
    isCoverageFresh,
    isFresh,
    readFireCache,
    writeFireCache,
} from "./fireCache";

export const FIRE_RETRY_MS = 60_000;

type LngLat = readonly [number, number];

const listeners = new Set<() => void>();

export function onFires(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

export function fireKey(lng: number, lat: number): string {
    return `${lng.toFixed(4)},${lat.toFixed(4)}`;
}

let pausedUntil = 0;

// Centres ride the queue as their cache keys: primitives, so a re-ask dedupes.
const askQueue = passQueue<string>((keys) =>
    pass(keys.map((k) => k.split(",").map(Number) as unknown as LngLat)),
);

/** Fetch a fire disc for every centre no fresh disc covers; returns how many landed. */
export function refreshFires(centres: readonly LngLat[]): Promise<number> {
    return askQueue(centres.map(([lng, lat]) => fireKey(lng, lat)));
}

async function pass(centres: readonly LngLat[]): Promise<number> {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
        return 0;
    if (Date.now() < pausedUntil) return 0;
    let landed = 0;
    const fetched: FireFetchLog[] = [];
    for (const [lng, lat] of fireDiscCentres(
        fireCentresWorthFetching(centres, here?.() ?? []),
    )) {
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
            fetched.push({
                at: `${lat.toFixed(4)},${lng.toFixed(4)}`,
                hotspots: r.hotspots.length,
                jsonKB: Number((r.bytes / 1024).toFixed(1)),
                satellites: `${r.sourcesOk}/3`,
            });
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
    reportPass(fetched);
    return landed;
}

interface FireFetchLog {
    at: string;
    hotspots: number;
    /** decompressed; the download is ~1/13th of it */
    jsonKB: number;
    satellites: string;
}

/** One line per pass, so a quiet pass and a runaway one look different. */
function reportPass(fetched: readonly FireFetchLog[]): void {
    if (fetched.length === 0) return;
    const hotspots = fetched.reduce((n, f) => n + f.hotspots, 0);
    // A streamed gzip response carries no Content-Length, so uncompressed is all this side can measure.
    const kb = fetched.reduce((n, f) => n + f.jsonKB, 0);
    const degraded = fetched.filter((f) => f.satellites !== "3/3").length;
    console.groupCollapsed(
        `[fires] ${fetched.length} disc${fetched.length === 1 ? "" : "s"}, ${hotspots.toLocaleString()} hotspots, ${kb.toFixed(1)} KB uncompressed (~${(kb / 13).toFixed(0)} KB downloaded), ${FIRE_RADIUS_KM} km each${degraded > 0 ? ` — ${degraded} on partial satellite coverage` : ""}`,
    );
    console.table(fetched);
    console.groupEnd();
}

export interface FireServiceOptions {
    /** every centre that wants a disc, read at every run */
    centres: () => Promise<readonly LngLat[]> | readonly LngLat[];
    /** where the user has a stake; ground far from these earns no disc. Omitted → every centre is fetched */
    here?: () => readonly LngLat[];
    /** the app's signal that a centre landed; call `refresh` with it (or nothing for all), return the unsubscribe */
    onCentresChanged?: (
        refresh: (centres?: readonly LngLat[]) => void,
    ) => () => void;
}

let stop: (() => void) | null = null;
let here: (() => readonly LngLat[]) | null = null;

export function startFireService(opts: FireServiceOptions): () => void {
    if (stop)
        return () => {
            /* the first start's stop owns shutdown */
        };
    here = opts.here ?? null;
    const refresh = (centres?: readonly LngLat[]): void => {
        // Fired from events with no caller to hand a rejection to.
        (centres
            ? refreshFires(centres)
            : Promise.resolve(opts.centres()).then(refreshFires)
        ).catch((e) => {
            console.warn("[fires] refresh failed", e);
        });
    };
    const all = (): void => refresh();
    // No timer: a backgrounded app is a phone's normal state, and an interval there downloads all day for nobody.
    const visible = (): void => {
        if (document.visibilityState === "visible") all();
    };
    const offCentres = opts.onCentresChanged?.(refresh) ?? (() => undefined);
    window.addEventListener("online", all);
    document.addEventListener("visibilitychange", visible);
    all();
    stop = () => {
        offCentres();
        window.removeEventListener("online", all);
        document.removeEventListener("visibilitychange", visible);
        here = null;
        stop = null;
    };
    return stop;
}
