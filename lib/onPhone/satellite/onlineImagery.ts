// The online map's imagery: Sentinel through our Worker where Mapbox's own satellite was, and the
// phone's baked photos over it wherever it holds one. Every satellite pixel is then a source Squirrel counts.
import type * as maplibregl from "maplibre-gl";
import { coverOf, SATELLITE_SOURCES, type SatelliteSource } from "../../contract/satelliteSources";
import { squirrelUrl, tilesHost } from "../../worker/tilesHost";
import { listRegions, onRegionsChanged } from "../../../routes/offlinev10/store";
import { onPhoto } from "../../../routes/offlinev10/satellite";
import { createSatelliteMount, type SatelliteMount } from "./mountSatellite";
import { PHOTO_COVERAGE_RADIUS_KM } from "./satelliteImage";
import { kmToDegSpan } from "../../shared/kmGeo";

/** The raster layer Mapbox's satellite styles draw their imagery with. */
const MAPBOX_IMAGERY = "satellite";
const SENTINEL = "gc-sentinel";
/** Streamed past SHARP_FROM_Z: Esri, or a standby source while Squirrel has it switched on. */
const LIVE = (Object.entries(SATELLITE_SOURCES) as [string, SatelliteSource][]).filter(([, s]) => s.live);
/** Sentinel's 10 m pixels hold until here; past it a sharper source takes over where one covers. */
const SHARP_FROM_Z = 13;

/** Swaps the imagery on every style load (the basemap picker reloads the style); a style without imagery is left alone.
 * `onCredits` hears the attributions of the photos on the map; Sentinel's rides its own source. */
export function attachOnlineImagery(map: maplibregl.Map, onCredits: (credits: string[]) => void): () => void {
	let photos: SatelliteMount | null = null;
	const boxes = new Map<string, readonly [number, number, number, number]>();
	let live = "esri";

	/** Asked once a style load, so a switch on /app/squirrel lands on the next one. */
	const pickLive = async (): Promise<void> => {
		const url = squirrelUrl("/active");
		if (!url) return;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status} the Worker would not say which standby sources are on`);
		// tiles-prod names no standby until its next deploy: nothing is switched on there.
		const { standby } = (await res.json()) as { standby?: string[] };
		live = LIVE.find(([id, s]) => s.standby && standby?.includes(id))?.[0] ?? "esri";
		void show();
	};

	const show = async (): Promise<void> => {
		const mount = photos;
		if (!mount) return;
		const b = map.getBounds();
		const sites = new Map<string, { key: string; center: [number, number] }>();
		for (const r of await listRegions())
			if (!r.removed && r.photoKey && r.photoCenter) sites.set(r.photoKey, { key: r.photoKey, center: r.photoCenter });
		await mount.reconcile([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], [...sites.values()], map.getZoom());
		if (mount !== photos) return;
		onCredits(mount.attributions());
		// Esri bills per tile, so it asks for none while the whole view is inside one photo or a sharper source's cover;
		// the square inside a photo's disc keeps the corners honest.
		const inside = !!coverOf(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()) || [...sites.values()].some(({ center: [lng, lat] }) => {
			const { dLat, dLng } = kmToDegSpan(PHOTO_COVERAGE_RADIUS_KM / Math.SQRT2, lat);
			return b.getWest() >= lng - dLng && b.getEast() <= lng + dLng && b.getSouth() >= lat - dLat && b.getNorth() <= lat + dLat;
		});
		for (const [id] of LIVE) if (map.getLayer(`gc-${id}`)) map.setLayoutProperty(`gc-${id}`, "visibility", inside || id !== live ? "none" : "visible");
		// Mapbox credits every visible layer, in view or not; a box out of view is hidden so its source isn't credited.
		for (const [box, [w, s, e, n]] of boxes)
			if (map.getLayer(box)) map.setLayoutProperty(box, "visibility", w < b.getEast() && e > b.getWest() && s < b.getNorth() && n > b.getSouth() ? "visible" : "none");
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
		// The Worker 404s what USGS covers and everything past 90% of the free tier, and Sentinel shows through.
		// Each starts hidden, so no tile is asked for until `show` picks the one live source.
		for (const [id, src] of LIVE) {
			map.addSource(`gc-${id}`, {
				type: "raster",
				tiles: [`${tilesHost()}/satellite/${id}/{z}/{x}/{y}.jpg`],
				tileSize: 256,
				minzoom: SHARP_FROM_Z,
				maxzoom: src.maxZ,
				attribution: src.attribution,
			});
			map.addLayer({ id: `gc-${id}`, type: "raster", source: `gc-${id}`, minzoom: SHARP_FROM_Z, layout: { visibility: "none" } }, MAPBOX_IMAGERY);
		}
		void pickLive();
		for (const [id, src] of Object.entries(SATELLITE_SOURCES) as [string, SatelliteSource][])
			src.covers?.forEach((bounds, i) => {
				// One source per box: a raster source takes one bounds, and outside it no tile is asked for.
				const box = `gc-${id}-${i}`;
				boxes.set(box, bounds);
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
