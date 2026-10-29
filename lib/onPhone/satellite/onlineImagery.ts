// The online map's imagery: the two sources Squirrel puts on the map, through our Worker where Mapbox's own satellite
// was, and the phone's baked photos only while offline. Every satellite pixel is then a source Squirrel counts.
import type * as maplibregl from "maplibre-gl";
import { coverOf, type MapBand, SATELLITE_SOURCES, type SatelliteSource, sourceOf } from "../../contract/satelliteSources";
import { squirrelUrl, tilesHost } from "../../worker/tilesHost";
import { listRegions, onRegionsChanged } from "../../../routes/offlinev10/store";
import { onPhoto } from "../../../routes/offlinev10/satellite";
import { createSatelliteMount, type SatelliteMount } from "./mountSatellite";
import { PHOTO_COVERAGE_RADIUS_KM } from "./satelliteImage";
import { kmToDegSpan } from "../../shared/kmGeo";
import mapboxLogo from "./logos/mapbox.webp";
import maptilerLogo from "./logos/maptiler.webp";

/** The online style's IMAGERY_ANCHOR: the imagery goes in under it, then it goes. */
const MAPBOX_IMAGERY = "satellite";
const FAR = "gc-far";
const NEAR = "gc-near";
/** `near` takes over from here in; a source with its own boxes (USGS) wins inside them. */
const SHARP_FROM_Z = 12;
/** `near` fades in over `far` across these two zooms, so the hand-over is never a jump. */
const FADE_FROM_Z = SHARP_FROM_Z - 2;
const FADE_IN: maplibregl.RasterLayerSpecification["paint"] = { "raster-opacity": ["interpolate", ["linear"], ["zoom"], FADE_FROM_Z, 0, SHARP_FROM_Z, 1] };
/** Sentinel fitted to MapTiler's brightness, spread and colour over the same z11 ground. */
const TONE: Record<string, maplibregl.RasterLayerSpecification["paint"]> = { sentinel: { "raster-contrast": -0.15, "raster-saturation": 0.4 } };
const FORCED = "gc-forced";
const FORCED_KEY = "gc-forced-imagery";
/** Shown in the credits' corner while that source's tiles are. Mapbox requires its logo and forbids styling it;
 * MapTiler's is owed only on a free plan, so it sits faded, haloed to read over bright ground. Full credits stay in the ⓘ. */
const LOGOS: Record<string, { src: string; href: string; style: string }> = {
	mapbox: { src: mapboxLogo, href: "https://www.mapbox.com/", style: "" },
	maptiler: { src: maptilerLogo, href: "https://www.maptiler.com/", style: "opacity:0.55;filter:drop-shadow(0 0 1.5px #000)" },
};
/** Esri's credit "must not be covered or obstructed", so the ⓘ stays open while its tiles are. */
const CREDITS_OPEN = "esri";

/** Squirrel's hand test: one source drawn at every zoom over all other imagery, in this browser only. */
export function forcedImagery(): string | null {
	return import.meta.env.DEV ? localStorage.getItem(FORCED_KEY) : null;
}

export function forceImagery(id: string | null): void {
	if (id) localStorage.setItem(FORCED_KEY, id);
	else localStorage.removeItem(FORCED_KEY);
}

/** Squirrel's picks for the map, asked once a style load, so a switch lands on every map's next one. */
async function mapPicks(): Promise<Record<MapBand, [string, SatelliteSource]>> {
	const res = await fetch(squirrelUrl("/active") ?? "");
	if (!res.ok) throw new Error(`HTTP ${res.status} the Worker would not say which sources are on the map`);
	const { map } = (await res.json()) as { map?: Record<MapBand, string> };
	const [far, near] = [sourceOf(map?.far ?? ""), sourceOf(map?.near ?? "")];
	if (!map || !far || !near || far.covers || near.covers)
		throw new Error(`The Worker named no map sources (${JSON.stringify(map)}); deploy the tiles Worker before the app`);
	return { far: [map.far, far], near: [map.near, near] };
}

