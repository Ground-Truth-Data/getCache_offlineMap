/** Every satellite imagery source, read by the tiles Worker, the photo bake and /app/squirrel alike.
 * The id is the URL segment (`/satellite/<id>/z/x/y.jpg`) and heads every R2 key, so a new tileset is a new id. */

export interface SatelliteSource {
	/** shown on the dock and stored on each photo it bakes */
	name: string;
	/** the Worker's request; `key` is the Worker secret named by `secret` */
	tileUrl: (key: string, z: number, x: number, y: number) => string;
	secret?: "GC_mapTiler_key";
	/** past this the source has nothing sharper; the Worker refuses */
	maxZ: number;
	/** the zoom a photo is baked from */
	zoom: number;
	/** canvas width in px across the photo's disc */
	canvasPx: number;
	/** WebP quality 0–1 */
	quality: number;
	/** shown on the map whenever its pixels are */
	attribution: string;
	licence: string;
	/** keep each tile in the shared R2 bucket */
	cacheToR2: boolean;
	/** what the source charges per 1,000 tiles fetched from it */
	usdPer1000: number;
}

export const SATELLITE_SOURCES = {
	maptiler: {
		name: "MapTiler",
		// satellite-v2 is already 512px, so @2x 404s.
		tileUrl: (key, z, x, y) => `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}.jpg?key=${key}`,
		secret: "GC_mapTiler_key",
		// Its pyramid thins out past z20 outside cities.
		maxZ: 20,
		// The Maxar global floor, at the sharpest zoom MapTiler's own site shows.
		zoom: 17,
		// Not 4096: 4096² is over WebKit's ~16.7 MP canvas ceiling, which bakes blank.
		canvasPx: 3456,
		quality: 0.92,
		attribution: "© MapTiler © Maxar",
		licence: "MapTiler Cloud terms: per-request, no server-side caching without a contract",
		cacheToR2: true,
		// Flex plan, per 1,000 requests past the included 500k.
		usdPer1000: 0.15,
	},
	sentinel: {
		name: "Sentinel-2 cloudless 2016",
		// EOX's unyeared layer is the 2016 mosaic, the only one under CC BY; 2017 on are non-commercial.
		tileUrl: (_key, z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
		maxZ: 15,
		// 10 m pixels: z14 is the last zoom with new detail.
		zoom: 14,
		canvasPx: 512,
		quality: 0.9,
		attribution: "Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)",
		licence: "CC BY 4.0",
		cacheToR2: false,
		usdPer1000: 0,
	},
} satisfies Record<string, SatelliteSource>;

export type SourceId = keyof typeof SATELLITE_SOURCES;

/** What a Worker serves when nobody has switched it; a switch lives in the Worker's R2 bucket. */
export const DEFAULT_SOURCE: SourceId = "maptiler";

export function sourceOf(id: string): SatelliteSource | undefined {
	return (SATELLITE_SOURCES as Record<string, SatelliteSource>)[id];
}

/** The source a photo names on disk, by its stored name. */
export function sourceNamed(name: string | undefined): SatelliteSource | undefined {
	return Object.values(SATELLITE_SOURCES).find((s) => s.name === name);
}

/** WebKit hands back a blank canvas over ~16.7 MP; 12 leaves room for a non-square crop near the poles. */
const MAX_CANVAS_MP = 12;
for (const src of Object.values(SATELLITE_SOURCES) as SatelliteSource[])
	if ((src.canvasPx * src.canvasPx) / 1e6 > MAX_CANVAS_MP)
		throw new Error(`Satellite source "${src.name}" asks for a ${src.canvasPx}px² canvas, over the ${MAX_CANVAS_MP} MP a phone can hold; it would bake blank.`);
