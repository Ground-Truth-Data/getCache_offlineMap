/**
 * Follow-me prefetch: how much map is left AHEAD of the person, and whether
 * that calls for a blob. Pure, no DOM.
 *
 * The margin is distance to the nearest EDGE of a blob, not to its centre —
 * a corner sits further from the centre than an edge does, so a centre test
 * fires early on the diagonal and downloads ground nobody is walking into.
 * Every blob is checked, not just the current one, and the largest margin
 * wins: doubling back over covered ground stays deep inside an old blob.
 */

import type { Box } from "./tiles";

/** Fetch while this much map is still ahead — and, more to the point, while there may still be signal. */
export const FOLLOW_MARGIN_KM = 10;
/** Fixes arrive constantly; the maths is worthless on someone standing still. */
export const FOLLOW_STEP_KM = 1;

const KM_PER_DEG = 40075.016686 / 360;

/** Equirectangular — plenty at these distances. */
export function distanceKm(a: [number, number], b: [number, number]): number {
	const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
	const dx = (b[0] - a[0]) * cos;
	const dy = b[1] - a[1];
	return Math.sqrt(dx * dx + dy * dy) * KM_PER_DEG;
}

/** Signed distance to the nearest edge of ONE box: negative outside it. */
export function edgeMarginKm(lng: number, lat: number, b: Box): number {
	const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
	return (
		Math.min((lng - b.w) * cos, (b.e - lng) * cos, lat - b.s, b.n - lat) *
		KM_PER_DEG
	);
}

/** Map left around the person: the best edge margin over every blob. -Infinity with none. */
export function marginKm(lng: number, lat: number, boxes: Box[]): number {
	let best = Number.NEGATIVE_INFINITY;
	for (const b of boxes) best = Math.max(best, edgeMarginKm(lng, lat, b));
	return best;
}

/** Worth evaluating this fix? Only after real movement since the last one. */
export function moved(
	prev: [number, number] | null,
	now: [number, number],
	stepKm = FOLLOW_STEP_KM,
): boolean {
	return prev === null || distanceKm(prev, now) >= stepKm;
}
