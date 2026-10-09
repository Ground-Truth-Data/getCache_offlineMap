import { kmBetween, type LngLat } from "./kmGeo";
import { FIRE_RADIUS_KM } from "./fireContract";

export const FIRE_COVERAGE_KM = FIRE_RADIUS_KM;

/** ~350 km, four or five hours of driving. */
export const FIRE_TRIGGER_KM = Math.round(FIRE_COVERAGE_KM * 0.7);

/** Two discs' reach — a day's drive stays covered, the far side of the country costs nothing. */
export const FIRE_RELEVANCE_KM = FIRE_COVERAGE_KM * 2;

/** Infinity when there are no centres. */
export function kmToNearest(
	pos: readonly [number, number],
	centres: readonly (readonly [number, number])[],
): number {
	let best = Number.POSITIVE_INFINITY;
	for (const c of centres) {
		const d = kmBetween(pos, c);
		if (d < best) best = d;
	}
	return best;
}

/** Geography only — time-based freshness is fireIsFresh's axis; don't conflate the two. */
export function needsFireDisc(
	pos: readonly [number, number],
	fireCentres: readonly (readonly [number, number])[],
): boolean {
	return kmToNearest(pos, fireCentres) > FIRE_TRIGGER_KM;
}

/** The few centres whose discs cover them all. ⚠️ Blob centres are ~11 m apart
 *  and a fire disc is 500 km, so blob-scale centres MUST come through this
 *  first. Greedy: small and complete, not minimal, and not sorted. */
export function fireDiscCentres(
	centres: readonly (readonly [number, number])[],
): Array<readonly [number, number]> {
	const chosen: Array<readonly [number, number]> = [];
	for (const c of centres) if (needsFireDisc(c, chosen)) chosen.push(c);
	return chosen;
}

/** Drops centres too far from the user to earn a fire disc — without it every
 *  saved map pulls its own disc every TTL. Empty `here` means the position is
 *  unknown, so everything passes rather than silently stopping fires. */
export function fireCentresWorthFetching(
	centres: readonly (readonly [number, number])[],
	here: readonly (readonly [number, number])[],
	reachKm = FIRE_RELEVANCE_KM,
): Array<readonly [number, number]> {
	if (here.length === 0) return [...centres];
	return centres.filter((c) => kmToNearest(c, here) <= reachKm);
}

export function isUsableFix(pos: unknown): pos is LngLat {
	if (!Array.isArray(pos) || pos.length !== 2) return false;
	const [lng, lat] = pos as [number, number];
	return (
		Number.isFinite(lng) &&
		Number.isFinite(lat) &&
		Math.abs(lng) <= 180 &&
		Math.abs(lat) <= 90 &&
		// 0,0 is overwhelmingly a zeroed struct, not a real fix.
		!(lng === 0 && lat === 0)
	);
}
