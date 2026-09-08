<script lang="ts">
/**
 * /app/offlineV10 — V9 cut on the z10 grid: a blob is whole z10 tiles and
 * the pyramids under them, so the gold border IS the data's edge at every
 * zoom, and a blob is a few MB. The dev rails are the old map's three cards, fed by V10.
 * The in-phone chrome is the ONLINE map's — eye/crow, the tool drawer with its
 * zoom and map-name pills, the scale bar — and the camera is the shared saved
 * one, so hopping between /app/map and here lands on the same spot.
 * URL shape matches /app/offline: ?at=lat,lng&z=13.50
 */
import { dev } from "$app/environment";
import { goto, replaceState } from "$app/navigation";
import { page } from "$app/state";
import MapTopControls from "../../lib/mapUi/MapTopControls.svelte";
import { OFFLINE_MAP_ROUTE, ONLINE_MAP_ROUTE, saveLastMapRoute } from "../../lib/mapState/lastMapRoute.svelte";
import MapLegend from "../../lib/mapUi/MapLegend.svelte";
import { attachCameraPersistence, loadCamera } from "../../lib/mapState/mapViewport";
import { attachDoubleTapToPin } from "../../lib/shared/doubleTapToPin";
import { FIRE_LAYER_ID_LIST, type FireLayerHandle, attachFireLayer } from "../../lib/onPhone/render/fireLayer";
import { type SatelliteMount, createSatelliteMount, satLayerId } from "../../lib/onPhone/satellite/mountSatellite";
import { NiceScaleBarControl } from "$parent/siblings/getCache_OnlineMap/lib/mapScaleBar";
import EphemeralDock from "$rig/dev/EphemeralDock.svelte";
import type { Component } from "svelte";
import { soloFireOrigins } from "../../lib/shared/soloPorts";
import type { HostPorts } from "../../lib/shared/hostPorts";
import type { MapHostPorts } from "../../lib/shared/mapHostPorts";
import type { Map as MapboxMap } from "mapbox-gl";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { onMount } from "svelte";
import BlobsDock from "./BlobsDock.svelte";
import ConfigDock, { type LayerRow, type Light } from "./ConfigDock.svelte";
import SessionDock from "./SessionDock.svelte";
import { blobBusy, blobInFlight, onBlob, queueBlob, repairBlob } from "./blobService";
import { budgetMb as readBudgetMb, setBudgetMb } from "./budget";
import { nearestPlace } from "./places";
import type { Progress } from "./download";
import { onFires } from "../fires/fireService";
import { HOSPITAL_LAYER_ID_LIST, type HospitalLayerHandle, attachHospitalLayer } from "../hospitals/hospitalLayer";
import { dropPhoto, onPhoto, type PhotoInfo, photoInfo } from "./satellite";
import { FOLLOW_MARGIN_KM, marginKm, moved } from "./follow";
import { PLANET_TILES, installProtocol, setReadThrough } from "./protocol";
import { type Kept, type Region, checkRegions, deleteRegion, keepStorage, listRegions, putRegion, stats, wipe } from "./store";
import { validLatLng } from "../../lib/shared/cameraFromUrl";
import { LEGEND, PHOTO_INSERT_BEFORE, PLANET, REGIONS, buildStyle } from "./style";
import { ANCHOR_Z, parseKey, rangeBox, tileBox, tileKey } from "./tiles";
import { type WorkerTarget, getWorkerTarget, setWorkerTarget } from "../../lib/worker/worker-local-dev/tilesHost";

