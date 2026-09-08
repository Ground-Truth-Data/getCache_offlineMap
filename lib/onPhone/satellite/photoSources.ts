/**
 * Where a photo's pixels come from. A pin takes every row whose box holds it,
 * in order, then the world row — so a pin always has somewhere to go. The bake
 * tries the rows in turn and moves on when one yields nothing: a pin just over
 * a border gets the next row, never a blank and never a stalled pass.
 *
 * Each row carries its own sharp ceiling and canvas. Above the ceiling the
 * tiles only upsample; the canvas is sized to keep what the source has.
 */

import { satelliteTileUrl } from "../../worker/worker-local-dev/tilesHost";
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

// TODO more rows, all open-licence aerial orthophotos, keyless unless noted:
// Netherlands PDOK (CC0, 8 cm) · France IGN BD ORTHO (20 cm) · Spain PNOA (25 cm)
// · Switzerland swisstopo SWISSIMAGE (10 cm) · Austria basemap.at · Finland NLS
// (free key) · Poland geoportal · Czechia ČÚZK · New Zealand LINZ (free key).
// Canada has none nationally; BC is a patchy WMS. Each is one row plus a probe
// of its tile scheme and a box. Parked 7 Sep 2026.
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
        // z15 is ~2.4 m/px; z16 shows single trees for four times the tiles and twice the photo (1.6 MB down, 325 KB) — not worth it on a phone.
        zoom: 15,
        // 1024 over 4 km is 3.9 m/px, softer than the source but still 2.5× the satellite's grain, and ~60% smaller than 1536 (a city square 290 KB → ~110 KB).
        canvasPx: 1024,
        // aerial detail compresses worse than satellite blur: a city square is 290 KB at 0.75, marsh 28 KB; 0.6 takes a quarter off and the fourth panel of the sheet showed no loss on a phone
        quality: 0.6,
        url: (z, x, y) =>
            `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
    },
    {
        // MapTiler satellite-v2: 1–2 m/px worldwide (Maxar), down to 8 cm where a
        // country's aerial survey exists. Paid, per-account; the key is the
        // Worker's, so the URL below is ours and never api.maptiler.com.
        name: "MapTiler",
        boxes: [],
        // z16 is ~1.2 m/px at 45° — the Maxar global floor. Deeper only upsamples
        // outside the countries with aerial cover, and z17 needs ~515 tiles per
        // photo: over the 400 bake cap AND 3.5x the paid sessions.
        zoom: 16,
        // 3072 keeps ~1.5x what 2048 did (which threw away two thirds of the
        // detail the z16 tiles carry and read as blur next to MapTiler's viewer).
        // Not 4096: 4096² is 16.8 MP, over WebKit's ~16.7 MP canvas ceiling, and
        // the phone answers an oversized canvas with a blank photo, not an error.
        canvasPx: 3072,
        // 0.82, not 0.7: this is the LAST encode of pixels nothing will sharpen
        // again, so the usual "detail hides artefacts" logic runs backwards here.
        quality: 0.82,
        url: (z, x, y) => satelliteTileUrl(z, x, y) ?? "",
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

/**
 * WebKit refuses a canvas over ~16.7 megapixels, and refuses it by handing back a
 * blank one — a row asking for more yields no photo at all, on phones only. 12 MP
 * leaves room for the non-square crop a pin near the poles produces.
 */
const MAX_CANVAS_MP = 12;

for (const src of PHOTO_SOURCES) {
	if ((src.canvasPx * src.canvasPx) / 1e6 > MAX_CANVAS_MP) {
		throw new Error(
			`PhotoSource "${src.name}" asks for ${src.canvasPx}px² (${((src.canvasPx * src.canvasPx) / 1e6).toFixed(1)} MP) — over the ${MAX_CANVAS_MP} MP a phone canvas can hold; it would bake blank.`,
		);
	}
}

/**
 * Is a photo already from the best row available where it sits? A stored photo
 * names the row that drew it, so adding a sharper row ahead of that one makes
 * every photo behind it stale — which is what re-bakes the fleet onto new
 * imagery without a sweep or a version bump.
 *
 * An unnamed photo predates the registry (EOX-only), so it is never best.
 */
export function isBestPhotoSource(
    name: string | undefined,
    lng: number,
    lat: number,
): boolean {
    if (name === undefined) return false;
    const rows = photoSourcesFor(lng, lat);
    return rows.length > 0 && rows[0].name === name;
}

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
