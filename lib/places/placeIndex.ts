/**
 * ⚠️ Load failures must never be fatal — fall back to coordinates, never break the fire layer.
 * ⚠️ GeoNames tags suburbs plain PPL like towns, so the build drops any sub-MAJOR place within 12 km of a MAJOR city.
 * ⚠️ Lakes/mountains are NOT in this asset — they need a separate allCountries build.
 * ⚠️ The rebuild parses GeoNames cities1000 BY COLUMN INDEX (1=name,4=lat,5=lng,7=feature code,8=country,10=admin1,14=population) — verify against https://download.geonames.org/export/dump/ first.
 */

import { type RegionBox, inRegion, regionAround, regionChanged } from "../shared/assetRegion";
import type { PlaceRow } from "./placeReference";

// The gazetteer ships as 15-degree cells, `<col>_<row>.json` (col = floor((lng+180)/15), row = floor((lat+90)/15)); only the cells under the region window are fetched.
const CELL_DEG = 15;

function cellUrlsIn(box: RegionBox): string[] {
	const index = (deg: number, offset: number, last: number) =>
		Math.min(last, Math.max(0, Math.floor((deg + offset) / CELL_DEG)));
	const urls: string[] = [];
	for (let c = index(box.w, 180, 23); c <= index(box.e, 180, 23); c++)
		for (let r = index(box.s, 90, 11); r <= index(box.n, 90, 11); r++)
			urls.push(`/mobileAssets/places/${c}_${r}.json`);
	return urls;
}

let cache: PlaceRow[] | null = null;
let inFlight: Promise<PlaceRow[]> | null = null;
let loadedAround: [number, number] | null = null;

/** ⚠️ Without a centre nothing loads — a WRONG-centred window gives confidently incorrect names, worse than falling back to coordinates. */
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
			if (centre === null) throw new Error("no region set");
			const box = regionAround(centre);
			const cells = await Promise.all(
				cellUrlsIn(box).map(async (url) => {
					const res = await fetch(url);
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					return (await res.json()) as PlaceRow[];
				}),
			);
			cache = cells.flat().filter((r) => inRegion(box, Number(r[1]), Number(r[2])));
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
