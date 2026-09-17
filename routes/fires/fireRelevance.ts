/**
 * fireRelevance.ts — WHICH fires belong on screen, measured from the USER's ANCHORS (live fix + recently touched ground), never the map camera.
 * ⛔ Past HARD_CUTOFF_KM from every anchor: NOTHING renders. Not faded, not clustered — absent. Hard promise, not a tunable.
 */

import type { FireHotspot } from "./fireCache";

/** ⛔ THE HARD WALL — past this from every anchor, nothing renders, ever. Not a number to tune; deliberately equals FIRE_RADIUS_KM (what we download is what we may draw). */
export const HARD_CUTOFF_KM = 500;

/** Great-circle km. Local copy keeps this module dependency-free. */
export function distKm(
	a: readonly [number, number],
	b: readonly [number, number],
): number {
	const R = 6371;
	const toRad = Math.PI / 180;
	const dLat = (b[1] - a[1]) * toRad;
	const dLng = (b[0] - a[0]) * toRad;
	const s =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * ⛔ DELETED: `prominenceAt` (distance fade) and `frpGateAt` (size-vs-distance
 * ramp) — do not bring either back. Both made a real detection less than real
 * because of where it sat: the ramp demanded 25 MW at the wall, and VIIRS
 * 375 m reports grass and crop fires at 1–10 MW, so a 5 MW fire vanished past
 * 140 km while a big one 380 km away still drew. Distance decides IN or OUT at
 * the wall, and nothing else; opacity carries only AGE and the industrial flag.
 */

export interface RelevantHotspot extends FireHotspot {
	/** km from the NEAREST anchor (see `fireAnchors`) — not necessarily the user. */
	readonly km: number;
}

/**
 * ⛔ TWO anchors, never more: where you ARE, and the ONE place you touched last.
 *
 * This was 3, paired with a caller that fed every feature touched in 30 days.
 * That is the Winnemucca bug — 48 blobs across seven states, so a pin in Utah
 * touched two days ago held a slot and admitted a fire 1,300 km from the user.
 * Enough anchors turn the wall back into the continent-of-dots it exists to kill,
 * and "recently" is not the rule: the LAST touched thing is.
 *
 * ANCHOR_MERGE_KM still collapses the two when they are effectively one place
 * (you are standing on the block you last touched).
 */
export const MAX_FIRE_ANCHORS = 2;

/** Anchors closer together than this collapse into one — their 500km discs overlap so far the second adds no ground, only cost. */
export const ANCHOR_MERGE_KM = 200;

/** A place the user has a stake in, newest-touched first. */
export interface FireAnchorInput {
	readonly at: readonly [number, number];
	/** epoch ms; larger = more recently touched. The live fix passes Infinity. */
	readonly touchedAt: number;
}

/** Reduce candidate anchors to the set the fire layer measures from — ordered by recency, so the last-touched ground always survives the cap. */
export function fireAnchors(
	candidates: readonly FireAnchorInput[],
): Array<readonly [number, number]> {
	const byRecency = [...candidates]
		.filter((c) => Number.isFinite(c.at[0]) && Number.isFinite(c.at[1]))
		.sort((a, b) => b.touchedAt - a.touchedAt);
	const kept: Array<readonly [number, number]> = [];
	for (const c of byRecency) {
		if (kept.length >= MAX_FIRE_ANCHORS) break;
		// Near an anchor we already kept? Same place, in practice.
		if (kept.some((k) => distKm(k, c.at) < ANCHOR_MERGE_KM)) continue;
		kept.push(c.at);
	}
	return kept;
}

/** km from the nearest anchor, or Infinity when there are none. */
export function nearestAnchorKm(
	at: readonly [number, number],
	anchors: readonly (readonly [number, number])[],
): number {
	let best = Number.POSITIVE_INFINITY;
	for (const a of anchors) {
		const km = distKm(a, at);
		if (km < best) best = km;
	}
	return best;
}

/** THE gate — everything the map draws passes through here. Survives if inside the wall of ANY anchor; distance-derived properties measured from the NEAREST one. */
export function relevantHotspots(
	hotspots: readonly FireHotspot[],
	origin: readonly (readonly [number, number])[] | null,
): RelevantHotspot[] {
	// no anchors at all: show nothing rather than everything — a continent of dots is worse than an empty layer
	if (origin === null || origin.length === 0) return [];
	const out: RelevantHotspot[] = [];
	for (const h of hotspots) {
		const km = nearestAnchorKm(h.coordinates, origin);
		// THE WALL — from the nearest anchor. The only test there is.
		if (km >= HARD_CUTOFF_KM) continue;
		out.push({ ...h, km });
	}
	return out;
}

/**
 * THE ONE hotspots → map-features function — both maps call this; neither stamps properties itself.
 * ⛔ Do NOT stamp feature properties at a call site — put it here, or the two maps drift again (as `ind` once did, landing on only one).
 * `hidden` empties the collection rather than removing the layers — flipping it back on is a setData, never a re-add.
 */
export function fireFeatureCollection(opts: {
	readonly hotspots: readonly FireHotspot[];
	/** The anchor SET — see `fireAnchors`. Empty/null draws nothing. */
	readonly origin: readonly (readonly [number, number])[] | null;
	/** Now, in epoch ms — injected so the age stamp is testable. */
	readonly now: number;
	/** Persistent-heat-source cell mask; empty set = nothing flagged. */
	readonly staticMask: ReadonlySet<string>;
	/** Legend toggle OFF → paint an empty collection. */
	readonly hidden?: boolean;
	/** Hotspot → GeoJSON, injected to keep this module free of the cache types. */
	readonly toGeoJSON: (
		h: readonly RelevantHotspot[],
	) => GeoJSON.FeatureCollection;
	/** Cell-mask lookup, injected for the same reason. */
	readonly isStatic: (
		lng: number,
		lat: number,
		mask: ReadonlySet<string>,
	) => boolean;
	/** "Is this in a city?" — injected. True means DROPPED, not flagged (every wildfire agency map leaves the built-up basin empty). Default: keep everything — a caller without polygons must not silently lose fires. */
	readonly isUrban?: (lng: number, lat: number) => boolean;
}): { fc: GeoJSON.FeatureCollection; shown: RelevantHotspot[] } {
	const empty: GeoJSON.FeatureCollection = {
		type: "FeatureCollection",
		features: [],
	};
	if (opts.hidden === true) return { fc: empty, shown: [] };

	const inRange = relevantHotspots(opts.hotspots, opts.origin);
	// ⛔ CITY RULE — drop, don't flag. See the `isUrban` doc above.
	const urban = opts.isUrban;
	const shown =
		urban === undefined
			? inRange
			: inRange.filter((h) => !urban(h.coordinates[0], h.coordinates[1]));
	const fc = opts.toGeoJSON(shown);

	for (const f of fc.features) {
		const props = f.properties as Record<string, unknown>;
		// Mapbox has no concept of "now" — age is baked in at paint time for the opacity ramp
		props.ageH = (opts.now - (props.t as number)) / 3_600_000;
		const co = (f.geometry as GeoJSON.Point).coordinates;
		// industrial sources are FLAGGED, never removed — a refinery genuinely can catch fire; deleting would mean the app says nothing on the day it does
		props.ind = opts.isStatic(co[0], co[1], opts.staticMask) ? 1 : 0;
	}
	return { fc, shown };
}
