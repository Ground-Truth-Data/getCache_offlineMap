/** Bakes, downloads and evicts every feature's blob app-wide; the viewer only views, never bakes. */

import { isDownloadGuardTripped } from "../store/downloadGuard";

import { FIRE_REFRESH_ENABLED } from "../../shared/bakeFlags";
import { registerWipeStopper } from "../store/wipe";
import {
    allCoverage,
    backfillCoverageMirror,
    type CoverageRecord,
    dropCoverage,
    EST_AREA_BYTES,
    noteCoverage,
    OFFLINE_BUDGET_BYTES,
} from "../store/coverageRegistry";
import {
    deleteVectorAt,
    getVectorFeaturesAt,
    getVectorKeys,
} from "../store/tombstones/legacyVectorCleanup";
import {
    BAKE_RADIUS_KM,
    BAKE_VERSION,
    bakeSatelliteImage,
    deleteSatImage,
    getSatImageByKey,
    getSatKeys,
    satImageKey,
    satImageMeta,
} from "../satellite/satelliteImage";
import { vlog } from "../../shared/verboseLog";
import type { HostPorts } from "../../shared/hostPorts";
import {
    needsFireDisc,
    needsMapBlob,
    snapLiveAnchor,
} from "../../shared/liveAnchor";
import { checkDownloadGate, noteDownloadedBytes } from "../offlineDownloadGate";
import {
    areaCentreCovered,
    areaTilesPresent,
    areaTilesPresentIn,
    downloadV4Area,
    getAllTileKeys,
    PACK_FORMAT_VERSION,
    purgeEmptyTilesOnce,
} from "../../worker/worker-local-dev/roads/packDownload";
import { GRID_RADIUS_KM } from "../../contract/blob";
import { BLOB_TILE_Z } from "../../contract/grid";
import { FIRE_RADIUS_KM } from "../../shared/fireContract";
import { purgeDeadRoadRasters } from "../store/tombstones/purgeRoadRasters";
import {
    beginWork,
    noteQueued,
    noteSkip,
    noteCircuit,
} from "../../shared/workMeter.svelte";

/** Signature of a complete blob, derived so any input change forces a re-download. */
export const BLOB_VERSION = [
    `pf${PACK_FORMAT_VERSION}`,
    `cell@${BLOB_TILE_Z}r${GRID_RADIUS_KM}km`,
    `sat${BAKE_RADIUS_KM}km`,
    `bake${BAKE_VERSION}`,
].join("|");

export interface OfflineBakeStatus {
    note: string;
    /** Bumps whenever on-disk data changed; the viewer re-mounts on each bump. */
    generation: number;
    downloading: boolean;
    pending: number;
    /** Areas whose photo bake is in backoff; non-zero at idle = waiting to retry. */
    failing: number;
    /** Where the current download is; the waiting animation anchors here. */
    at: [number, number] | null;
}
let status: OfflineBakeStatus = {
    note: "",
    generation: 0,
    downloading: false,
    pending: 0,
    failing: 0,
    at: null,
};
const listeners = new Set<(s: OfflineBakeStatus) => void>();

/** Fires immediately with the current status, then on every change. */
export function subscribeOfflineBake(
    fn: (s: OfflineBakeStatus) => void,
): () => void {
    listeners.add(fn);
    fn(status);
    return () => listeners.delete(fn);
}
function emit(): void {
    for (const fn of listeners) fn(status);
}
function setNote(note: string): void {
    if (status.note === note) return;
    status = { ...status, note };
    emit();
}
function setActivity(
    downloading: boolean,
    pending: number,
    failing: number,
    at: [number, number] | null = status.at,
): void {
    if (
        status.downloading === downloading &&
        status.pending === pending &&
        status.failing === failing &&
        status.at === at
    )
        return;
    status = { ...status, downloading, pending, failing, at };
    emit();
}

function setAt(at: [number, number] | null): void {
    if (status.at === at) return;
    status = { ...status, at };
    emit();
}
function bumpGeneration(): void {
    status = { ...status, generation: status.generation + 1 };
    emit();
}

/** Null until startOfflineBakeService runs; read as "no places yet", never thrown. */
let ports: HostPorts | null = null;

