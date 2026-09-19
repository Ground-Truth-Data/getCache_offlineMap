/**
 * The fire pass, app-wide. Hotspots go stale by the hour, tiles never do, so
 * the pass is its own thing: every centre the app hands over (each blob's)
 * gets a FIRE_RADIUS_KM fire disc from the tiles Worker, kept in the fire
 * cache the flame layer paints from. A FRESH disc within FIRE_TRIGGER_KM
 * already covers a centre; the cache's TTL says when it has gone stale. The
 * pass runs when the app says a centre landed, on coming back online, and on
 * coming back to the front — never on a clock, so a backgrounded app costs
 * nothing. A dead feed pauses the pass for a minute, never the map.
 *
 * The Worker's address comes from tilesHost.ts, configured by the app at boot
 * — this package names no host of its own.
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
    /** Decompressed JSON; the download is ~1/13th of it. See fireFetch.ts. */
    jsonKB: number;
    satellites: string;
}

/**
 * ONE line per pass, not per disc. Every disc printing its own line made a
 * quiet pass indistinguishable from a runaway one — the thirty-three-line
 * burst that exposed the duplicate-disc bug read exactly like normal traffic.
 * The per-disc detail stays, one fold down, for when a pass looks wrong.
 */
function reportPass(fetched: readonly FireFetchLog[]): void {
    if (fetched.length === 0) return;
    const hotspots = fetched.reduce((n, f) => n + f.hotspots, 0);
    // Says "uncompressed" because that is all this side can honestly measure —
    // the response is gzipped and a streamed one carries no Content-Length, so
    // the download is roughly a thirteenth of the number printed. Naming it
    // stops the figure being read as the cost.
    const kb = fetched.reduce((n, f) => n + f.jsonKB, 0);
    const degraded = fetched.filter((f) => f.satellites !== "3/3").length;
    console.groupCollapsed(
        `[fires] ${fetched.length} disc${fetched.length === 1 ? "" : "s"}, ${hotspots.toLocaleString()} hotspots, ${kb.toFixed(1)} KB uncompressed (~${(kb / 13).toFixed(0)} KB downloaded), ${FIRE_RADIUS_KM} km each${degraded > 0 ? ` — ${degraded} on partial satellite coverage` : ""}`,
    );
    console.table(fetched);
    console.groupEnd();
}

export interface FireServiceOptions {
    /** Every centre that wants a disc — read at every run. */
    centres: () => Promise<readonly LngLat[]> | readonly LngLat[];
    /** Where the user has a stake — live fix, pin anchors. Ground far from these earns no fire disc. Omitted → every centre is fetched, as before. */
    here?: () => readonly LngLat[];
    /** The app's own signal that a centre landed; call `refresh` with it (or with nothing for all), return the unsubscribe. */
    onCentresChanged?: (
        refresh: (centres?: readonly LngLat[]) => void,
    ) => () => void;
}

let stop: (() => void) | null = null;
/** Where the user actually is. Unset (or empty) means unknown — every centre then passes, see fireCentresWorthFetching. */
let here: (() => readonly LngLat[]) | null = null;

export function startFireService(opts: FireServiceOptions): () => void {
    if (stop)
        return () => {
            /* already running — the first start's stop owns shutdown */
        };
    here = opts.here ?? null;
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
    // ⛔ NO TIMER. The pass runs when the user LOOKS, never on a clock: a
    // backgrounded app is the normal state of a phone app — people switch
    // away, they do not quit — and an interval there downloads all day for
    // nobody. A left-open week cost ~40 MB against ~1 MB for the same use.
    //
    // Nothing is lost: coming back to the app fires `visible`, and the cache's
    // TTL decides whether that look actually fetches, so a user checking ten
    // times an hour still downloads once.
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
