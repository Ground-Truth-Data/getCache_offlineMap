/**
 * NASA's FIRMS "static land source" rule, absent from the NRT feed, replicated by persistence:
 * a cell seen on PERSIST_DAYS distinct days in a year is a flare, not a fire. Urban cover is
 * not enough on its own (the Richmond tank farm sits outside the mapped urban area).
 * FLAG, never delete: a refinery can genuinely catch fire.
 */

/** One VIIRS pixel; keep in sync with `CELL_DEG` in fireOutline. */
export const CELL_DEG = 0.00375;

/** NASA uses 16; lower is safe because a flagged cell is still shown. */
export const PERSIST_DAYS = 12;

export function cellKey(lng: number, lat: number): string {
	return `${Math.round(lat / CELL_DEG)},${Math.round(lng / CELL_DEG)}`;
}

export type StaticMask = ReadonlySet<string>;

/** Checks the 8 neighbours too: a pixel wanders between passes. */
export function isStaticSource(
	lng: number,
	lat: number,
	mask: StaticMask,
): boolean {
	if (mask.size === 0) return false;
	const gy = Math.round(lat / CELL_DEG);
	const gx = Math.round(lng / CELL_DEG);
	for (let dy = -1; dy <= 1; dy++) {
		for (let dx = -1; dx <= 1; dx++) {
			if (mask.has(`${gy + dy},${gx + dx}`)) return true;
		}
	}
	return false;
}

export function partitionStatic<T extends { coordinates: readonly [number, number] }>(
	detections: readonly T[],
	mask: StaticMask,
): { wildfire: T[]; industrial: T[] } {
	const wildfire: T[] = [];
	const industrial: T[] = [];
	for (const d of detections) {
		if (isStaticSource(d.coordinates[0], d.coordinates[1], mask)) {
			industrial.push(d);
		} else {
			wildfire.push(d);
		}
	}
	return { wildfire, industrial };
}

/** Builds the mask from archive detections; the asset must be regenerated with this, not a copy. */
export function buildMask(
	detections: readonly { lat: number; lng: number; day: string }[],
	persistDays: number = PERSIST_DAYS,
): Set<string> {
	const days = new Map<string, Set<string>>();
	for (const d of detections) {
		const key = cellKey(d.lng, d.lat);
		let set = days.get(key);
		if (set === undefined) {
			set = new Set();
			days.set(key, set);
		}
		set.add(d.day);
	}
	const mask = new Set<string>();
	for (const [key, seen] of days) {
		if (seen.size >= persistDays) mask.add(key);
	}
	return mask;
}

export const INDUSTRIAL_LABEL = "Industrial heat source";