let reconciling = false;
let rerun = false;
let backfilled = false;

let covByKey = new Map<string, CoverageRecord>();
let touchByKey = new Map<string, number>();

// Per-area photo cooldown; gates the photo only, never the roads.
const satCooldown = new Map<string, { until: number; fails: number }>();
// One per host, not per area: the fires Worker is up or it isn't.
let fireBreaker: { until: number; fails: number } | null = null;
// The tiles Worker serves packs AND fires, so a connection-level failure
// (TypeError) from either pass pauses both. HTTP errors stay per-area.
let workerBreaker: { until: number; fails: number } | null = null;
function isHostDown(err: unknown): boolean {
    return err instanceof TypeError;
}
function workerBreakerOpen(): boolean {
    return workerBreaker !== null && workerBreaker.until > Date.now();
}
function tripWorkerBreaker(pass: string, err: unknown): void {
    const fails = (workerBreaker?.fails ?? 0) + 1;
    const backoff = Math.min(900_000, 30_000 * 2 ** Math.min(fails - 1, 5));
    workerBreaker = { fails, until: Date.now() + backoff };
    console.warn(
        `[offline-bake] tiles Worker unreachable (seen by ${pass}) — roads and fires paused, attempt ${fails}, retrying in ${Math.round(backoff / 1000)}s`,
        err,
    );
}
let liveFix: [number, number] | null = null;
let passChanged = false;

/** Cumulative across a whole run, not per slice; see reportRun. */
const pass = {
    slices: 0,
    areas: 0,
    tiles: 0,
    bytes: 0,
    ms: 0,
    empty: 0,
    cacheHits: 0,
    builds: new Set<string>(),
};
let resumingRun = false;
function resetPassTally(): void {
    pass.slices = 0;
    pass.areas = 0;
    pass.tiles = 0;
    pass.bytes = 0;
    pass.ms = 0;
    pass.empty = 0;
    pass.cacheHits = 0;
    pass.builds.clear();
}
/** Reports once the run drained and did something; a queued slice keeps accumulating. */
function reportRun(more: boolean): void {
    if (more) return;
    if (pass.areas === 0) return;
    const mb = (pass.bytes / 1e6).toFixed(1);
    const allEmpty = pass.empty === pass.areas;
    const emptyNote = pass.empty > 0 ? ` · ${pass.empty} empty` : "";
    const build = pass.builds.size ? ` · ${[...pass.builds].join("+")}` : "";
    const cache = pass.cacheHits ? ` · ${pass.cacheHits} cached` : "";
    const slices = pass.slices > 1 ? ` · ${pass.slices} slices` : "";
    const line = `${pass.areas} area(s), ${pass.tiles} tiles, ${mb} MB in ${(pass.ms / 1000).toFixed(1)}s${cache}${build}${slices}${emptyNote}`;

    vlog("wall", line);

    // console.warn, not log: DevTools level filters hide console.log by default.
    console.warn(`[roads] pass done — ${line}`);

    // All-empty means the Worker is answering wrong; a missing tile throws nothing otherwise.
    if (allEmpty) {
        console.warn(
            `[roads] ⚠️ ALL ${pass.areas} area(s) came back EMPTY — the Worker returned no tiles (${build.trim() || "unknown build"})`,
        );
    }
}

// Lie-fi guards: boot delay gives the map's own fetches the pipe first; a
// timed-out pass backs off doubling to the cap.
const BOOT_BAKE_DELAY_MS = 20_000;
/** One pass's download budget; unbounded it ran 81 s with the heap never idle. */
const BAKE_PASS_BUDGET_MS = 5_000;
/** A budget-paused pass has work left; long enough for the main thread and GC to breathe. */
const BUDGET_RESUME_MS = 1_500;
const TIMEOUT_BACKOFF_START_MS = 60_000;
const TIMEOUT_BACKOFF_CAP_MS = 300_000;
let bootBakeAt = 0;
let timeoutBackoffUntil = 0;
let nextTimeoutBackoffMs = TIMEOUT_BACKOFF_START_MS;
// Consecutive failures that stop a pass; without it a Worker returning 500s
// is asked for every area every tick.
const FAIL_BREAK_AFTER = 3;
let passSawTimeout = false;
let guardTripAnnounced = false;

