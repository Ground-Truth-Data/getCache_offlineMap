/** downloadGuard — a HARD circuit breaker on offline-map network volume; a safety floor, never a tuning knob. Once tripped, only a reload resets it — a runaway must not be able to un-trip itself. */
import * as Sentry from "@sentry/sveltekit";

/** One satellite bake's tile grid. ~13 legit (3 km z14); >this = an absurd area → stop cold. */
const PER_BAKE_TILE_CAP = 400;
/** Satellite tiles per rolling hour; ~13/area. A runaway re-baking every 20 s blows past this in minutes; a human with 440 areas (5,720 tiles) does not, because a full re-bake takes longer than an hour. Was a per-SESSION total, which latched a legitimate long session at ~385 areas (5 Sep 2026). */
const HOURLY_TILE_CAP = 5000;
/** v4 vector /pack downloads per rolling hour. ⚠️ A budget must count what the user does (bake an area), never what the implementation happens to do (issue a request). */
const HOURLY_PACK_CAP = 5000;
const WINDOW_MS = 3_600_000;

let windowStart = 0;
let sessionTiles = 0;
let sessionPacks = 0;

/** Counts live in one-hour windows; a new hour starts the tally over. The latch itself never resets. */
function rollWindow(): void {
    const now = Date.now();
    if (now - windowStart < WINDOW_MS) return;
    windowStart = now;
    sessionTiles = 0;
    sessionPacks = 0;
}
let tripped = false;
let trippedReason = "";

/** Thrown by every guard once tripped; callers should let it propagate — it aborts the bake/download loop loudly. */
export class DownloadBudgetError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DownloadBudgetError";
    }
}

export function isDownloadGuardTripped(): boolean {
    return tripped;
}

function trip(reason: string, extra: Record<string, unknown>): never {
    // Flip the breaker + alert Sentry exactly once; subsequent guards just throw.
    if (!tripped) {
        tripped = true;
        trippedReason = reason;
        // Loud operator signal — this should NEVER fire in normal use.
        console.error(
            `[downloadGuard] 🛑 CIRCUIT TRIPPED — offline-map download runaway blocked: ${reason}`,
            { ...extra, sessionTiles, sessionPacks },
        );
        try {
            Sentry.captureMessage(
                `[downloadGuard] offline-map runaway BLOCKED — ${reason}`,
                {
                    level: "fatal",
                    extra: { ...extra, sessionTiles, sessionPacks },
                    tags: { area: "offline-download-guard" },
                },
            );
        } catch {
            // Sentry must never mask the real failure — the throw below is what matters.
        }
    }
    throw new DownloadBudgetError(reason);
}

/** Call BEFORE fetching a satellite disc's tiles; trips if this bake's grid is absurdly large, before a single byte downloads. */
export function guardBakeGrid(
    tileCount: number,
    ctx: Record<string, unknown>,
): void {
    if (tripped) throw new DownloadBudgetError(trippedReason);
    if (tileCount > PER_BAKE_TILE_CAP) {
        trip(
            `single satellite bake grid ${tileCount} > cap ${PER_BAKE_TILE_CAP}`,
            {
                tileCount,
                ...ctx,
            },
        );
    }
}

/** Call once per satellite tile fetched; trips when this hour's total blows the ceiling (catches multi-bake / reconcile-loop runaways). */
export function noteSatelliteTiles(n: number): void {
    if (tripped) throw new DownloadBudgetError(trippedReason);
    rollWindow();
    sessionTiles += n;
    if (sessionTiles > HOURLY_TILE_CAP) {
        trip(
            `satellite tiles this hour ${sessionTiles} > cap ${HOURLY_TILE_CAP}`,
            {
                sessionTiles,
            },
        );
    }
}

/** Call before each v4 vector /pack download; trips on an implausible number of downloads in one hour. */
export function guardPackDownload(ctx: Record<string, unknown>): void {
    if (tripped) throw new DownloadBudgetError(trippedReason);
    rollWindow();
    sessionPacks += 1;
    if (sessionPacks > HOURLY_PACK_CAP) {
        trip(
            `pack downloads this hour ${sessionPacks} > cap ${HOURLY_PACK_CAP}`,
            {
                sessionPacks,
                ...ctx,
            },
        );
    }
}
