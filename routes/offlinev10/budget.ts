/** How much offline preview data a phone may hold, tiles and photos together; enforced at the tile store's write boundary. */

export const OFFLINE_TILES_BYTES = 1_073_741_824;
/** An area the map has not shown for this long removes itself at boot; tiles can always be fetched again. */
export const STALE_AREA_MONTHS = 12;
export const BUDGET_MB = OFFLINE_TILES_BYTES / 1048576;
/** A second wall: a thousand small blobs cost little disk but make the coverage geometry slow. */
export const BLOB_COUNT_CAP = 1000;
/** The dev CONFIG card cycles through these so the wall can be hit in minutes. */
export const BUDGET_PRESETS_MB = [BUDGET_MB, 256, 64, 16] as const;

const KEY = "gc-offlineV10:budgetMb";

/** A shipped build never reads the override: the DEV branch is compiled away. */
export function budgetMb(): number {
	if (!import.meta.env.DEV) return BUDGET_MB;
	try {
		const v = Number(sessionStorage.getItem(KEY));
		if (Number.isFinite(v) && v > 0) return v;
	} catch {
		// codestyle-allow-swallow: sessionStorage unavailable in SSR/private mode
	}
	return BUDGET_MB;
}

export function budgetBytes(): number {
	return budgetMb() * 1048576;
}

/** Last opened before the cut-off; an area never opened counts from its birth. */
export function isStale(r: { at: number; lastOpened?: number }, now = Date.now()): boolean {
	const cut = new Date(now);
	cut.setMonth(cut.getMonth() - STALE_AREA_MONTHS);
	return (r.lastOpened ?? r.at) < cut.getTime();
}

/** Roads AND photo: a photo often outweighs the roads it covers. */
export function blobBytes(tileBytes: number, photoBytes = 0): number {
	return tileBytes + photoBytes;
}

export function setBudgetMb(mb: number): void {
	if (!import.meta.env.DEV) return;
	try {
		if (mb === BUDGET_MB) sessionStorage.removeItem(KEY);
		else sessionStorage.setItem(KEY, String(mb));
	} catch {
		// codestyle-allow-swallow: sessionStorage unavailable in SSR/private mode
	}
}

/** The words a person sees when a download is refused. */
export function fullMessage(limit = `${budgetMb() >= 1024 ? `${budgetMb() / 1024} GB` : `${budgetMb()} MB`}`): string {
	return `Offline areas are limited to ${limit}. Remove an area to make room.`;
}

export class BudgetError extends Error {
	constructor(
		public readonly used: number,
		public readonly budget: number,
		public readonly adding: number,
		message = fullMessage(),
	) {
		super(message);
		this.name = "BudgetError";
	}
}