/** AbortSignal.timeout → "TimeoutError"; a manual abort → "AbortError". */
function isTimeoutErr(err: unknown): boolean {
    const name = (err as { name?: string } | null)?.name;
    return name === "TimeoutError" || name === "AbortError";
}

/** Ensure one area's photo + tiles are on disk and recorded; keyed by area so pins sharing one bake once. */
async function ensureAreaData(
    center: [number, number],
    corridor: boolean,
): Promise<void> {
    const key = satImageKey(center);
    const [lng, lat] = center;
    let photoBytes = 0;
    let lineBytes = 0;
    let lineCount = 0;
    let hasPhoto = false;
    let hasLines = false;
    const prevCov = covByKey.get(key);

    // Each task writes only its own outer vars, so overlapping them cannot race.
    const satTask = (async (): Promise<void> => {
        if (corridor) return;
        const cd = satCooldown.get(key);
        if (cd && cd.until > Date.now()) return;
        const hadPhoto = prevCov?.hasPhoto === true;
        noteCircuit("sat", "transit", "", key);
        let sat: Awaited<ReturnType<typeof bakeSatelliteImage>>;
        try {
            sat = await bakeSatelliteImage(center);
        } catch (err) {
            noteCircuit(
                "sat",
                "err",
                err instanceof Error ? err.message : String(err),
                key,
            );
            // A photo timeout is the imagery provider's problem: it gets this
            // area's cooldown and must not reach the pass-level back-off.
            if (isTimeoutErr(err)) {
                const fails = (cd?.fails ?? 0) + 1;
                satCooldown.set(key, {
                    fails,
                    until:
                        Date.now() +
                        Math.min(900_000, 30_000 * 2 ** Math.min(fails - 1, 5)),
                });
                return;
            }
            throw err;
        }
        if (sat) {
            noteCircuit(
                "sat",
                "ok",
                `${(sat.blob.size / 1024).toFixed(0)} KB`,
                key,
            );
            hasPhoto = true;
            photoBytes = sat.blob.size;
            satCooldown.delete(key);
            if (!hadPhoto) passChanged = true;
        } else {
            noteCircuit(
                "sat",
                "err",
                "photo bake returned nothing (throttled / empty)",
                key,
            );
            const fails = (cd?.fails ?? 0) + 1;
            satCooldown.set(key, {
                fails,
                until:
                    Date.now() +
                    Math.min(900_000, 30_000 * 2 ** Math.min(fails - 1, 5)),
            });
        }
    })();

    const tilesTask = (async (): Promise<void> => {
        // The registry flag can lie (eviction deletes tiles while hasLines lingers); disk is the truth.
        let tilesValid = false;
        const versionCurrent = prevCov?.blobVersion === BLOB_VERSION;
        if (prevCov?.hasLines && versionCurrent) {
            // Loose probe: a strict centre probe thrashes on edge-sparse areas.
            // lineCount must be an explicit 0; undefined means unverified.
            tilesValid =
                prevCov.lineCount === 0 || (await areaTilesPresent(lng, lat));
        } else {
            tilesValid = await areaCentreCovered(lng, lat);
        }
        if (tilesValid) {
            hasLines = true;
            lineBytes = prevCov?.lineBytes ?? 0;
            lineCount = prevCov?.lineCount ?? 0;
        } else if (
            (typeof navigator !== "undefined" && navigator.onLine === false) ||
            workerBreakerOpen()
        ) {
            // Offline: skip quietly; throwing would abort the whole pass.
        } else {
            vlog(
                "wall",
                `downloading 30 km blob @ ${lng.toFixed(4)},${lat.toFixed(4)}…`,
            );
            setAt([lng, lat]);
            const t0 = Date.now();
            const doneRoads = beginWork("roads");
            let dl: Awaited<ReturnType<typeof downloadV4Area>>;
            try {
                dl = await downloadV4Area(lng, lat, undefined, corridor);
            } catch (err) {
                doneRoads(true);
                if (isHostDown(err)) tripWorkerBreaker("roads", err);
                throw err;
            }
            doneRoads();
            workerBreaker = null;
            setAt(null);
            const ms = Date.now() - t0;
            vlog(
                "wall",
                `ARRIVED: ${dl.downloaded} tiles, ${(dl.bytes / 1e6).toFixed(2)} MB, ${ms} ms` +
                    (dl.build ? ` · ${dl.build}` : "") +
                    (dl.cache ? ` · cache ${dl.cache}` : "") +
                    (dl.diag ? ` · ${dl.diag}` : ""),
            );
            pass.areas++;
            pass.tiles += dl.downloaded;
            pass.bytes += dl.bytes;
            pass.ms += ms;
            if (dl.downloaded === 0) pass.empty++;
            if (dl.cache === "HIT") pass.cacheHits++;
            if (dl.build) pass.builds.add(dl.build);
            hasLines = true; // covered even when empty, so the record persists
            lineBytes = dl.bytes;
            lineCount = dl.downloaded;
            noteDownloadedBytes(dl.bytes);
            if (dl.downloaded > 0) passChanged = true;
        }
    })();

    await Promise.all([satTask, tilesTask]);

    await noteCoverage(
        key,
        lng,
        lat,
        {
            hasPhoto,
            hasLines,
            bytes: photoBytes + lineBytes,
            photoBytes,
            lineBytes,
            lineCount,
            blobVersion: BLOB_VERSION,
            ...(hasPhoto || hasLines ? { bakedAt: Date.now() } : {}),
        },
        false,
        touchByKey.get(key),
    );
}