let host = $state<HTMLDivElement>();
let map: maplibregl.Map | null = null;
let fireHandle: FireLayerHandle | null = null;
let hospitalHandle: HospitalLayerHandle | null = null;
/** The blobs' photos, mounted near the camera and unmounted far from it, the old map's cull. */
let photos: SatelliteMount | null = null;
let regions = $state<Region[]>([]);
/** Bytes and source per photo key, for the docks — refreshed as photos land and blobs go. */
let photoMeta = $state<Record<string, PhotoInfo>>({});
let tiles = $state(0);
let bytes = $state(0);
let busy = $state(false);
let progress = $state<Progress | null>(null);
let last = $state<Region | null>(null);
let tier = $state<WorkerTarget>(getWorkerTarget());
let readThrough = $state(false);
let budgetMb = $state(readBudgetMb());
/** Whether the browser agreed to keep the store — asked at boot by the engine, answered here. */
let kept = $state<Kept>("unknown");
/** Per blob id, tiles not on disk; 0 is whole. */
let missing = $state<Record<string, number>>({});
/** Why the last download did not land; cleared when the next one starts. */
let failure = $state<string | null>(null);
/** THE CIRCLE — grey never asked · yellow asked or on disk · green painted · red broke. */
let light = $state<Light>("idle");
let dlStart = $state<number | null>(null);
let dlMs = $state<number | null>(null);
let layerRows = $state<LayerRow[]>([]);
/** The online map's chrome, bound the way /app/offline binds it. */
let mapForTools = $state<MapboxMap | null>(null);
let drawControlsRef: ReturnType<typeof MapDrawControls> | undefined = $state();
let mapOnly = $state(false);
let legendOpen = $state(false);
let armKind = $state<"line" | "polygon" | "pin" | null>(null);
let dropPinAt = $state<[number, number] | null>(null);
let measureEvent = $state<{ lng: number; lat: number; n: number } | null>(null);
/**
 * THE HOST'S TWO DOORS. This child builds neither: `mapPorts` is the UI, GPS
 * and store surface, `places` every pin of every map. The fire and hospital
 * walls read their anchors from `mapPorts.store.allMaps` — live fix plus ground
 * touched in 30 days, the same set the online map uses.
 */
let { mapPorts, places, MapDrawControls, fireOrigins = soloFireOrigins }: {
	mapPorts: MapHostPorts;
	places: HostPorts;
	/** The shared tool drawer — ruler, draw palette, locate, grid, tracks. It
	 *  lives in a PRIVATE repo this one may not import, so the host hands it in.
	 *  OPTIONAL: an open-core host has no drawer to give, and the map is whole
	 *  without it — pan, zoom, blobs and every layer are the child's own. */
	MapDrawControls?: Component<Record<string, unknown>>;
	/** Anchor set → the points the fire and hospital walls are measured from.
	 *  Same private repo. Defaults to the camera alone, which is what the full
	 *  one returns for a user with no fix and no touched ground. */
	fireOrigins?: (
		mapCentre: readonly [number, number],
		maps: MapHostPorts["store"]["allMaps"],
	) => Array<readonly [number, number]>;
} = $props();
/** Where the user has a stake — the camera only when there is no fix and no touched ground. */
function origins(m: maplibregl.Map): readonly (readonly [number, number])[] {
	const c = m.getCenter();
	return fireOrigins([c.lng, c.lat], mapPorts.store.allMaps);
}
let measureN = 0;
/** The blue dot's latest live fix; the margin is how much map is left around it, recomputed as blobs land. */
let fix = $state<[number, number] | null>(null);
const margin = $derived(fix ? marginKm(fix[0], fix[1], regions.map((r) => rangeBox(r.range))) : null);
let lastEval: [number, number] | null = null;

/** ?at&z in the URL wins (?lng&lat is the blob inspector's spelling); else the camera the online map last saved; else home. */
function readUrl(): { center: [number, number]; zoom: number } {
	const q = page.url.searchParams;
	const at = q.get("at") ?? (q.has("lat") && q.has("lng") ? `${q.get("lat")},${q.get("lng")}` : null);
	const z = Number(q.get("z"));
	const [lat, lng] = (at ?? "").split(",").map(Number);
	// A swapped or empty pair (at=, parses as 0,0) falls through to the saved camera, never onto the map.
	if (validLatLng(lat, lng) && !(lat === 0 && lng === 0)) return { center: [lng, lat], zoom: Number.isFinite(z) && z > 0 ? z : 10 };
	const saved = loadCamera();
	if (saved) return { center: saved.center, zoom: saved.zoom };
	return { center: [-119.5937, 49.4991], zoom: 6 };
}

/** The same view on the online map, in the URL shape both pages read. */
function onlineUrl(): string {
	if (!map) return ONLINE_MAP_ROUTE;
	const c = map.getCenter();
	return `${ONLINE_MAP_ROUTE}?at=${c.lat.toFixed(6)},${c.lng.toFixed(6)}&z=${map.getZoom().toFixed(2)}`;
}

