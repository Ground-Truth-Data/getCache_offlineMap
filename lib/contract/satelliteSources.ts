/** Every satellite imagery source — each one's licence lets us keep its tiles, so the map draws only what the phone holds. Read by the tiles Worker, the photo bake and /app/squirrel alike.
 * The id is the URL segment (`/satellite/<id>/z/x/y.jpg`) and heads every R2 key, so a new tileset is a new id. */

export interface SatelliteSource {
	/** shown on the dock and stored on each photo it bakes */
	name: string;
	/** this source's dot on Squirrel and the debugger */
	color: string;
	/** the Worker's request; `key` is the Worker secret named by `secret` */
	tileUrl: (key: string, z: number, x: number, y: number) => string;
	secret?: "GC_mapTiler_key";
	/** past this the source has nothing sharper; the Worker refuses */
	maxZ: number;
	/** a tile's width in px when not 256; a map told the wrong size asks one zoom too deep */
	tilePx?: 512;
	/** the zoom a held area's close tiles are kept at */
	zoom: number;
	/** HTML for the map's ⓘ, shown whenever its pixels are: each provider's own wording and links */
	attribution: string;
	licence: string;
	/** keep each tile in the shared R2 bucket */
	cacheToR2: boolean;
	/** what the source charges per 1,000 tiles fetched from it */
	usdPer1000: number;
	/** where it has imagery, [w, s, e, n]; a source with any wins there over the switched-on one */
	covers?: readonly (readonly [number, number, number, number])[];
	/** what Squirrel calls the ground its `covers` box in */
	region?: string;
}

export const SATELLITE_SOURCES = {
	maptiler: {
		name: "MapTiler",
		color: "#6fb3d9",
		// satellite-v2 is already 512px, so @2x 404s.
		tileUrl: (key, z, x, y) => `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}.jpg?key=${key}`,
		secret: "GC_mapTiler_key",
		maxZ: 20,
		tilePx: 512,
		// Outside cities Maxar's real detail ends here; z17 is the same picture at 4x the tiles.
		zoom: 16,
		attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
		licence: "MapTiler Cloud terms; approved for R2",
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
		attribution: '<a href="https://cloudless.eox.at" target="_blank">&copy; EOX</a> · modified Copernicus Sentinel 2016',
		licence: "CC BY 4.0",
		cacheToR2: true,
		usdPer1000: 0,
	},
	usgs: {
		name: "USGS National Map imagery",
		color: "oklch(0.72 0.11 300)",
		tileUrl: (_key, z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
		// It lists LODs to 23 but 404s past 16.
		maxZ: 16,
		zoom: 16,
		attribution: 'The National Map orthoimagery courtesy of the <a href="https://www.usgs.gov/" target="_blank">U.S. Geological Survey</a>',
		licence: "US public domain: \"Map services and data downloaded from The National Map are free and in the public domain.\"",
		cacheToR2: true,
		usdPer1000: 0,
		region: "United States",
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
	nsw: {
		name: "NSW Spatial Services imagery",
		color: "oklch(0.75 0.13 60)",
		tileUrl: (_key, z, x, y) => `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/${z}/${y}/${x}`,
		// Cities go to z21; the bush 404s past z18.
		maxZ: 18,
		zoom: 18,
		attribution: '&copy; State of New South Wales (<a href="https://www.spatial.nsw.gov.au/" target="_blank">Spatial Services, DCS</a>)',
		// Some NSW sheets say BY-ND: we keep and serve the bytes unaltered, which ND allows.
		licence: "CC BY 4.0: \"Data accessed through these Web Services are subject to a Creative Commons Attribution By Licence\"",
		cacheToR2: true,
		usdPer1000: 0,
		region: "New South Wales",
		covers: [
			[141.1, -33.9, 148.9, -29.1],
			[144.5, -35.5, 150.0, -33.9],
			[150.0, -34.9, 150.85, -33.9],
			[149.0, -33.9, 151.2, -29.1],
			[151.2, -32.5, 152.4, -29.2],
		],
	},
	ign: {
		name: "IGN BD ORTHO",
		color: "oklch(0.7 0.12 250)",
		tileUrl: (_key, z, x, y) =>
			`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`,
		maxZ: 19,
		zoom: 18,
		attribution: '&copy; <a href="https://www.ign.fr/" target="_blank">IGN</a> – BD ORTHO&reg;, Licence Ouverte Etalab 2.0',
		licence: "Licence Ouverte / Etalab 2.0: \"l'intégralité des données publiques de l'IGN sont placées sous la licence ouverte Etalab\"",
		cacheToR2: true,
		usdPer1000: 0,
		region: "France",
		covers: [
			[-1.0, 43.5, 6.0, 49.0],
			[-4.3, 47.9, -1.0, 48.5],
		],
	},
	pdok: {
		name: "PDOK Luchtfoto",
		color: "oklch(0.72 0.14 30)",
		tileUrl: (_key, z, x, y) => `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/${z}/${x}/${y}.jpeg`,
		maxZ: 21,
		zoom: 18,
		attribution: 'Luchtfoto &copy; <a href="https://www.beeldmateriaal.nl/" target="_blank">Beeldmateriaal Nederland</a> / <a href="https://www.pdok.nl/" target="_blank">PDOK</a> (CC BY 4.0)',
		licence: "CC BY 4.0",
		cacheToR2: true,
		usdPer1000: 0,
		region: "Netherlands",
		covers: [
			[4.7, 51.7, 5.9, 52.6],
			[5.9, 52.0, 6.7, 53.0],
			[5.6, 53.0, 6.9, 53.3],
		],
	},
	pnoa: {
		name: "IGN España PNOA",
		color: "oklch(0.75 0.14 90)",
		tileUrl: (_key, z, x, y) =>
			`https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg`,
		maxZ: 20,
		zoom: 18,
		attribution: 'PNOA cedido por &copy; <a href="https://www.ign.es/" target="_blank">Instituto Geográfico Nacional</a> (CC BY 4.0 scne.es)',
		licence: "CC BY 4.0: \"el uso de los productos y servicios de información geográfica del IGN… conlleva la aceptación por el usuario de una licencia CC-BY 4.0\"",
		cacheToR2: true,
		usdPer1000: 0,
		region: "Spain",
		covers: [[-6.9, 38.0, -1.0, 42.5]],
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