async function pruneArea(key: string): Promise<void> {
    await deleteSatImage(key);
    await deleteVectorAt(key);
    await ports?.fires?.delete(key);
    await dropCoverage(key);
    passChanged = true;
}

/** Fires are perishable, so this runs outside ensureAreaData's completion gate and must fail alone. */
async function refreshFires(
    centres: ReadonlyArray<[number, number]>,
): Promise<void> {
    const fires = ports?.fires;
    if (!fires) return;

    // Offline: stale dots beat an empty map that reads as "no fires near you".
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    // Consumed, not read, so a failed pass cannot leave the arrival armed.
    const onDemand = fires.takeArrival();
    if (onDemand) fireBreaker = null;
    if (fireBreaker && fireBreaker.until > Date.now()) return;
    if (workerBreakerOpen()) return;

    for (const [lng, lat] of centres) {
        const key = satImageKey([lng, lat]);
        try {
            const prev = await fires.read(key);
            if (prev && fires.isFresh(prev) && !onDemand) continue;
            // A neighbouring FRESH 500 km disc covers this centre; a stale one
            // could cover it with nothing forever. Centres only, never records.
            const coveringCentres = (await fires.coverage())
                .filter((c) => fires.isCoverageFresh(c))
                .map((e) => e.center);
            if (!onDemand && !needsFireDisc([lng, lat], coveringCentres))
                continue;
            noteCircuit("fires", "transit");
            const r = await fires.fetchArea(lng, lat);
            await fires.write(key, {
                fetchedAt: r.fetchedAt,
                center: [lng, lat],
                radiusKm: FIRE_RADIUS_KM,
                sourcesOk: r.sourcesOk,
                hotspots: [...r.hotspots],
            });
            fireBreaker = null;
            workerBreaker = null;
            noteCircuit(
                "fires",
                "ok",
                `${r.hotspots.length} hotspots · ${r.sourcesOk}/3 sats`,
            );
            noteDownloadedBytes(r.bytes);
            passChanged = true;
            vlog(
                "fire",
                `[v4 fire] downloaded ${r.hotspots.length} hotspots for ${key} (${(r.bytes / 1024).toFixed(1)} KB, ${r.sourcesOk}/3 satellites)`,
            );
        } catch (err) {
            noteCircuit(
                "fires",
                "err",
                err instanceof Error ? err.message : String(err),
            );
            if (isHostDown(err)) {
                tripWorkerBreaker("fires", err);
                return;
            }
            // The first failure ends the pass; the rest would fail against the same feed.
            const fails = (fireBreaker?.fails ?? 0) + 1;
            const backoff = Math.min(
                900_000,
                30_000 * 2 ** Math.min(fails - 1, 5),
            );
            fireBreaker = { fails, until: Date.now() + backoff };
            // codestyle-allow-swallow: not a swallow — this catch drives the retry backoff and warns by default; the layer keeps its last good hotspots.
            console.warn(
                `[v4 fire] fires feed failed at ${key} — ${centres.length} area(s) paused, attempt ${fails}, retrying in ${Math.round(backoff / 1000)}s — keeping cached hotspots`,
                err,
            );
            return;
        }
    }
}

