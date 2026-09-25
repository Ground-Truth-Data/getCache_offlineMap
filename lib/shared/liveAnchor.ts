// ⚠️ Live position must pass containment before reaching note() — raw ~4-decimal fixes mint a new area (photo + fire fetch) every ~11 m step.
// ⚠️ Measure distance from nearest COVERAGE, never distance moved: that re-fires on a loop back inside coverage and never fires on a slow drift.
import { kmBetween, type LngLat } from "./kmGeo";
import { BLOB_RADIUS_KM } from "../contract/roadBlob";
import { BAKE_RADIUS_KM } from "../onPhone/satellite/satelliteImage";
import { FIRE_RADIUS_KM } from "./fireContract";

/** ⛔ Never a literal — BLOB_RADIUS_KM owns the one road radius. Not what MAP_TRIGGER_KM is measured against. */
export const MAP_COVERAGE_KM = BLOB_RADIUS_KM;

/** "Covered" means the satellite photo, not the wider road disc — measuring against the road ring left users covered while looking at blank ground. */
export const PHOTO_COVERAGE_KM = BAKE_RADIUS_KM;

/** 75% of the photo radius — a containment test, not a distance-moved test. */
export const MAP_TRIGGER_KM = PHOTO_COVERAGE_KM * 0.75;

export const FIRE_COVERAGE_KM = FIRE_RADIUS_KM;

/** ~350 km, four or five hours of driving. */
export const FIRE_TRIGGER_KM = Math.round(FIRE_COVERAGE_KM * 0.7);

/** Two discs' reach — a day's drive stays covered, the far side of the country costs nothing. */
export const FIRE_RELEVANCE_KM = FIRE_COVERAGE_KM * 2;

/** Infinity when there are no centres, so the first fix always triggers a bake. */
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

/** centres includes feature anchors — a planter beside their own pin must not mint a second blob 11 m away. */
export function needsMapBlob(
	pos: LngLat,
	centres: readonly LngLat[],
): boolean {
	return kmToNearest(pos, centres) > MAP_TRIGGER_KM;
}

/** Geography only — time-based freshness is fireIsFresh's axis; don't conflate the two. */
export function needsFireDisc(
	pos: readonly [number, number],
	fireCentres: readonly (readonly [number, number])[],
): boolean {
	return kmToNearest(pos, fireCentres) > FIRE_TRIGGER_KM;
}

/**
 * The few centres whose discs cover them all.
 * ⚠️ Blob centres are ~11 m apart and a fire disc is 500 km, so blob-scale
 * centres handed to a disc-scale pass MUST come through this first.
 *
 * Greedy: small and complete, not minimal, and not sorted.
 */
export function fireDiscCentres(
	centres: readonly (readonly [number, number])[],
): Array<readonly [number, number]> {
	const chosen: Array<readonly [number, number]> = [];
	for (const c of centres) if (needsFireDisc(c, chosen)) chosen.push(c);
	return chosen;
}

/**
 * Drops centres too far from the user to earn a fire disc — without it every
 * saved map pulls its own disc every TTL.
 * Empty `here` means the position is unknown: everything passes, or a GPS
 * outage would silently stop fires.
 */
export function fireCentresWorthFetching(
	centres: readonly (readonly [number, number])[],
	here: readonly (readonly [number, number])[],
	reachKm = FIRE_RELEVANCE_KM,
): Array<readonly [number, number]> {
	if (here.length === 0) return [...centres];
	return centres.filter((c) => kmToNearest(c, here) <= reachKm);
}

/** A coarse (~0.25°) area key for a moving point — never satImageKey, which is 4-decimal. */
export function snapLiveAnchor(pos: LngLat): LngLat {
	const step = 0.25;
	// + 0 turns -0 into 0, or a coordinate near Greenwich could occupy two cells.
	const snap = (n: number): number => Math.round(n / step) * step + 0;
	return [snap(pos[0]), snap(pos[1])];
}

export function isUsableFix(pos: unknown): pos is LngLat {
	if (!Array.isArray(pos) || pos.length !== 2) return false;
	const [lng, lat] = pos as number[];
	return (
		Number.isFinite(lng) &&
		Number.isFinite(lat) &&
		Math.abs(lng) <= 180 &&
		Math.abs(lat) <= 90 &&
		// 0,0 is overwhelmingly a zeroed struct, not a real fix.
		!(lng === 0 && lat === 0)
	);
}
