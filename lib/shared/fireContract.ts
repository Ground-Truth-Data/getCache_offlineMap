/** fireContract.ts — fire layer shape. ⚠️ Never re-declare FIRE_RADIUS_KM or the hotspot shape elsewhere; fireCache.ts re-exports these. */

/** Radius, in km, of one fire disc. */
export const FIRE_RADIUS_KM = 500;

/** Hotspots this close are one fire (the Worker merges them). */
export const FIRE_JOIN_KM = 2;

/** The phone holds at most this many fires per disc, the nearest; past it the disc's radius shrinks. */
export const FIRE_MAX_COUNT = 250;

/** Around the user every hotspot shows, not just its fire. */
export const FIRE_NEAR_KM = 20;

/** The Worker sends individual hotspots this far from a disc's centre, so the user can move within it and keep FIRE_NEAR_KM covered. */
export const FIRE_NEAR_SEND_KM = 60;

/** One overpass writes many rows across a few minutes. */
export const PASS_BUCKET_MS = 30 * 60 * 1000;

export type FireConfidence = "low" | "nominal" | "high";

/** One hotspot, trimmed to what the map actually renders. */
export interface FireHotspot {
	/** [lng, lat] — GeoJSON order. */
	readonly coordinates: [number, number];
	/** Acquisition time, UTC epoch ms. Drives the age-colour ramp. */
	readonly t: number;
	readonly c: FireConfidence;
	/** Fire radiative power, MW. */
	readonly frp: number;
	/** Pixel footprint in km; absent when the feed omits it. */
	readonly px?: number;
	/** Day / Night overpass. Night reads are less solar-contaminated. */
	readonly dn?: "D" | "N";
	/** The fire it belongs to: its hottest hotspot's position, "lng,lat" to 5 places. */
	readonly f?: string;
	/** Set only on a merged fire, which stands at its hottest hotspot: how many hotspots it holds. */
	readonly n?: number;
	/** Merged fire: unique VIIRS cells burning. */
	readonly a?: number;
	/** Merged fire: first sighting (`t` is the last). */
	readonly t0?: number;
	/** Merged fire: [pass start ms, peak FRP] per satellite pass, oldest first. */
	readonly p?: readonly (readonly [number, number])[];
}

/** A line around the real hotspots of one fire. */
export interface FireOutline {
	readonly f: string;
	readonly ring: readonly (readonly [number, number])[];
}
