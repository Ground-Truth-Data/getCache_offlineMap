/** Driving a route: where a GPS fix sits on the line, which way it is heading, and when it has left the road. Pure. */

import type { LngLat } from "../shared/kmGeo";

const R = 6_371_000;
const RAD = Math.PI / 180;
/** Further than this from the line counts as off it — z13 roads sit within ~2 m of the real one. */
export const OFF_ROUTE_M = 50;
/** Fixes in a row off the line before re-routing; one bad fix is GPS noise, not a wrong turn. */
export const OFF_ROUTE_FIXES = 3;
export const ARRIVED_M = 30;
/** Below this between fixes the heading is noise, so the last one holds. */
const MOVED_M = 5;
/** A forward segment within this of the nearest wins, so an out-and-back spur never jumps to the way back. */
const FORWARD_SLACK_M = 15;

/** Metres east/north of `o` — flat-earth, fine across one segment. */
function en(o: LngLat, p: LngLat): [number, number] {
	return [(p[0] - o[0]) * RAD * R * Math.cos(o[1] * RAD), (p[1] - o[1]) * RAD * R];
}

export function metresBetween(a: LngLat, b: LngLat): number {
	return Math.hypot(...en(a, b));
}

/** Running distance to each vertex; the last is the route's length. */
export function metresAlong(line: readonly LngLat[]): number[] {
	const out = [0];
	for (let i = 1; i < line.length; i++) out.push(out[i - 1] + metresBetween(line[i - 1], line[i]));
	return out;
}

export interface Progress {
	readonly snapped: LngLat;
	readonly offM: number;
	/** Start vertex of the segment the fix sits on. */
	readonly index: number;
	readonly toGoM: number;
}

/** The fix's place on the line, preferring segments at or after `from`. */
export function progressOn(line: readonly LngLat[], along: readonly number[], at: LngLat, from = 0): Progress {
	let best: Progress | null = null;
	let ahead: Progress | null = null;
	for (let i = 1; i < line.length; i++) {
		const a = line[i - 1];
		const [bx, by] = en(a, line[i]);
		const [px, py] = en(a, at);
		const len2 = bx * bx + by * by || 1;
		const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
		const offM = Math.hypot(px - t * bx, py - t * by);
		const p: Progress = {
			snapped: [a[0] + t * (line[i][0] - a[0]), a[1] + t * (line[i][1] - a[1])],
			offM,
			index: i - 1,
			toGoM: along[along.length - 1] - (along[i - 1] + t * (along[i] - along[i - 1])),
		};
		if (!best || offM < best.offM) best = p;
		if (i - 1 >= from && (!ahead || offM < ahead.offM)) ahead = p;
	}
	if (!best) return { snapped: line[0], offM: metresBetween(line[0], at), index: 0, toGoM: 0 };
	return ahead && ahead.offM <= best.offM + FORWARD_SLACK_M ? ahead : best;
}

/** Compass bearing a→b in degrees, or null when the move is too small to trust. */
export function courseDeg(a: LngLat, b: LngLat): number | null {
	const [x, y] = en(a, b);
	if (Math.hypot(x, y) < MOVED_M) return null;
	return (Math.atan2(x, y) / RAD + 360) % 360;
}
