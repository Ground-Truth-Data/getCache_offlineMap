/** Loads the world urban polygons lazily, once, and never fatally: a failed load shows every fire. */

import { type RegionBox, regionAround, regionChanged } from "../../../lib/shared/assetRegion";
import { prepareUrban, type UrbanPoly } from "./urbanExclusion";

const ASSET_URL = "/mobileAssets/worldBase/base/min/urban.json";

let cache: UrbanPoly[] | null = null;
let inFlight: Promise<UrbanPoly[]> | null = null;
let loadedAround: [number, number] | null = null;

/** Unset keeps the whole world: a wrongly windowed asset silently stops excluding city hotspots. */
let regionCentre: [number, number] | null = null;

/** Call before `loadUrban`/`warmUrban`. True when this invalidated an existing load. */
export function setUrbanRegion(centre: [number, number]): boolean {
	regionCentre = centre;
	if (cache === null || !regionChanged(loadedAround, centre)) return false;
	cache = null;
	inFlight = null;
	loadedAround = null;
	return true;
}

export async function loadUrban(): Promise<UrbanPoly[]> {
	if (cache !== null) return cache;
	if (inFlight !== null) return inFlight;
	const centre = regionCentre;
	inFlight = (async () => {
		try {
			const res = await fetch(ASSET_URL);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const fc = (await res.json()) as { features?: unknown[] };
			if (!Array.isArray(fc?.features)) throw new Error("no features");
			const box: RegionBox | null = centre ? regionAround(centre) : null;
			cache = prepareUrban(
				fc.features as { geometry: { type: string; coordinates: unknown } }[],
				box,
			);
			loadedAround = centre;
			return cache;
		} catch (err) {
			// codestyle-allow-swallow: console.warn below is the visible signal; fails OPEN — fires still show.
			console.warn(
				"[fire] urban polygons unavailable — city hotspots will not be excluded",
				err,
			);
			cache = [];
			return cache;
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}

/** Empty before the load, which excludes nothing. */
export function peekUrban(): UrbanPoly[] {
	return cache ?? [];
}

export function warmUrban(): void {
	if (cache === null && inFlight === null) void loadUrban();
}

export function __resetUrbanForTest(): void {
	cache = null;
	inFlight = null;
}