const raster = (id: string, src: SatelliteSource, more: Partial<maplibregl.RasterSourceSpecification> = {}): maplibregl.RasterSourceSpecification => ({
	type: "raster",
	tiles: [`${tilesHost()}/satellite/${id}/{z}/{x}/{y}.jpg`],
	tileSize: src.tilePx ?? 256,
	maxzoom: src.maxZ,
	attribution: src.attribution,
	...more,
});

/** Swaps the imagery on every style load (the basemap picker reloads the style); a style without imagery is left alone.
 * `onCredits` hears the attributions of the photos on the map; each source on it credits itself. */
export function attachOnlineImagery(map: maplibregl.Map, onCredits: (credits: string[]) => void): () => void {
	let photos: SatelliteMount | null = null;
	const boxes = new Map<string, readonly [number, number, number, number]>();
	let above: string | undefined;
	let loads = 0;
	let picked: Record<MapBand, string> | null = null;
	/** Each source the view should draw, with the map source drawing it; null for a mounted photo. */
	let wants: [string, string | null][] = [];
	const logoBox = document.createElement("div");
	logoBox.className = "maplibregl-ctrl";
	logoBox.style.cssText = "display:flex;gap:6px;align-items:center";
	const logoCtl: maplibregl.IControl = { onAdd: () => logoBox, onRemove: () => logoBox.remove() };
	map.addControl(logoCtl, "bottom-left");
	const showLogos = (ids: Set<string>): void => {
		const want = [...ids].filter((id) => LOGOS[id]).sort();
		if (want.join() === logoBox.dataset.ids) return;
		logoBox.dataset.ids = want.join();
		logoBox.replaceChildren(
			...want.map((id) => {
				const { src, href, style } = LOGOS[id];
				const a = document.createElement("a");
				Object.assign(a, { href, target: "_blank", rel: "noopener" });
				a.innerHTML = `<img src="${src}" alt="${sourceOf(id)?.name}" style="height:20px;display:block;${style}">`;
				return a;
			}),
		);
	};

	const show = async (): Promise<void> => {
		const mount = photos;
		if (!mount) return;
		const b = map.getBounds();
		const sites = new Map<string, { key: string; center: [number, number] }>();
		// Online, live imagery is the picture and a photo is never drawn; it is for when the network is gone.
		if (!navigator.onLine)
			for (const r of await listRegions())
				if (!r.removed && r.photoKey && r.photoCenter) sites.set(r.photoKey, { key: r.photoKey, center: r.photoCenter });
		await mount.reconcile([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], [...sites.values()], map.getZoom());
		if (mount !== photos) return;
		onCredits(mount.attributions());
		// `near` bills per tile, so it asks for none while the whole view is inside a covering source's box, or offline
		// inside one photo; the square inside a photo's disc keeps the corners honest.
		const inside = !!coverOf(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()) || [...sites.values()].some(({ center: [lng, lat] }) => {
			const { dLat, dLng } = kmToDegSpan(PHOTO_COVERAGE_RADIUS_KM / Math.SQRT2, lat);
			return b.getWest() >= lng - dLng && b.getEast() <= lng + dLng && b.getSouth() >= lat - dLat && b.getNorth() <= lat + dLat;
		});
		// A forced source hides the rest, so nothing under it shows through a tile it 404s.
		const forced = !!map.getLayer(FORCED);
		if (map.getLayer(FAR)) map.setLayoutProperty(FAR, "visibility", forced ? "none" : "visible");
		if (map.getLayer(NEAR)) map.setLayoutProperty(NEAR, "visibility", forced || inside ? "none" : "visible");
		// Every visible layer is credited, in view or not; a box out of view is hidden so its source isn't credited.
		for (const [box, [w, s, e, n]] of boxes)
			if (map.getLayer(box)) map.setLayoutProperty(box, "visibility", !forced && w < b.getEast() && e > b.getWest() && s < b.getNorth() && n > b.getSouth() ? "visible" : "none");
		const z = map.getZoom();
		wants = forced ? [[forcedImagery() ?? "", FORCED]] : [];
		if (picked && !forced && z < SHARP_FROM_Z) wants.push([picked.far, FAR]);
		if (picked && !forced && !inside && z >= FADE_FROM_Z) wants.push([picked.near, NEAR]);
		for (const credit of mount.attributions()) for (const [id, src] of Object.entries(SATELLITE_SOURCES)) if (src.attribution === credit) wants.push([id, null]);
		onScreen();
	};
	// A source answering 404 (a box, a spent free tier) has no tile up, so it shows no logo and holds no ⓘ open.
	const onScreen = (): void => {
		const drawn = new Set(wants.filter(([, s]) => !s || !!map.style?.tileManagers[s]?.getRenderableIds().length).map(([id]) => id));
		showLogos(drawn);
		const credits = map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
		if (drawn.has(CREDITS_OPEN) && credits && !credits.classList.contains("maplibregl-compact-show"))
			credits.querySelector<HTMLElement>(".maplibregl-ctrl-attrib-button")?.click();
	};

	const force = (): void => {
		if (map.getLayer(FORCED)) map.removeLayer(FORCED);
		if (map.getSource(FORCED)) map.removeSource(FORCED);
		const id = forcedImagery();
		const src = id ? sourceOf(id) : undefined;
		if (id && src) {
			map.addSource(FORCED, raster(id, src));
			map.addLayer({ id: FORCED, type: "raster", source: FORCED }, above);
		}
		void show();
	};
	const forcedElsewhere = (e: StorageEvent): void => {
		if (e.key === FORCED_KEY && photos) force();
	};

	const swap = async (): Promise<void> => {
		const load = ++loads;
		photos?.dispose();
		photos = null;
		picked = null;
		wants = [];
		showLogos(new Set());
		if (!map.getLayer(MAPBOX_IMAGERY)) return onCredits([]);
		const { far: [farId, far], near: [nearId, near] } = await mapPicks();
		// The style loaded again while we asked; that load builds its own imagery.
		if (load !== loads || !map.getLayer(MAPBOX_IMAGERY)) return;
		const layers = map.getStyle().layers;
		above = layers[layers.findIndex((l) => l.id === MAPBOX_IMAGERY) + 1]?.id;
		picked = { far: farId, near: nearId };
		map.addSource(FAR, raster(farId, far));
		map.addLayer({ id: FAR, type: "raster", source: FAR, paint: TONE[farId] }, MAPBOX_IMAGERY);
		// The Worker 404s what a box covers, a standby source not on the map and anything past 90% of a free tier;
		// `far` shows through.
		map.addSource(NEAR, raster(nearId, near, { minzoom: FADE_FROM_Z }));
		map.addLayer({ id: NEAR, type: "raster", source: NEAR, minzoom: FADE_FROM_Z, paint: { ...TONE[nearId], ...FADE_IN } }, MAPBOX_IMAGERY);
		for (const [id, src] of Object.entries(SATELLITE_SOURCES) as [string, SatelliteSource][])
			src.covers?.forEach((bounds, i) => {
				// One source per box: a raster source takes one bounds, and outside it no tile is asked for.
				const box = `gc-${id}-${i}`;
				boxes.set(box, bounds);
				map.addSource(box, raster(id, src, { bounds: [...bounds], minzoom: FADE_FROM_Z }));
				map.addLayer({ id: box, type: "raster", source: box, minzoom: FADE_FROM_Z, paint: FADE_IN }, MAPBOX_IMAGERY);
			});
		map.removeLayer(MAPBOX_IMAGERY);
		photos = createSatelliteMount(map, above ?? "", null);
		force();
	};
	const restyled = (): void => void swap();

	const moved = (): void => void show();
	map.on("style.load", restyled);
	map.on("moveend", moved);
	map.on("idle", onScreen);
	addEventListener("storage", forcedElsewhere);
	addEventListener("online", moved);
	addEventListener("offline", moved);
	const offRegions = onRegionsChanged(moved);
	const offPhoto = onPhoto(moved);
	if (map.isStyleLoaded()) restyled();
	return () => {
		loads++;
		map.off("style.load", restyled);
		map.off("moveend", moved);
		map.off("idle", onScreen);
		removeEventListener("storage", forcedElsewhere);
		removeEventListener("online", moved);
		removeEventListener("offline", moved);
		offRegions();
		offPhoto();
		photos?.dispose();
		photos = null;
		map.removeControl(logoCtl);
	};
}
