// The online map's imagery: Sentinel through our Worker where Mapbox's own satellite was, and the
// phone's baked photos over it wherever it holds one. Every satellite pixel is then a source Squirrel counts.
import type * as maplibregl from "maplibre-gl";
import { SATELLITE_SOURCES, type SatelliteSource } from "../../contract/satelliteSources";
import { tilesHost } from "../../worker/tilesHost";
import { listRegions, onRegionsChanged } from "../../../routes/offlinev10/store";
import { onPhoto } from "../../../routes/offlinev10/satellite";
import { createSatelliteMount, type SatelliteMount } from "./mountSatellite";

/** The raster layer Mapbox's satellite styles draw their imagery with. */
const MAPBOX_IMAGERY = "satellite";
const SENTINEL = "gc-sentinel";
/** Sentinel's 10 m pixels hold until here; past it a sharper source takes over where one covers. */
const SHARP_FROM_Z = 13;

/** Swaps the imagery on every style load (the basemap picker reloads the style); a style without imagery is left alone.
 * `onCredits` hears the attributions of the photos on the map; Sentinel's rides its own source. */
export function attachOnlineImagery(map: maplibregl.Map, onCredits: (credits: string[]) => void): () => void {
	let photos: SatelliteMount | null = null;

	const show = async (): Promise<void> => {
		const mount = photos;
		if (!mount) return;
		const b = map.getBounds();
		const sites = new Map<string, { key: string; center: [number, number] }>();
		for (const r of await listRegions())
			if (!r.removed && r.photoKey && r.photoCenter) sites.set(r.photoKey, { key: r.photoKey, center: r.photoCenter });
		await mount.reconcile([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], [...sites.values()], map.getZoom());
		if (mount === photos) onCredits(mount.attributions());
	};

	const swap = (): void => {
		photos?.dispose();
		photos = null;
		const layers = map.getStyle().layers;
		const at = layers.findIndex((l) => l.id === MAPBOX_IMAGERY);
		if (at < 0) return onCredits([]);
		const above = layers[at + 1]?.id;
		const sentinel = SATELLITE_SOURCES.sentinel;
		map.addSource(SENTINEL, {
			type: "raster",
			tiles: [`${tilesHost()}/satellite/sentinel/{z}/{x}/{y}.jpg`],
			tileSize: 256,
			maxzoom: sentinel.maxZ,
			attribution: sentinel.attribution,
		});
		map.addLayer({ id: SENTINEL, type: "raster", source: SENTINEL }, MAPBOX_IMAGERY);
		for (const [id, src] of Object.entries(SATELLITE_SOURCES) as [string, SatelliteSource][])
			src.covers?.forEach((bounds, i) => {
				// One source per box: a raster source takes one bounds, and outside it no tile is asked for.
				const box = `gc-${id}-${i}`;
				map.addSource(box, {
					type: "raster",
					tiles: [`${tilesHost()}/satellite/${id}/{z}/{x}/{y}.jpg`],
					tileSize: 256,
					bounds: [...bounds],
					minzoom: SHARP_FROM_Z,
					maxzoom: src.maxZ,
					attribution: src.attribution,
				});
				map.addLayer({ id: box, type: "raster", source: box, minzoom: SHARP_FROM_Z }, MAPBOX_IMAGERY);
			});
		map.removeLayer(MAPBOX_IMAGERY);
		photos = createSatelliteMount(map, above ?? "", null);
		void show();
	};

	const moved = (): void => void show();
	map.on("style.load", swap);
	map.on("moveend", moved);
	const offRegions = onRegionsChanged(moved);
	const offPhoto = onPhoto(moved);
	if (map.isStyleLoaded()) swap();
	return () => {
		map.off("style.load", swap);
		map.off("moveend", moved);
		offRegions();
		offPhoto();
		photos?.dispose();
		photos = null;
	};
}