function writeUrl(): void {
	if (!map) return;
	const c = map.getCenter();
	const u = new URL(location.href);
	u.searchParams.set("at", `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`);
	u.searchParams.set("z", map.getZoom().toFixed(2));
	replaceState(u, page.state);
}

async function refresh(): Promise<void> {
	regions = await listRegions();
	const s = await stats();
	tiles = s.tiles;
	bytes = s.bytes;
	paintRegions();
	reconcilePhotos();
	photoMeta = await photoInfo();
	missing = await checkRegions();
	void nameOldBlobs();
}

/** Blobs from before names existed get theirs once, from their own tiles; a blob whose tiles hold no town is marked looked-at so this never runs for it again. Rows are read fresh: a $state proxy cannot be structured-cloned into IndexedDB. */
let naming = false;
async function nameOldBlobs(): Promise<void> {
	if (naming) return;
	naming = true;
	try {
		let named = 0;
		for (const r of await listRegions()) {
			if (r.place !== undefined) continue;
			await putRegion({ ...r, place: await nearestPlace(r.range, r.lng, r.lat) });
			named++;
		}
		if (named > 0) regions = await listRegions();
	} finally {
		naming = false;
	}
}

function onPhotoLanded(): void {
	reconcilePhotos();
	void photoInfo().then((p) => {
		photoMeta = p;
	});
}

const PHOTO_ROW = "photo";

/** The mounted photos' layer ids — they come and go with the camera, so they are read on use. */
function photoIds(): string[] {
	return [...(photos?.mounted() ?? [])].map((k) => `${satLayerId(k)}-l`);
}

/** Mount the photos near the camera, drop the far ones, then keep the LAYERS switch honest for the newcomers. */
function reconcilePhotos(): void {
	const m = map;
	if (!m || !photos) return;
	const b = m.getBounds();
	void photos
		.reconcile([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], regions.map((r) => [r.lng, r.lat]), m.getZoom())
		.then(() => {
			if (map === m) enforceOff(m);
		});
}

/** The border is the OUTLINE of the anchor tiles on disk: a tile's side is drawn only when the tile across it is not on disk, so blobs that touch read as one shape with no seams. */
function outline(): GeoJSON.Feature[] {
	const disk = new Set<string>();
	for (const r of regions)
		for (let x = r.range.x0; x <= r.range.x1; x++)
			for (let y = r.range.y0; y <= r.range.y1; y++) disk.add(tileKey({ z: ANCHOR_Z, x, y }));
	const edges: GeoJSON.Feature[] = [];
	for (const k of disk) {
		const t = parseKey(k);
		const b = tileBox(t);
		const sides: Array<[number, number, [number, number], [number, number]]> = [
			[0, -1, [b.w, b.n], [b.e, b.n]],
			[0, 1, [b.w, b.s], [b.e, b.s]],
			[-1, 0, [b.w, b.s], [b.w, b.n]],
			[1, 0, [b.e, b.s], [b.e, b.n]],
		];
		for (const [dx, dy, a, c] of sides)
			if (!disk.has(tileKey({ z: t.z, x: t.x + dx, y: t.y + dy })))
				edges.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [a, c] } });
	}
	return edges;
}

function paintRegions(): void {
	if (!map) return;
	const src = map.getSource(REGIONS) as maplibregl.GeoJSONSource | undefined;
	src?.setData({ type: "FeatureCollection", features: outline() });
}

/** MapLibre remembers a 404; after a download the source must be told the disk changed. */
function invalidatePlanet(): void {
	(map?.getSource(PLANET) as maplibregl.VectorTileSource | undefined)?.setTiles([PLANET_TILES]);
}

