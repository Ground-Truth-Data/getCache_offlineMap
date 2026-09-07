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
        zoom: 16,
        // 2048 px over 4 km is ~2 m/px: half the source, four times EOX's pixels. Keeping it all needs 4096, a 64 MB canvas in the bake worker.
        canvasPx: 2048,
        url: (z, x, y) =>
            `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
    },
    {
        // EOX Sentinel-2 cloudless: 10 m/px, the whole planet. z14 is its sharp ceiling — z15 only upsamples into blur, verified; don't raise it.
        name: "EOX",
        boxes: [],
        zoom: 14,
        canvasPx: 1536,
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
