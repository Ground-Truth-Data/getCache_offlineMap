// The online map's imagery over the Streets base: only the tiles the phone holds. Nothing streams, so every satellite
// pixel on screen works with no signal and was paid for once.
import * as maplibregl from "maplibre-gl";
import { SATELLITE_SOURCES } from "../../contract/satelliteSources";
import { installProtocol, PHOTO_TILES } from "../../../routes/offlinev10/protocol";
import { listRegions, onRegionsChanged } from "../../../routes/offlinev10/store";
import { onPhoto } from "../../../routes/offlinev10/satellite";
import { MAP_HOME_CENTER } from "../../shared/homeCentre";
import { pinLibraryUrl } from "../../shared/icons";
import { createSatelliteMount, type SatelliteMount } from "./mountSatellite";
import sampleImage from "./sample/mississippiLake.webp";

/** The online style's IMAGERY_ANCHOR: the imagery goes in under it, then it goes. */
const ANCHOR = "satellite";

/** A new planter's first look, drawn while the phone holds no area: Sentinel-2 (CC BY, so it may ship in the app) of
 * Mississippi Lake, Ontario, and one tree. Drawn only, never stored, so there is nothing of it to sync, delete or trip over. */
export const SAMPLE = {
	center: MAP_HOME_CENTER,
	zoom: 12.8,
	pin: [-76.18, 45.0465] as [number, number],
	// The z14 tile edges it was stitched from.
	corners: [[-76.2451171875, 45.08903556483102], [-76.13525390625, 45.08903556483102], [-76.13525390625, 44.98034238084973], [-76.2451171875, 44.98034238084973]] as [number, number][],
	credit: SATELLITE_SOURCES.sentinel.attribution,
};
const SAMPLE_ID = "gc-sample";

/** Remounts the photos on every style load. `onCredits` hears the attributions of the imagery on the map. */
export function attachHeldPhotos(map: maplibregl.Map, onCredits: (credits: string[]) => void): () => void {
	let photos: SatelliteMount | null = null;
	let above: string | undefined;
	let sample: maplibregl.Marker | null = null;

	const credit = (): void => onCredits([...(photos?.attributions() ?? []), ...(sample ? [SAMPLE.credit] : [])]);
	const show = async (): Promise<void> => {
		const mount = photos;
		if (!mount) return;
		const b = map.getBounds();
		const sites = new Map<string, { key: string; rings: [number, number][][] }>();
		for (const r of await listRegions())
			if (!r.removed && r.photoKey && r.photoRings) sites.set(r.photoKey, { key: r.photoKey, rings: r.photoRings });
		await mount.reconcile([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], [...sites.values()]);
		if (mount === photos) credit();
	};
	const paintSample = (): void => {
		if (!sample || map.getSource(SAMPLE_ID)) return;
		map.addSource(SAMPLE_ID, { type: "image", url: sampleImage, coordinates: SAMPLE.corners as [[number, number], [number, number], [number, number], [number, number]] });
		map.addLayer({ id: SAMPLE_ID, type: "raster", source: SAMPLE_ID }, above);
	};

	const restyled = (): void => {
		photos?.dispose();
		photos = null;
		if (!map.getLayer(ANCHOR)) return onCredits([]);
		const layers = map.getStyle().layers;
		above = layers[layers.findIndex((l) => l.id === ANCHOR) + 1]?.id;
		map.removeLayer(ANCHOR);
		photos = createSatelliteMount(map, above ?? "", PHOTO_TILES);
		paintSample();
		void show();
	};
	const moved = (): void => void show();
	installProtocol();
	map.on("style.load", restyled);
	map.on("moveend", moved);
	const offRegions = onRegionsChanged(moved);
	const offPhoto = onPhoto(() => {
		photos?.tilesChanged();
		void show();
	});
	if (map.isStyleLoaded()) restyled();
	let live = true;
	void listRegions().then((held) => {
		if (!live || held.length) return;
		const img = document.createElement("img");
		Object.assign(img, { src: pinLibraryUrl("pin_tree_sm.webp"), alt: "", width: 30, height: 40 });
		sample = new maplibregl.Marker({ element: img, anchor: "bottom" }).setLngLat(SAMPLE.pin).addTo(map);
		if (photos) paintSample();
		credit();
	});
	return () => {
		live = false;
		map.off("style.load", restyled);
		map.off("moveend", moved);
		offRegions();
		offPhoto();
		photos?.dispose();
		photos = null;
		sample?.remove();
		sample = null;
	};
}
