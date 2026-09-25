/**
 * ⚠️ Load failures must never be fatal — fall back to coordinates, never break the fire layer.
 * ⚠️ GeoNames tags suburbs plain PPL like towns, so the build drops any sub-MAJOR place within 12 km of a MAJOR city.
 * ⚠️ Lakes/mountains are NOT in this asset — they need a separate allCountries build.
 * ⚠️ The rebuild parses GeoNames cities1000 BY COLUMN INDEX (1=name,4=lat,5=lng,7=feature code,8=country,10=admin1,14=population) — verify against https://download.geonames.org/export/dump/ first.
 */

import { inRegion, regionAround, regionChanged } from "../shared/assetRegion";
import type { PlaceRow } from "./placeReference";

const ASSET_URL = "/mobileAssets/places-world.json";

let cache: PlaceRow[] | null = null;
let inFlight: Promise<PlaceRow[]> | null = null;
let loadedAround: [number, number] | null = null;

/** ⚠️ null keeps every row (heavy but safe) — a WRONG-centred window gives confidently incorrect names, worse than falling back to coordinates. */
let regionCentre: [number, number] | null = null;

/** Call BEFORE loadPlaces/warmPlaces — returns true if an existing load was invalidated (next read re-parses). */
export function setPlacesRegion(centre: [number, number]): boolean {
	regionCentre = centre;
	if (cache === null || !regionChanged(loadedAround, centre)) return false;
	cache = null;
	inFlight = null;
	loadedAround = null;
	return true;
}

export async function loadPlaces(): Promise<PlaceRow[]> {
	if (cache !== null) return cache;
	if (inFlight !== null) return inFlight;
	const centre = regionCentre;
	inFlight = (async () => {
		try {
			const res = await fetch(ASSET_URL);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const rows = (await res.json()) as PlaceRow[];
			if (!Array.isArray(rows)) throw new Error("gazetteer is not an array");
			cache =
				centre === null
					? rows
					: (() => {
							const box = regionAround(centre);
							return rows.filter((r) =>
								inRegion(box, Number(r[1]), Number(r[2])),
							);
						})();
			loadedAround = centre;
			return cache;
		} catch (err) {
			// codestyle-allow-swallow: console.warn below is the visible signal, not a swallow.
			console.warn("[fire] place gazetteer unavailable — using coordinates", err);
			cache = [];
			return cache;
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}

export function peekPlaces(): PlaceRow[] | null {
	return cache;
}

/** Call when a fire layer attaches so the first tap has names ready. */
export function warmPlaces(): void {
	if (cache === null && inFlight === null) void loadPlaces();
}

/** Test seam. */
export function __resetPlacesForTest(): void {
	cache = null;
	inFlight = null;
}
