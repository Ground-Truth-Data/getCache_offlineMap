/** Where a photo's pixels come from: every row whose box holds the pin, in order, then the world row. */

import { latToTileY, lngToTileX } from "../../contract/geo";
import { satelliteTileUrl } from "../../worker/worker-local-dev/tilesHost";
import type { Bounds } from "./satelliteImage";

export interface PhotoSource {
    name: string;
    /** [w, s, e, n] boxes the source covers; empty = everywhere */
    boxes: readonly Bounds[];
    /** the sharpest zoom worth fetching; above it tiles only upsample */
    zoom: number;
    /** canvas width in px across 2 × BAKE_RADIUS_KM */
    canvasPx: number;
    /** WebP quality 0–1 */
    quality: number;
    url(z: number, x: number, y: number): string;
}

// TODO more open-licence aerial rows: Netherlands PDOK, France IGN BD ORTHO, Spain PNOA, swisstopo SWISSIMAGE, Austria basemap.at, Finland NLS, Poland geoportal, Czechia ČÚZK, New Zealand LINZ
export const PHOTO_SOURCES: readonly PhotoSource[] = [
    {
        // NAIP aerial, ~1 m/px, public domain; 404 outside the US.
        name: "USGS",
        boxes: [
            [-125, 24.4, -66.9, 49],
            [-170, 51, -129, 72],
            [-161, 18.5, -154, 22.5],
        ],
        // z16 shows single trees for four times the tiles and twice the photo.
        zoom: 15,
        canvasPx: 1024,
        // Aerial detail compresses worse than satellite blur; 0.6 showed no loss on a phone.
        quality: 0.6,
        url: (z, x, y) =>
            `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
    },
    {
        // MapTiler satellite-v2, paid; the key is the Worker's, so the URL is ours.
        name: "MapTiler",
        boxes: [],
        // The Maxar global floor, at the sharpest zoom MapTiler's own site shows.
        zoom: 17,
        // Not 4096: 4096² is over WebKit's ~16.7 MP canvas ceiling, which bakes blank. 3456² is the most the 12 MP guard below allows.
        canvasPx: 3456,
        // The last encode of pixels nothing will sharpen again.
        quality: 0.92,
        url: (z, x, y) => satelliteTileUrl(z, x, y) ?? "",
    },
    {
        // Sentinel-2 cloudless, 10 m/px, the whole planet; z15 only upsamples.
        name: "EOX",
        boxes: [],
        zoom: 14,
        canvasPx: 1536,
        quality: 0.75,
        url: (z, x, y) =>
            `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`,
    },
];

/** WebKit hands back a blank canvas over ~16.7 MP; 12 leaves room for a non-square crop near the poles. */
const MAX_CANVAS_MP = 12;

for (const src of PHOTO_SOURCES) {
	if ((src.canvasPx * src.canvasPx) / 1e6 > MAX_CANVAS_MP) {
		throw new Error(
			`PhotoSource "${src.name}" asks for ${src.canvasPx}px² (${((src.canvasPx * src.canvasPx) / 1e6).toFixed(1)} MP) — over the ${MAX_CANVAS_MP} MP a phone canvas can hold; it would bake blank.`,
		);
	}
}

/** Adding a sharper row ahead makes every photo behind it stale, re-baking the fleet without a version bump. An unnamed photo predates the registry, so it is never best. */
export function isBestPhotoSource(
    name: string | undefined,
    lng: number,
    lat: number,
): boolean {
    if (name === undefined) return false;
    const rows = photoSourcesFor(lng, lat);
    return rows.length > 0 && rows[0].name === name;
}

/** One tile at the pin before the disc: a boxed row's box is coarser than its coverage (NAIP stops at the border), and a disc it has nothing for is fifty 404s. */
export function photoSourceCovers(src: PhotoSource, lng: number, lat: number): Promise<boolean> {
    if (!src.boxes.length) return Promise.resolve(true);
    const z = src.zoom;
    return fetch(src.url(z, lngToTileX(lng, z), latToTileY(lat, z))).then(
        (r) => r.ok,
        () => false,
    );
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