/** Every feature on every map, newest-touched first, gets its blob until the budget is full; the rest is evicted. */
async function bakeAll(): Promise<void> {
    // A latched guard is terminal for the session; only a reload resets it.
    if (isDownloadGuardTripped()) {
        noteSkip("bake", "download guard latched");
        // It can latch mid-run: flush what was fetched rather than lose it.
        resumingRun = false;
        reportRun(false);
        resetPassTally();
        return;
    }
    if (reconciling) {
        rerun = true;
        noteQueued("bake");
        noteSkip("bake", "already running");
        return;
    }
    reconciling = true;
    noteQueued("bake", false);
    const bakeDone = beginWork("bake");
    let budgetPaused = false;
    passChanged = false;
    passSawTimeout = false;
    let passFailStreak = 0;
    let passBrokeOnFailures = false;
    if (!resumingRun) resetPassTally();
    resumingRun = false;
    pass.slices++;
    liveFix = null;
    try {
        setNote("Saving offline map\u2026");
        // Every area every feature references, deduped, with its newest touch;
        // corridor only if every referencing feature is a line.
        const areas = new Map<
            string,
            { c: [number, number]; corridor: boolean; t: number }
        >();
        const note = (
            c: [number, number],
            corridor: boolean,
            t: number,
        ): void => {
            const k = satImageKey(c);
            const prev = areas.get(k);
            areas.set(k, {
                c,
                corridor: prev ? prev.corridor && corridor : corridor,
                t: Math.max(t, prev?.t ?? 0),
            });
        };
        for (const p of ports?.places() ?? []) {
            const t = Date.parse(p.lastTouched) || 0;
            for (const c of p.anchors) note(c, p.corridor, t);
        }
        // The live anchor is transient (never re-noted), so containment is
        // measured against stored coverage, not just this pass's anchors.
        try {
            const fix = (await ports?.gps?.()) ?? null;
            if (fix) {
                liveFix = fix;
                // A fresh registry read; covByKey is snapshotted later and holds the previous pass.
                const stored = await allCoverage();
                const centres = [
                    ...[...areas.values()].map((a) => a.c),
                    ...stored.map((r) => [r.lng, r.lat] as [number, number]),
                ];
                if (needsMapBlob(fix, centres)) {
                    note(snapLiveAnchor(fix), false, Date.now());
                    vlog(
                        "map",
                        `[v4 live] outside coverage \u2014 baking a blob at your position ${snapLiveAnchor(
                            fix,
                        )
                            .map((n) => n.toFixed(2))
                            .join(",")}`,
                    );
                }
            }
        } catch (err) {
            // codestyle-allow-swallow: the live anchor is a bonus; a geolocation hiccup must not abort the pass.
            console.warn("[v4 live] position unavailable this pass", err);
        }

        const ordered = [...areas.entries()].sort((a, b) => b[1].t - a[1].t);
        touchByKey = new Map(ordered.map(([k, v]) => [k, v.t]));

        // Disk is the truth, not the registry. Metadata only: reading whole
        // blobs for their size allocated 613 MB and OOM-crashed the tab.
        const satKeys = new Set(await getSatKeys());
        // Fresh = baked by the current BAKE_VERSION; eviction still sees every photo.
        const freshSat = new Set<string>();
        const photoBytes = new Map<string, number>();
        for (const { key, bytes, bakeVersion } of await satImageMeta()) {
            photoBytes.set(key, bytes);
            if (bakeVersion === BAKE_VERSION) freshSat.add(key);
        }
        covByKey = new Map((await allCoverage()).map((r) => [r.areaKey, r]));
        // Loaded once per pass; per-area IndexedDB opens were an I/O storm.
        const tileKeys = await getAllTileKeys();

        // The conveyor: newest-touched first, accumulating kept bytes; within
        // budget = ensure on disk, past it = skip. Measured in KEPT bytes, not
        // total disk bytes, or a disk full of old photos blocks every new pin.
        let keptBytes = 0;
        let gatePaused = false;
        let downloaded = 0;
        // Stop cleanly between areas, never mid-ensureAreaData.
        const passDeadline = Date.now() + BAKE_PASS_BUDGET_MS;
        for (const [k, { c, corridor }] of ordered) {
            // Only after one area landed: a pass must always make progress.
            if (downloaded > 0 && Date.now() > passDeadline) {
                budgetPaused = true;
                break;
            }
            const sizeGuess = corridor
                ? 0
                : (photoBytes.get(k) ?? EST_AREA_BYTES);
            if (keptBytes + sizeGuess > OFFLINE_BUDGET_BYTES) continue;
            keptBytes += sizeGuess;
            const satOnDisk = corridor || freshSat.has(k);
            // A server-empty area is complete, not missing: areaTilesPresentIn
            // answers "no" forever for it. lineCount must be an explicit 0.
            const cov = covByKey.get(k);
            const serverHasNothing =
                cov?.blobVersion === BLOB_VERSION &&
                cov?.hasLines === true &&
                cov?.lineCount === 0;
            const tilesOnDisk =
                serverHasNothing || areaTilesPresentIn(tileKeys, c[0], c[1]);
            if (satOnDisk && tilesOnDisk) continue;
            if (await checkDownloadGate()) {
                gatePaused = true;
                break;
            }
            setActivity(true, ++downloaded, satCooldown.size);
            try {
                await ensureAreaData(c, corridor);
                passFailStreak = 0;
                if (!corridor) {
                    const img = await getSatImageByKey(k);
                    if (img && !photoBytes.has(k)) {
                        keptBytes += img.blob.size - sizeGuess;
                        photoBytes.set(k, img.blob.size);
                        satKeys.add(k);
                    }
                }
            } catch (err) {
                if (isTimeoutErr(err)) passSawTimeout = true;
                // Latched for the session: stop the pass and say so once.
                if (isDownloadGuardTripped()) {
                    if (!guardTripAnnounced) {
                        guardTripAnnounced = true;
                        console.error(
                            "[offline-bake] 🛑 download circuit breaker is LATCHED — " +
                                "stopping all baking for this session. Reload the page to reset.",
                            err,
                        );
                    }
                    break;
                }
                if (isHostDown(err)) continue;
                console.warn(
                    "[offline-bake] area failed (retry next pass)",
                    err,
                );
                if (++passFailStreak >= FAIL_BREAK_AFTER) {
                    passBrokeOnFailures = true;
                    break;
                }
            }
        }

        // Evict: (a) an area we baked (has a coverage record) whose pin is gone;
        // a photo with no record belongs to the online map's shared cache.
        // (b) LRU past the budget.
        const kept = new Set<string>();
        // Never before the host has hydrated, or a briefly-empty place list
        // makes every blob look unreferenced. ready(), not places().length:
        // a host with every pin deleted must still evict. A paused walk leaves
        // keptBytes partial, so it blocks eviction too.
        if (!gatePaused && !budgetPaused && (ports?.ready() ?? false)) {
            const touchOf = (k: string): number => {
                const t = touchByKey.get(k);
                if (t !== undefined) return t;
                return covByKey.get(k)?.lastTouched ?? 0;
            };
            const sizeOf = (k: string): number =>
                photoBytes.get(k) ?? covByKey.get(k)?.bytes ?? EST_AREA_BYTES;
            const stored = [
                ...new Set<string>([
                    ...satKeys,
                    ...(await getVectorKeys()),
                    ...(await allCoverage()).map((r) => r.areaKey),
                ]),
            ].sort((a, b) => touchOf(b) - touchOf(a));
            let total = 0;
            for (const k of stored) {
                if (!touchByKey.has(k) && covByKey.has(k)) {
                    await pruneArea(k);
                    continue;
                }
                total += sizeOf(k);
                if (total > OFFLINE_BUDGET_BYTES) {
                    await pruneArea(k);
                } else {
                    kept.add(k);
                }
            }

            // Mirror the ledger to disk; only writes when missing or stale.
            const liveSat = new Set(await getSatKeys());
            const liveTileKeys = await getAllTileKeys();
            // Fresh read: covByKey is a pass-start snapshot and cannot see an
            // area that downloaded during this pass.
            const covNow = new Map(
                (await allCoverage()).map((r) => [r.areaKey, r] as const),
            );
            for (const [k, { c }] of ordered) {
                if (!kept.has(k)) continue;
                const hasPhoto = liveSat.has(k);
                const hasLines = areaTilesPresentIn(liveTileKeys, c[0], c[1]);
                if (!hasPhoto && !hasLines) continue;
                const rec = covNow.get(k);
                const current =
                    !!rec &&
                    rec.hasPhoto === hasPhoto &&
                    rec.hasLines === hasLines &&
                    rec.blobVersion === BLOB_VERSION;
                if (current) continue;
                // The mirror knows presence only, so it carries byte/count
                // detail forward. lineCount never defaults to 0: the skip check
                // reads 0 as "server confirmed empty".
                const lineBytes = hasLines ? (rec?.lineBytes ?? 0) : 0;
                const lineCount = hasLines ? rec?.lineCount : undefined;
                const photoBytesNow = photoBytes.get(k) ?? rec?.photoBytes ?? 0;
                await noteCoverage(
                    k,
                    c[0],
                    c[1],
                    {
                        hasPhoto,
                        hasLines,
                        photoBytes: photoBytesNow,
                        lineBytes,
                        lineCount,
                        bytes: photoBytesNow + lineBytes,
                        // Never BLOB_VERSION here: only a real download may stamp it.
                        blobVersion: rec?.blobVersion,
                    },
                    false,
                    touchByKey.get(k),
                );
            }
        }

        // Fires last, outside the completion gate: the loop skips complete
        // areas, and the live position wants fires even without a map blob.
        try {
            const fireCentres = [...areas.entries()]
                .filter(([k]) => kept.has(k))
                .map(([, v]) => v.c);
            // Snapped: a raw fix would mint a new fire record every few paces.
            const liveCentre = liveFix ? snapLiveAnchor(liveFix) : null;
            if (
                liveCentre &&
                !fireCentres.some(
                    (c) => c[0] === liveCentre[0] && c[1] === liveCentre[1],
                )
            ) {
                fireCentres.unshift(liveCentre);
            }
            if (FIRE_REFRESH_ENABLED) await refreshFires(fireCentres);
        } catch (err) {
            console.warn("[v4 fire] refresh pass failed", err);
        }
    } catch (err) {
        if (isTimeoutErr(err)) passSawTimeout = true;
        console.warn("[offline-bake] bakeAll failed", err);
    } finally {
        bakeDone();
        setNote("");
        setActivity(false, 0, satCooldown.size);
        if (passChanged) bumpGeneration();
        // A timeout means lie-fi; kicking again in 20 s just re-saturates it.
        if (passSawTimeout || passBrokeOnFailures) {
            timeoutBackoffUntil = Date.now() + nextTimeoutBackoffMs;
            console.warn(
                `[offline-bake] pass ${passSawTimeout ? "hit a network timeout" : `failed ${FAIL_BREAK_AFTER} areas in a row`} — backing off ${Math.round(nextTimeoutBackoffMs / 1000)}s`,
            );
            nextTimeoutBackoffMs = Math.min(
                nextTimeoutBackoffMs * 2,
                TIMEOUT_BACKOFF_CAP_MS,
            );
        } else {
            timeoutBackoffUntil = 0;
            nextTimeoutBackoffMs = TIMEOUT_BACKOFF_START_MS;
        }
        reconciling = false;
        const moreComing = rerun || budgetPaused;
        resumingRun = moreComing;
        reportRun(moreComing);
        if (rerun) {
            rerun = false;
            kickBake();
        } else if (budgetPaused) {
            setTimeout(kickBake, BUDGET_RESUME_MS);
        }
    }
}

