<script lang="ts">
/** The offline map: a blob is whole z10 tiles and the pyramids under them, so the gold border IS the data's edge at every zoom. Chrome and saved camera are the online map's. */
import { dev } from "$app/environment";
import { goto, replaceState } from "$app/navigation";
import { page } from "$app/state";
import MapTopControls from "../../lib/mapUi/MapTopControls.svelte";
import { OFFLINE_MAP_ROUTE, ONLINE_MAP_ROUTE, saveLastMapRoute } from "../../lib/mapState/lastMapRoute.svelte";
import MapLegend from "../../lib/mapUi/MapLegend.svelte";
import { attachCameraPersistence, loadCamera, MAP_HOME_CENTER } from "../../lib/mapState/mapViewport";
import { attachDoubleTapToPin } from "../../lib/shared/doubleTapToPin";
import { FIRE_LAYER_ID_LIST, type FireLayerHandle, attachFireLayer } from "../../lib/onPhone/render/fireLayer";
import { type SatelliteMount, createSatelliteMount, satLayerId } from "../../lib/onPhone/satellite/mountSatellite";
import { NiceScaleBarControl } from "$parent/siblings/getCache_OnlineMap/lib/chrome/mapScaleBar";
import { safeFlyTo } from "$parent/siblings/getCache_OnlineMap/lib/core/safeMap";
import EphemeralDock from "$rig/dev/EphemeralDock.svelte";
import type { Component } from "svelte";
import { soloFireOrigins, soloHostPorts, soloMapPorts } from "../../lib/shared/soloPorts";
import type { HostPorts } from "../../lib/shared/hostPorts";
import type { MapDrawControlsExports, MapHostPorts } from "../../lib/shared/mapHostPorts";
import type { Map as MapboxMap } from "mapbox-gl";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { onMount } from "svelte";
import BlobsDock from "./BlobsDock.svelte";
import ConfigDock, { type LayerRow, type Light } from "./ConfigDock.svelte";
import DataDock from "./DataDock.svelte";
import SessionDock from "./SessionDock.svelte";
import { blobBusy, blobInFlight, onBlob, queueBlob, repairBlob, setBlobNarration } from "./blobService";
import { budgetMb as readBudgetMb, setBudgetMb } from "./budget";
import { nearestPlace } from "./places";
import type { Progress } from "./download";
import { onFires } from "../fires/fireService";
import { HOSPITAL_LAYER_ID_LIST, type HospitalLayerHandle, attachHospitalLayer } from "../hospitals/hospitalLayer";
import { dropPhoto, onPhoto, type PhotoInfo, photoInfo, setPhotoNarration } from "./satellite";
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
let photos: SatelliteMount | null = null;
let regions = $state<Region[]>([]);
let photoMeta = $state<Record<string, PhotoInfo>>({});
let tiles = $state(0);
let bytes = $state(0);
let busy = $state(false);
let progress = $state<Progress | null>(null);
let last = $state<Region | null>(null);
let tier = $state<WorkerTarget>(getWorkerTarget());
let readThrough = $state(false);
let budgetMb = $state(readBudgetMb());
let kept = $state<Kept>("unknown");
/** Per blob id, tiles not on disk; 0 is whole. */
let missing = $state<Record<string, number>>({});
let failure = $state<string | null>(null);
/** grey never asked · yellow asked or on disk · green painted · red broke */
let light = $state<Light>("idle");
let dlStart = $state<number | null>(null);
let dlMs = $state<number | null>(null);
let layerRows = $state<LayerRow[]>([]);
let mapForTools = $state<MapboxMap | null>(null);
let drawControlsRef: ReturnType<NonNullable<typeof MapDrawControls>> | undefined = $state();
let mapOnly = $state(false);
let legendOpen = $state(false);
let armKind = $state<"line" | "polygon" | "pin" | null>(null);
let dropPinAt = $state<[number, number] | null>(null);
let measureEvent = $state<{ lng: number; lat: number; n: number } | null>(null);
/** The host's doors; every one optional, since a host with no Get Cache app behind it supplies none. */
let {
	mapPorts = soloMapPorts(),
	places = soloHostPorts(),
	MapDrawControls,
	fireOrigins = soloFireOrigins,
	debug = false,
}: {
	mapPorts?: MapHostPorts;
	places?: HostPorts;
	/** The tool drawer lives in a PRIVATE repo this one may not import, so the host hands it in. */
	MapDrawControls?: Component<Record<string, unknown>, MapDrawControlsExports>;
	/** The points the fire and hospital walls are measured from. */
	fireOrigins?: (
		mapCentre: readonly [number, number],
		maps: MapHostPorts["store"]["allMaps"],
	) => Array<readonly [number, number]>;
	/** Mounts the instrument docks; only /app/offlinev10/debug passes true. */
	debug?: boolean;
} = $props();
function origins(m: maplibregl.Map): readonly (readonly [number, number])[] {
	const c = m.getCenter();
	return fireOrigins([c.lng, c.lat], mapPorts.store.allMaps);
}
let measureN = 0;
let fix = $state<[number, number] | null>(null);
const margin = $derived(fix ? marginKm(fix[0], fix[1], regions.map((r) => rangeBox(r.range))) : null);
let lastEval: [number, number] | null = null;

