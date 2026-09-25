// ⛔ Write no number here: these must stay aliases of blob.ts's; two disagreeing zoom lists silently blank the map.

import { GRID_RADIUS_KM, BLOB_ZOOMS as V5_ZOOMS } from "./blob";

/** ⛔ One radius at every zoom — a second reads as a shape appearing and vanishing across zooms. */
export const BLOB_RADIUS_KM: number = GRID_RADIUS_KM;

/** z14 is deliberately absent (z13 overzooms to cover it). ⛔ Changing a level changes what the Worker packs and the renderer requests — bump PACK_FORMAT_VERSION. */
export const BLOB_ZOOMS: readonly number[] = V5_ZOOMS;

export const BLOB_MAX_Z = Math.max(...BLOB_ZOOMS);
export const BLOB_MIN_Z = Math.min(...BLOB_ZOOMS);

/** ⚠️ never claim a zoom the blob doesn't hold — a wider-than-pack zoom span makes MapLibre 404 and blanks the map silently. */
export function blobHasZoom(z: number): boolean {
	return (BLOB_ZOOMS as readonly number[]).includes(z);
}

export function tileWidthKm(z: number, lat: number): number {
	return (40075.016686 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}
