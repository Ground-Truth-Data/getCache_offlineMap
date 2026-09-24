/**
 * Follow-me prefetch: how much map is left ahead of the person. The margin is distance to the
 * nearest EDGE of a blob, not its centre, or a centre test fires early on the diagonal.
 * The largest margin over every blob wins, so doubling back stays deep inside an old blob.
 */

import type { Box } from "./tiles";

export const FOLLOW_MARGIN_KM = 10;
export const FOLLOW_STEP_KM = 1;

const KM_PER_DEG = 40075.016686 / 360;

export function distanceKm(a: [number, number], b: [number, number]): number {
	const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
	const dx = (b[0] - a[0]) * cos;
	const dy = b[1] - a[1];
	return Math.sqrt(dx * dx + dy * dy) * KM_PER_DEG;
}

/** Negative outside the box. */
export function edgeMarginKm(lng: number, lat: number, b: Box): number {
	const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
	return (
		Math.min((lng - b.w) * cos, (b.e - lng) * cos, lat - b.s, b.n - lat) *
		KM_PER_DEG
	);
}

/** -Infinity with no blobs. */
export function marginKm(lng: number, lat: number, boxes: Box[]): number {
	let best = Number.NEGATIVE_INFINITY;
	for (const b of boxes) best = Math.max(best, edgeMarginKm(lng, lat, b));
	return best;
}

export function moved(
	prev: [number, number] | null,
	now: [number, number],
	stepKm = FOLLOW_STEP_KM,
): boolean {
	return prev === null || distanceKm(prev, now) >= stepKm;
}