/** ?at&z wins (?lng&lat is the blob inspector's spelling); else the saved camera; else home. */
function readUrl(): { center: [number, number]; zoom: number } {
	const q = page.url.searchParams;
	const at = q.get("at") ?? (q.has("lat") && q.has("lng") ? `${q.get("lat")},${q.get("lng")}` : null);
	const z = Number(q.get("z"));
	const [lat, lng] = (at ?? "").split(",").map(Number);
	// `at=` parses as 0,0
	if (validLatLng(lat, lng) && !(lat === 0 && lng === 0)) return { center: [lng, lat], zoom: Number.isFinite(z) && z > 0 ? z : 10 };
	const saved = loadCamera();
	if (saved) return { center: saved.center, zoom: saved.zoom };
	return { center: MAP_HOME_CENTER, zoom: 6 };
}

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

/** Names unnamed blobs once. Rows are read fresh: a $state proxy cannot be structured-cloned into IndexedDB. */
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

function photoIds(): string[] {
	return [...(photos?.mounted() ?? [])].map((k) => `${satLayerId(k)}-l`);
}

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

/** A tile's side is drawn only when the tile across it is not on disk, so touching blobs read as one shape. */
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

async function landed(r: Region): Promise<void> {
	light = "ok";
	busy = false;
	progress = null;
	const t0 = performance.now();
	invalidatePlanet();
	await refresh();
	last = r;
	// A camera move keeps `idle` from firing, so the reading is marked interrupted rather than reported.
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

/** Follows the app-wide engine, including a download that started on another page. */
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
		// Nothing awaits these, so a rejection must turn the light red itself.
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

/** Follow me: queue the blob around the person when less than FOLLOW_MARGIN_KM of map is left. Never while a download is in flight, or bad signal stacks near-duplicates. */
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

/** One switch per pyramid layer, read off the style so a renamed layer cannot leave a dead switch. */
function buildLayerRows(m: maplibregl.Map): void {
	const groups = new Map<string, string[]>();
	for (const l of m.getStyle().layers) {
		const sl = (l as { "source-layer"?: string; source?: string })["source-layer"];
		if ((l as { source?: string }).source !== PLANET || !sl) continue;
		groups.set(sl, [...(groups.get(sl) ?? []), l.id]);
	}
	layerRows = [
		...[...groups].map(([key, ids]) => ({ key, label: key, ids, on: true, painted: false })),
		// fires and hospitals add their layers on first paint; photo ids are read off the mount on use
		{ key: "fires", label: "fires", ids: [...FIRE_LAYER_ID_LIST], on: true, painted: false },
		{ key: "hospitals", label: "hospitals", ids: [...HOSPITAL_LAYER_ID_LIST], on: true, painted: false },
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

/** A switched-off row stays off for layers that arrive later. */
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
	m.on("load", () => {
		buildLayerRows(m);
		refresh();
		// The drawer speaks Mapbox GL types; this map is MapLibre.
		mapForTools = m as unknown as MapboxMap;
		fireHandle = attachFireLayer(m, { origins: () => origins(m) });
		hospitalHandle = attachHospitalLayer(m, {
			origins: () => origins(m),
			onShowMyLocation: () => void drawControlsRef?.requestMyLocation(),
		});
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
	// Double-tap plants the ruler's first node; its Save drops the pin, whose arrival in the store earns the blob.
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

	setBlobNarration(debug);
	setPhotoNarration(debug);
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

<!-- The instrument docks: never delete, they are how this map is debugged. Mounted only at /app/offlinev10/debug. -->
{#if dev && debug}
	<EphemeralDock side="left">
		<DataDock />
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
			onFly={(r) => { if (map) safeFlyTo(map, { center: [r.lng, r.lat], zoom: 11 }); }}
			onRepair={(r) => void repairBlob($state.snapshot(r))}
			onRepairAll={() => { for (const r of regions) if ((missing[r.id] ?? 0) > 0) void repairBlob($state.snapshot(r)); }}
		/>
	</EphemeralDock>
{/if}

<style>
.map-canvas { background: #34373d; }
</style>
