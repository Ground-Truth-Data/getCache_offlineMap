/** downloadGuard — safety floors on offline-preview downloads, never tuning knobs. An absurd bake refuses only itself:
 * a photo the planter asked for is never blocked by anything before it. Only the fires pack cap latches until reload. */

/** One satellite bake's tile grid. ~515 legit (2 km z17, the MapTiler bake); >this = an absurd area → refuse it. */
const PER_BAKE_TILE_CAP = 550;
/** v4 vector /pack downloads per rolling hour. ⚠️ A budget must count what the user does (bake an area), never what the implementation happens to do (issue a request). */
const HOURLY_PACK_CAP = 5000;
const WINDOW_MS = 3_600_000;

let windowStart = 0;
let sessionPacks = 0;

/** Counts live in one-hour windows; a new hour starts the tally over. The latch itself never resets. */
function rollWindow(): void {
    const now = Date.now();
    if (now - windowStart < WINDOW_MS) return;
    windowStart = now;
    sessionPacks = 0;
}
let tripped = false;
let trippedReason = "";
const refusedBakes = new Set<string>();

/** Thrown by every guard once tripped; callers should let it propagate — it aborts the bake/download loop loudly. */
export class DownloadBudgetError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DownloadBudgetError";
    }
}

function trip(reason: string, extra: Record<string, unknown>): never {
    // Flip the breaker and log exactly once; subsequent guards just throw.
    if (!tripped) {
        tripped = true;
        trippedReason = reason;
        console.error(
            `[downloadGuard] 🛑 CIRCUIT TRIPPED — offline-preview download runaway blocked: ${reason}`,
            { ...extra, sessionPacks },
        );
    }
    throw new DownloadBudgetError(reason);
}

/** Call BEFORE fetching a satellite disc's tiles; refuses this bake alone if its grid is absurdly large, before a single byte downloads. */
export function guardBakeGrid(
    tileCount: number,
    ctx: Record<string, unknown>,
): void {
    if (tileCount <= PER_BAKE_TILE_CAP) return;
    const reason = `single satellite bake grid ${tileCount} > cap ${PER_BAKE_TILE_CAP}`;
    // The photo pass retries a refused bake every minute; one log, not one per retry.
    if (!refusedBakes.has(reason)) {
        refusedBakes.add(reason);
        console.error(`[downloadGuard] 🛑 bake refused: ${reason}`, { tileCount, ...ctx });
    }
    throw new DownloadBudgetError(reason);
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