/** A blob is on disk (wherever it was earned): show it, then time the paint. */
async function landed(r: Region): Promise<void> {
	light = "ok";
	busy = false;
	progress = null;
	const t0 = performance.now();
	invalidatePlanet();
	await refresh();
	last = r;
	// `idle` means the map has nothing left to do, so ANY camera move keeps the
	// clock running: one blob read 94.8s against a 1–3s norm because the map was
	// panned while it landed. The number was never paint time. Watch for a move
	// and mark the reading interrupted rather than reporting a number that
	// silently means something else.
	let moved = false;
	const onMove = (): void => {
		moved = true;
	};
	map?.on("movestart", onMove);
	map?.once("idle", () => {
		map?.off("movestart", onMove);
		if (moved) {
			r.paintMoved = true;
			last = { ...r };
			light = "drawn";
			regions = regions.map((x) => (x.id === r.id ? { ...x, paintMoved: true as const } : x));
			void putRegion({ ...r });
			console.info(`[offlineV10] painted ${r.id} — camera moved, not timed`);
			return;
		}
		r.msPaint = Math.round(performance.now() - t0);
		last = { ...r };
		light = "drawn";
		dlMs = dlStart === null ? null : performance.now() - dlStart;
		regions = regions.map((x) => (x.id === r.id ? { ...x, msPaint: r.msPaint } : x));
		void putRegion({ ...r });
		console.info(`[offlineV10] painted ${r.id} in ${r.msPaint} ms`);
	});
}

/** The dock's lights follow the app-wide engine, including a download that started on another page. */
function followBlobs(): () => void {
	const now = blobInFlight();
	if (now) {
		busy = true;
		light = "transit";
		dlStart = now.startedAt;
		progress = now.progress;
	}
	return onBlob((e) => {
		if (e.kind === "start") {
			busy = true;
			light = "transit";
			dlStart = performance.now();
			dlMs = null;
			progress = null;
			failure = null;
		} else if (e.kind === "progress") progress = e.progress;
		// Nothing awaits these two, so a rejected IndexedDB read would be an
		// unhandled rejection AND leave the light green over a panel that had
		// silently stopped updating. The light must mean what it says.
		else if (e.kind === "landed")
			landed(e.region).catch((err) => {
				light = "err";
				failure = `blob landed but the panel could not refresh: ${err instanceof Error ? err.message : String(err)}`;
			});
		else if (e.kind === "removed") {
			invalidatePlanet();
			refresh().catch((err) => {
				light = "err";
				failure = `could not refresh after removal: ${err instanceof Error ? err.message : String(err)}`;
			});
		} else {
			light = "err";
			busy = false;
			progress = null;
			failure = `blob at ${e.at[1].toFixed(4)},${e.at[0].toFixed(4)}: ${e.error instanceof Error ? e.error.message : String(e.error)}`;
		}
	});
}

/** Every place whose pin is on screen and has no blob yet. */
function blobsForPinsInView(): void {
	if (!map) return;
	const b = map.getBounds();
	for (const p of places.places())
		for (const [lng, lat] of p.anchors)
			if (lng >= b.getWest() && lng <= b.getEast() && lat >= b.getSouth() && lat <= b.getNorth()) void queueBlob(lng, lat);
}

/** FOLLOW ME — every live fix from the drawer's one GPS watch. Evaluated only after a kilometre of movement; when less than FOLLOW_MARGIN_KM of map is left toward the nearest blob edge, the blob around the person is queued. Never while a download is in flight — in bad signal a slow fetch would otherwise stack up near-duplicates a kilometre apart. */
function onUserFix(lng: number, lat: number): void {
	if (!moved(lastEval, [lng, lat])) return;
	lastEval = [lng, lat];
	fix = [lng, lat];
	if (blobBusy()) return;
	const m = marginKm(lng, lat, regions.map((r) => rangeBox(r.range)));
	if (m > FOLLOW_MARGIN_KM) return;
	void queueBlob(lng, lat, { photo: false }).then((ok) => {
		if (ok)
			console.info(`[offlineV10] follow: ${m === Number.NEGATIVE_INFINITY ? "no map" : `${m.toFixed(1)} km of map`} ahead at ${lat.toFixed(4)},${lng.toFixed(4)} — blob queued`);
	});
}

async function removeBlob(id: string): Promise<void> {
	busy = true;
	try {
		const r = regions.find((x) => x.id === id);
		if (r) await dropPhoto(r.lng, r.lat);
		await deleteRegion(id);
		invalidatePlanet();
		await refresh();
	} finally {
		busy = false;
	}
}

async function wipeAll(): Promise<void> {
	busy = true;
	try {
		for (const r of regions) await dropPhoto(r.lng, r.lat);
		await wipe();
		invalidatePlanet();
		await refresh();
	} finally {
		busy = false;
	}
}