/** Backfills split photo/line byte fields, one area at a time to bound peak heap. */
async function backfillCoverageSizes(): Promise<void> {
    if (backfilled) return;
    backfilled = true;
    try {
        const recs = await allCoverage();
        const need = recs.filter(
            (r) =>
                (r.hasPhoto && !r.photoBytes) || (r.hasLines && !r.lineBytes),
        );
        if (!need.length) return;
        const photoBytesByKey = new Map<string, number>();
        if (need.some((r) => r.hasPhoto)) {
            for (const { key, bytes } of await satImageMeta()) {
                photoBytesByKey.set(key, bytes);
            }
        }
        for (const r of need) {
            const patch: {
                photoBytes?: number;
                lineBytes?: number;
                lineCount?: number;
            } = {};
            if (r.hasPhoto)
                patch.photoBytes =
                    photoBytesByKey.get(r.areaKey) ?? r.photoBytes ?? 0;
            if (r.hasLines) {
                const feats = await getVectorFeaturesAt(r.areaKey);
                patch.lineBytes = JSON.stringify(feats).length;
                patch.lineCount = feats.length;
            }
            await noteCoverage(r.areaKey, r.lng, r.lat, patch, false);
        }
    } catch (err) {
        console.warn("[offline-bake] coverage size backfill failed", err);
    }
}

