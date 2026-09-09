/**
 * How much offline map a phone may hold, tiles and photos together. The
 * browser's own quota is bigger and not ours to spend; a phone that fills
 * itself with maps has no room for the day's photos. Enforced at the tile
 * store's write boundary (putTiles), so no download path can slip past it.
 */

export const BUDGET_MB = 1024;
/** The dev CONFIG card cycles through these so the wall can be hit in minutes, not after a gigabyte. */
export const BUDGET_PRESETS_MB = [BUDGET_MB, 256, 64, 16] as const;

const KEY = "gc-offlineV10:budgetMb";

/** The budget in force. A shipped build never reads the override: import.meta.env.DEV is compile-time, so the branch is gone on a phone. */
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

/**
 * What one blob costs on disk: its roads AND its photo. A photo often
 * outweighs the roads it covers, so a figure that counts tiles alone
 * understates the row — and the row's own sub-lines, which do show both,
 * then visibly fail to add up to their own header.
 */
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

export class BudgetError extends Error {
	constructor(
		/** bytes on disk, tiles and photos */
		public readonly used: number,
		public readonly budget: number,
		/** the bytes that would have crossed the line */
		public readonly adding: number,
	) {
		super(
			`over the ${Math.round(budget / 1048576)} MB budget: ${(used / 1048576).toFixed(1)} MB on disk, ${(adding / 1048576).toFixed(1)} MB more asked`,
		);
		this.name = "BudgetError";
	}
}
