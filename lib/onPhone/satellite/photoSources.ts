/**
 * Where a photo's pixels come from. A pin takes every row whose box holds it,
 * in order, then the world row — so a pin always has somewhere to go. The bake
 * tries the rows in turn and moves on when one yields nothing: a pin just over
 * a border gets the next row, never a blank and never a stalled pass.
 *
 * Each row carries its own sharp ceiling and canvas. Above the ceiling the
 * tiles only upsample; the canvas is sized to keep what the source has.
 */

import type { Bounds } from "./satelliteImage";

export interface PhotoSource {
    /** shown in the dock and stored on the photo */
    name: string;
    /** [w, s, e, n] boxes the source covers; empty = everywhere */
    boxes: readonly Bounds[];
    /** the sharpest zoom worth fetching — above it tiles only upsample */
    zoom: number;
    /** canvas width in px across 2 × BAKE_RADIUS_KM */
    canvasPx: number;
    /** WebP quality 0–1; detailed sources need less of it than smooth ones */
    quality: number;
    url(z: number, x: number, y: number): string;
}

export const PHOTO_SOURCES: readonly PhotoSource[] = [
    {
        // USGS Imagery Only: NAIP aerial photography, ~1 m/px, public domain, no key; 404 outside the US.
        name: "USGS",
        // the lower 48 to the 49th parallel, Alaska, Hawaii
        boxes: [
            [-125, 24.4, -66.9, 49],
            [-170, 51, -129, 72],
            [-161, 18.5, -154, 22.5],
        ],
        // z15 is ~2.4 m/px, the same grain as the 1536 canvas, so nothing fetched is thrown away. z16 shows single trees for four times the tiles and twice the photo (1.6 MB down, 325 KB) — not worth it on a phone.
        zoom: 15,
        canvasPx: 1536,
        // aerial detail compresses worse than satellite blur: a city square is 290 KB at 0.75, marsh 28 KB; 0.6 takes a quarter off and the fourth panel of the sheet showed no loss on a phone
        quality: 0.6,
        url: (z, x, y) =>
            `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
    },
    {
        // EOX Sentinel-2 cloudless: 10 m/px, the whole planet. z14 is its sharp ceiling — z15 only upsamples into blur, verified; don't raise it.
        name: "EOX",
        boxes: [],
        zoom: 14,
        canvasPx: 1536,
        quality: 0.75,
        url: (z, x, y) =>
            `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`,
    },
];

/** The rows to try for a pin, in order. Never empty: the world row is always last. */
export function photoSourcesFor(lng: number, lat: number): PhotoSource[] {
    return PHOTO_SOURCES.filter(
        (src) =>
            src.boxes.length === 0 ||
            src.boxes.some(
                ([w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n,
            ),
    );
}