/** One switch per pyramid layer, read off the style itself so a renamed layer cannot leave a dead switch. */
function buildLayerRows(m: maplibregl.Map): void {
	const groups = new Map<string, string[]>();
	for (const l of m.getStyle().layers) {
		const sl = (l as { "source-layer"?: string; source?: string })["source-layer"];
		if ((l as { source?: string }).source !== PLANET || !sl) continue;
		groups.set(sl, [...(groups.get(sl) ?? []), l.id]);
	}
	layerRows = [
		...[...groups].map(([key, ids]) => ({ key, label: key, ids, on: true, painted: false })),
		// the flame layer adds its layers on its first paint, so these ids are looked up on use
		{ key: "fires", label: "fires", ids: [...FIRE_LAYER_ID_LIST], on: true, painted: false },
		// the pins add their layers on their first paint too
		{ key: "hospitals", label: "hospitals", ids: [...HOSPITAL_LAYER_ID_LIST], on: true, painted: false },
		// one raster layer per mounted photo; the ids are read off the mount on use
		{ key: PHOTO_ROW, label: "photo", ids: [], on: true, painted: false },
	];
}

function rowIds(r: LayerRow): string[] {
	return r.key === PHOTO_ROW ? photoIds() : r.ids;
}

function toggleLayer(key: string): void {
	if (!map) return;
	layerRows = layerRows.map((r) => {
		if (r.key !== key) return r;
		for (const id of rowIds(r)) if (map?.getLayer(id)) map.setLayoutProperty(id, "visibility", r.on ? "none" : "visible");
		return { ...r, on: !r.on, painted: false };
	});
}

/** A switched-off row stays off for layers that arrive later — the flames on their first paint, a photo as it mounts. */
function enforceOff(m: maplibregl.Map): void {
	for (const r of layerRows) {
		if (r.on) continue;
		for (const id of rowIds(r)) {
			if (m.getLayer(id) && m.getLayoutProperty(id, "visibility") !== "none") m.setLayoutProperty(id, "visibility", "none");
		}
	}
}

function markPainted(m: maplibregl.Map): void {
	enforceOff(m);
	layerRows = layerRows.map((r) => ({
		...r,
		painted:
			r.on &&
			(r.key === PHOTO_ROW
				? photoIds().length > 0
				: m.queryRenderedFeatures({ layers: r.ids.filter((id) => m.getLayer(id)) }).length > 0),
	}));
}

onMount(() => {
	if (!host) return;
	// STICKY MAP: the MAP tab and every "See on map" eye come back to whichever map was used last.
	saveLastMapRoute(OFFLINE_MAP_ROUTE);
	installProtocol();
	const { center, zoom } = readUrl();
	const m = new maplibregl.Map({
		container: host,
		style: buildStyle(location.origin),
		center,
		zoom,
		attributionControl: false,
	});
	map = m;
	m.on("moveend", writeUrl);
	// The drawer speaks Mapbox GL types; this map is MapLibre. Same cast as /app/offline.
	m.on("load", () => {
		buildLayerRows(m);
		refresh();
		mapForTools = m as unknown as MapboxMap;
		// THE FIRES — the cached hotspots, relevant to the pins, never to the screen; the fire pass in fires.ts keeps the cache filled for every blob.
		fireHandle = attachFireLayer(m, { origins: () => origins(m) });
		// THE HOSPITALS — the same wall from the same anchors; the child's hospitalService.ts (started by the layout) keeps the shared cache filled.
		hospitalHandle = attachHospitalLayer(m, {
			origins: () => origins(m),
			// The card's "My location" runs the LOCATE tile's action; the ref is read at click time.
			onShowMyLocation: () => void drawControlsRef?.requestMyLocation(),
		});
		// THE PHOTOS — a blob's own 2 km of satellite under its roads, for the blobs with no road to stand on.
		photos = createSatelliteMount(m, undefined, PHOTO_INSERT_BEFORE);
		reconcilePhotos();
	});
	const unfires = onFires(() => fireHandle?.repaint());
	const unphoto = onPhoto(onPhotoLanded);
	m.on("moveend", reconcilePhotos);
	m.on("idle", () => markPainted(m));
	m.addControl(
		new NiceScaleBarControl({ width: 200, maxRangeMeters: 100_000_000, minStepWidth: 23, maxDepth: 4, height: 10, unit: "m" }) as maplibregl.IControl,
		"bottom-left",
	);
	const detachCamera = attachCameraPersistence(m as unknown as Parameters<typeof attachCameraPersistence>[0]);
	// The same gesture as /app/map and /app/offline: double-tap or long-press
	// plants the Snake Ruler's first node; its Save drops the pin, and the pin's
	// arrival in the store is what earns the blob (watchNewPins).
	const detachTap = attachDoubleTapToPin(m, {
		onDrop: () => {},
		onMeasureSeed: (lng, lat) => {
			measureEvent = { lng, lat, n: measureN++ };
		},
	});
	const unfollowBlobs = followBlobs();
	void keepStorage().then((k) => {
		kept = k;
	});
	if (dev) (window as unknown as { __v10?: unknown }).__v10 = { map: m, addBlob: queueBlob, refresh, fix: onUserFix };
	return () => {
		unfires();
		unphoto();
		photos?.dispose();
		photos = null;
		fireHandle?.();
		fireHandle = null;
		hospitalHandle?.();
		hospitalHandle = null;
		unfollowBlobs();
		detachTap();
		detachCamera();
		mapForTools = null;
		m.remove();
		map = null;
	};
});
</script>

