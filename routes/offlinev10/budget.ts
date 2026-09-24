/** How much offline map a phone may hold, tiles and photos together; enforced at the tile store's write boundary. */

export const BUDGET_MB = 1024;
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

export class BudgetError extends Error {
	constructor(
		public readonly used: number,
		public readonly budget: number,
		public readonly adding: number,
	) {
		super(
			`over the ${Math.round(budget / 1048576)} MB budget: ${(used / 1048576).toFixed(1)} MB on disk, ${(adding / 1048576).toFixed(1)} MB more asked`,
		);
		this.name = "BudgetError";
	}
}
