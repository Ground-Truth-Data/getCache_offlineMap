/** Where a photo's pixels come from. MapTiler only: it is paid for, and a free row behind it only ever baked a blurrier photo. */

import { satelliteTileUrl } from "../../worker/worker-local-dev/tilesHost";

export interface PhotoSource {
    name: string;
    /** the sharpest zoom worth fetching; above it tiles only upsample */
    zoom: number;
    /** canvas width in px across 2 × BAKE_RADIUS_KM */
    canvasPx: number;
    /** WebP quality 0–1 */
    quality: number;
    url(z: number, x: number, y: number): string;
}

export const PHOTO_SOURCES: readonly PhotoSource[] = [
    {
        // MapTiler satellite-v2, paid; the key is the Worker's, so the URL is ours.
        name: "MapTiler",
        // The Maxar global floor, at the sharpest zoom MapTiler's own site shows.
        zoom: 17,
        // Not 4096: 4096² is over WebKit's ~16.7 MP canvas ceiling, which bakes blank. 3456² is the most the 12 MP guard below allows.
        canvasPx: 3456,
        // The last encode of pixels nothing will sharpen again.
        quality: 0.92,
        url: (z, x, y) => satelliteTileUrl(z, x, y) ?? "",
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

/** A photo drawn by any other source (or unnamed, predating the registry) is stale and re-bakes. */
export function isBestPhotoSource(name: string | undefined): boolean {
    return name === PHOTO_SOURCES[0].name;
}