<svelte:head><title>Get Cache | offlineV10</title></svelte:head>

<div
	class="mobile-map-fill"
	class:draw-active-poly={armKind === "polygon"}
	class:draw-active-line={armKind === "line"}
	class:draw-active-pin={armKind === "pin"}
>
	<div class="map-canvas" bind:this={host}></div>

	<MapTopControls ports={mapPorts} bind:mapOnly crowMode="offline" onCrowToggle={() => goto(onlineUrl())} />

	{#if MapDrawControls}
	<MapDrawControls
		bind:this={drawControlsRef}
		map={mapForTools}
		offline
		noAutoFrame
		{mapOnly}
		bind:armKind
		bind:dropPinAt
		bind:measureEvent
		{onUserFix}
		onLegend={() => (legendOpen = true)}
		offlineBasemapLayers={layerRows.map((r) => ({ key: r.key, label: r.label, on: r.on, toggle: () => toggleLayer(r.key) }))}
	/>
	{/if}
	{#if legendOpen}
		<MapLegend ports={mapPorts} basemapRows={LEGEND} onClose={() => (legendOpen = false)} />
	{/if}
</div>

{#if dev}
	<EphemeralDock side="left">
		<SessionDock {progress} {last} {regions} photos={photoMeta} {tier} {kept} {budgetMb} {bytes} />
		<ConfigDock
			{tier}
			onTier={(t) => { tier = t; setWorkerTarget(t); }}
			{readThrough}
			onReadThrough={(on) => { readThrough = on; setReadThrough(on); }}
			{light}
			{dlStart}
			{dlMs}
			layers={layerRows}
			onLayer={toggleLayer}
			{budgetMb}
			onBudget={(mb) => { setBudgetMb(mb); budgetMb = mb; }}
		/>
	</EphemeralDock>
	<EphemeralDock side="right">
		<BlobsDock
			ui={mapPorts.ui}
			{regions}
			photos={photoMeta}
			{tiles}
			{bytes}
			{busy}
			{kept}
			{missing}
			{budgetMb}
			{failure}
			follow={fix ? { at: fix, margin: margin ?? Number.NEGATIVE_INFINITY } : null}
			onAddHere={() => { const c = map?.getCenter(); if (c) void queueBlob(c.lng, c.lat); }}
			onAddForPins={blobsForPinsInView}
			onDelete={removeBlob}
			onWipe={wipeAll}
			onFly={(r) => map?.flyTo({ center: [r.lng, r.lat], zoom: 11 })}
			onRepair={(r) => void repairBlob($state.snapshot(r))}
			onRepairAll={() => { for (const r of regions) if ((missing[r.id] ?? 0) > 0) void repairBlob($state.snapshot(r)); }}
		/>
	</EphemeralDock>
{/if}

<style>
/* Full-bleed frame, canvas, ctrl overrides and the scale bar come from mobile.css (.mobile-map-fill), shared with /app/map. */
.map-canvas { background: #34373d; }
</style>