/** Run a pass now; cheap on every change since a present blob is zero work. */
export function kickBake(): void {
    const now = Date.now();
    if (now < bootBakeAt) return;
    if (now < timeoutBackoffUntil) return;
    void bakeAll();
}

/** Clears every satellite cooldown so failed areas re-bake now; returns the count released. */
export function retryFailedBakes(): number {
    const n = satCooldown.size;
    satCooldown.clear();
    setActivity(status.downloading, status.pending, 0);
    void bakeAll();
    return n;
}

/** For the test seam. */
export async function reconcileOnceForTest(
    hostPorts?: HostPorts,
): Promise<void> {
    if (hostPorts) ports = hostPorts;
    await bakeAll();
}

let started = false;
let teardown: Array<() => void> = [];

/** Idempotent; the trigger is a push (onPlacesChanged), not a reactive read. */
export function startOfflineBakeService(hostPorts: HostPorts): () => void {
    if (started)
        return () => {
            /* the first start's stop owns shutdown */
        };
    started = true;
    ports = hostPorts;

    // Before the first pass, so all-empty discs re-download rather than read as covered.
    void purgeEmptyTilesOnce();

    purgeDeadRoadRasters();

    void backfillCoverageSizes();
    void backfillCoverageMirror();

    bootBakeAt = Date.now() + BOOT_BAKE_DELAY_MS;
    // App open, focus and reconnect are each an arrival: the ask that bypasses the fire TTL.
    ports.fires?.arrival();
    const bootTimer = setTimeout(kickBake, BOOT_BAKE_DELAY_MS);
    teardown.push(() => clearTimeout(bootTimer));

    teardown.push(ports.onPlacesChanged(kickBake));

    const timer = setInterval(kickBake, 20000);
    teardown.push(() => clearInterval(timer));

    if (typeof document !== "undefined") {
        const onVisible = () => {
            if (document.visibilityState === "visible") {
                workerBreaker = null;
                hostPorts.fires?.arrival();
                kickBake();
            }
        };
        document.addEventListener("visibilitychange", onVisible);
        teardown.push(() =>
            document.removeEventListener("visibilitychange", onVisible),
        );
    }

    if (typeof window !== "undefined") {
        const onOnline = () => {
            workerBreaker = null;
            hostPorts.fires?.arrival();
            kickBake();
        };
        window.addEventListener("online", onOnline);
        teardown.push(() => window.removeEventListener("online", onOnline));
    }

    // Without this, wipe deletes databases this service is re-writing into.
    teardown.push(registerWipeStopper(stopOfflineBakeService));

    return stopOfflineBakeService;
}

export function stopOfflineBakeService(): void {
    for (const fn of teardown) fn();
    teardown = [];
    started = false;
    ports = null;
}
