/**
 * Which fires belong on screen, measured from the user's ANCHORS (live fix +
 * last touched ground), never the camera. Past HARD_CUTOFF_KM: absent.
 */

import type { FireHotspot } from "./fireCache";

/** Not a number to tune: equals FIRE_RADIUS_KM, since what we download is what we may draw. */
export const HARD_CUTOFF_KM = 500;

/** Great-circle km; a local copy keeps this module dependency-free. */
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

// Distance decides IN or OUT at the wall, nothing else — no fade, no size gate.
export interface RelevantHotspot extends FireHotspot {
	/** km from the NEAREST anchor, not necessarily the user */
	readonly km: number;
}

/** Where you ARE and the ONE place you touched last — more anchors turn the wall back into a continent of dots. */
export const MAX_FIRE_ANCHORS = 2;

/** Closer than this, two anchors' 500 km discs overlap so far the second adds no ground. */
export const ANCHOR_MERGE_KM = 200;

export interface FireAnchorInput {
	readonly at: readonly [number, number];
	/** epoch ms; the live fix passes Infinity */
	readonly touchedAt: number;
}

/** Recency-first, so the last-touched ground always survives the cap. */
export function fireAnchors(
	candidates: readonly FireAnchorInput[],
): Array<readonly [number, number]> {
	const byRecency = [...candidates]
		.filter((c) => Number.isFinite(c.at[0]) && Number.isFinite(c.at[1]))
		.sort((a, b) => b.touchedAt - a.touchedAt);
	const kept: Array<readonly [number, number]> = [];
	for (const c of byRecency) {
		if (kept.length >= MAX_FIRE_ANCHORS) break;
		if (kept.some((k) => distKm(k, c.at) < ANCHOR_MERGE_KM)) continue;
		kept.push(c.at);
	}
	return kept;
}

/** Infinity when there are no anchors. */
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

/** The gate everything the map draws passes through. */
export function relevantHotspots(
	hotspots: readonly FireHotspot[],
	origin: readonly (readonly [number, number])[] | null,
): RelevantHotspot[] {
	// No anchors: nothing rather than everything.
	if (origin === null || origin.length === 0) return [];
	const out: RelevantHotspot[] = [];
	for (const h of hotspots) {
		const km = nearestAnchorKm(h.coordinates, origin);
		if (km >= HARD_CUTOFF_KM) continue;
		out.push({ ...h, km });
	}
	return out;
}

/**
 * The one hotspots → features function; both maps call it, neither stamps
 * properties itself. `hidden` empties the collection so un-hiding is a setData.
 */
export function fireFeatureCollection(opts: {
	readonly hotspots: readonly FireHotspot[];
	readonly origin: readonly (readonly [number, number])[] | null;
	readonly now: number;
	readonly staticMask: ReadonlySet<string>;
	readonly hidden?: boolean;
	/** injected to keep this module free of the cache types */
	readonly toGeoJSON: (
		h: readonly RelevantHotspot[],
	) => GeoJSON.FeatureCollection;
	readonly isStatic: (
		lng: number,
		lat: number,
		mask: ReadonlySet<string>,
	) => boolean;
	/** True means DROPPED, not flagged. Absent keeps everything: a caller without polygons must not silently lose fires. */
	readonly isUrban?: (lng: number, lat: number) => boolean;
}): { fc: GeoJSON.FeatureCollection; shown: RelevantHotspot[] } {
	const empty: GeoJSON.FeatureCollection = {
		type: "FeatureCollection",
		features: [],
	};
	if (opts.hidden === true) return { fc: empty, shown: [] };

	const inRange = relevantHotspots(opts.hotspots, opts.origin);
	const urban = opts.isUrban;
	const shown =
		urban === undefined
			? inRange
			: inRange.filter((h) => !urban(h.coordinates[0], h.coordinates[1]));
	const fc = opts.toGeoJSON(shown);

	for (const f of fc.features) {
		const props = f.properties as Record<string, unknown>;
		// Mapbox has no "now": age is baked in at paint time for the opacity ramp.
		props.ageH = (opts.now - (props.t as number)) / 3_600_000;
		const co = (f.geometry as GeoJSON.Point).coordinates;
		// Flagged, never removed: a refinery genuinely can catch fire.
		props.ind = opts.isStatic(co[0], co[1], opts.staticMask) ? 1 : 0;
	}
	return { fc, shown };
}
