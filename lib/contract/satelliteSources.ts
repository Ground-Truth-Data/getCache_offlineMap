/** Every satellite imagery source, read by the tiles Worker, the photo bake and /app/squirrel alike.
 * The id is the URL segment (`/satellite/<id>/z/x/y.jpg`) and heads every R2 key, so a new tileset is a new id. */

export interface SatelliteSource {
	/** shown on the dock and stored on each photo it bakes */
	name: string;
	/** this source's dot on Squirrel and the debugger */
	color: string;
	/** the Worker's request; `key` is the Worker secret named by `secret` */
	tileUrl: (key: string, z: number, x: number, y: number) => string;
	secret?: "GC_mapTiler_key" | "GC_esri_key";
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
	/** where it has imagery, [w, s, e, n]; a source with any wins there over the switched-on one */
	covers?: readonly (readonly [number, number, number, number])[];
	/** streamed only: never kept at the edge, in R2 or in a photo, and never the switched-on source */
	live?: true;
	/** what it gives free each month; the Worker stops serving it at 90% of this */
	freeTilesPerMonth?: number;
}

export const SATELLITE_SOURCES = {
	maptiler: {
		name: "MapTiler",
		color: "#6fb3d9",
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
		licence: "MapTiler Cloud terms; caching in our R2 approved by MapTiler, Oct 2026",
		cacheToR2: true,
		// Flex plan, per 1,000 requests past the included 500k.
		usdPer1000: 0.15,
	},
	sentinel: {
		name: "Sentinel-2 cloudless 2016",
		color: "#7fbf6a",
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
	usgs: {
		name: "USGS National Map imagery",
		color: "oklch(0.72 0.11 300)",
		tileUrl: (_key, z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
		// It lists LODs to 23 but 404s past 16.
		maxZ: 16,
		zoom: 16,
		// 256px tiles at z16 are 864px across the disc; a little over keeps edges soft.
		canvasPx: 1024,
		quality: 0.9,
		attribution: "USGS The National Map: Orthoimagery",
		licence: "US public domain: \"Map services and data downloaded from The National Map are free and in the public domain.\"",
		cacheToR2: true,
		usdPer1000: 0,
		// Kept inside the border: past it USGS answers 404 or blank, and a pin there would bake nothing.
		covers: [
			[-124.4, 32.75, -67.0, 41.3],
			[-104.0, 29.8, -93.5, 32.75],
			[-93.5, 30.5, -75.0, 32.75],
			[-97.3, 24.5, -79.9, 30.5],
			[-124.7, 41.3, -95.2, 48.95],
			[-95.2, 41.3, -89.6, 48.0],
			[-89.6, 41.3, -84.8, 46.3],
			[-84.8, 41.3, -83.2, 45.8],
			[-80.5, 41.3, -73.5, 42.5],
			[-76.0, 42.5, -73.5, 44.0],
			[-73.5, 41.3, -67.8, 44.95],
			[-168.0, 54.5, -141.1, 71.5],
			[-160.3, 18.9, -154.7, 22.3],
			[-67.3, 17.9, -65.2, 18.6],
		],
	},
	esri: {
		name: "Esri World Imagery",
		color: "#d99a3d",
		tileUrl: (key, z, x, y) => `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?token=${key}`,
		secret: "GC_esri_key",
		// z19 is cities only; past 18 the map stretches z18, at a quarter of the billed tiles.
		maxZ: 18,
		// Never baked (`live`); these only satisfy the shape.
		zoom: 17,
		canvasPx: 3456,
		quality: 0.9,
		attribution: "Powered by Esri · Sources: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
		licence: "ArcGIS Location Platform: stream only — \"Customer may not otherwise scrape, download, or store Data.\"",
		cacheToR2: false,
		live: true,
		usdPer1000: 0.15,
		freeTilesPerMonth: 2_000_000,
	},
} satisfies Record<string, SatelliteSource>;

export type SourceId = keyof typeof SATELLITE_SOURCES;

/** What a Worker serves when nobody has switched it; a switch lives in the Worker's R2 bucket. */
export const DEFAULT_SOURCE: SourceId = "maptiler";

export function sourceOf(id: string): SatelliteSource | undefined {
	return (SATELLITE_SOURCES as Record<string, SatelliteSource>)[id];
}

/** The source a photo at `at` bakes from: one that covers the spot, else the switched-on one. */
export function sourceAt([lng, lat]: [number, number], active: string): string {
	return coverOf(lng, lat, lng, lat) ?? active;
}

/** The source whose coverage holds the whole box, if one does. */
export function coverOf(w: number, s: number, e: number, n: number): string | undefined {
	for (const [id, src] of Object.entries(SATELLITE_SOURCES) as [string, SatelliteSource][])
		if (src.covers?.some(([bw, bs, be, bn]) => w >= bw && e <= be && s >= bs && n <= bn)) return id;
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
