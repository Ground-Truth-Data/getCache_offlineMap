/** Directions on either map: the blue line, its draggable waypoints and one status pill. Reads tiles through `readTile`; never fetches on its own. */

import type * as maplibregl from "maplibre-gl";
import { m } from "$parent/src/lib/paraglide/messages";
import { longUnit } from "$gc/units.svelte";
import type { LngLat } from "../shared/kmGeo";
import { tileUrl } from "../worker/tilesHost";
import { decodeRoads, findRoute, type RoadLine, type RouteResult, type TileId } from "./roadGraph";

export const ROUTE_LAYER_IDS = {
	src: "rt-route-geo",
	casing: "rt-route-casing",
	line: "rt-route-line",
	off: "rt-route-off",
	via: "rt-route-via",
} as const;

const BLUE = "#1e6cff";
/** Pixels a press may wander and still be a tap — a tapped waypoint is removed. */
const TAP_PX = 6;
const DECODED_CAP = 3000;

export interface RouteLayerOptions {
	/** The pack's tile bytes for "z/x/y"; undefined when that tile is not on the phone. */
	readonly readTile: (key: string) => Promise<ArrayBuffer | undefined>;
	/** Where the drive starts: the last GPS fix. */
	readonly origin: () => LngLat | null;
}

export interface RouteHandle {
	(): void;
	to: (at: Readonly<LngLat>) => void;
}

// One map is live at a time; its route layer is the one every "Directions" button drives.
let live: RouteHandle | null = null;

export const canRoute = (): boolean => live !== null;

export function directionsTo(at: Readonly<LngLat>): void {
	live?.to(at);
}

type Drag = { kind: "new"; leg: number } | { kind: "move"; stop: number };
type Feature = GeoJSON.Feature<GeoJSON.Geometry, { role: string; stop?: number }>;

/** The tiles Worker's bytes for "z/x/y" — the online map's reader for tiles the pack lacks. A 204 is an empty tile. */
export async function networkTile(key: string): Promise<ArrayBuffer | undefined> {
	const [z, x, y] = key.split("/").map(Number);
	const url = tileUrl(z, x, y);
	if (!url) return undefined;
	const r = await fetch(url).catch(() => null);
	if (!r?.ok) return undefined;
	return r.status === 204 ? new ArrayBuffer(0) : r.arrayBuffer();
}

function distanceText(km: number): string {
	const u = longUnit();
	const n = (km * 1000) / u.metres;
	return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${u.name}`;
}

export function attachRouteLayer(map: maplibregl.Map, opts: RouteLayerOptions): RouteHandle {
	const decoded = new Map<string, RoadLine[]>();
	let stops: LngLat[] = [];
	let result: RouteResult | null = null;
	let ghost: LngLat | null = null;
	let drag: Drag | null = null;
	let downPx: { x: number; y: number } | null = null;
	let asked = 0;

	const pill = document.createElement("div");
	pill.className = "rt-route-pill";
	pill.hidden = true;
	map.getContainer().appendChild(pill);

	const say = (text: string, hint = false): void => {
		pill.hidden = false;
		pill.innerHTML = "";
		const body = document.createElement("div");
		body.className = "rt-route-pill-text";
		body.textContent = text;
		if (hint) {
			const h = document.createElement("div");
			h.className = "rt-route-pill-hint";
			h.textContent = m.ofmap_route_drag_hint();
			body.appendChild(h);
		}
		const x = document.createElement("button");
		x.type = "button";
		x.className = "rt-route-pill-x";
		x.setAttribute("aria-label", m.ofmap_route_clear());
		x.textContent = "✕";
		x.addEventListener("click", clear);
		pill.append(body, x);
	};

	const read = async (t: TileId): Promise<RoadLine[] | null> => {
		const key = `${t.z}/${t.x}/${t.y}`;
		const hit = decoded.get(key);
		if (hit) return hit;
		const bytes = await opts.readTile(key);
		if (bytes === undefined) return null;
		const lines = decodeRoads(t, bytes);
		if (decoded.size >= DECODED_CAP) decoded.delete(decoded.keys().next().value as string);
		decoded.set(key, lines);
		return lines;
	};

	const features = (): Feature[] => {
		const out: Feature[] = [];
		if (result?.ok) {
			out.push({ type: "Feature", properties: { role: "line" }, geometry: { type: "LineString", coordinates: result.line } });
			for (const seg of result.offRoad)
				out.push({ type: "Feature", properties: { role: "off" }, geometry: { type: "LineString", coordinates: seg } });
		}
		stops.forEach((s, i) => {
			if (i > 0 && i < stops.length - 1)
				out.push({ type: "Feature", properties: { role: "via", stop: i }, geometry: { type: "Point", coordinates: s } });
		});
		if (ghost && drag) {
			const [a, b] =
				drag.kind === "new" ? [stops[drag.leg], stops[drag.leg + 1]] : [stops[drag.stop - 1], stops[drag.stop + 1]];
			out.push({ type: "Feature", properties: { role: "via" }, geometry: { type: "Point", coordinates: ghost } });
			out.push({ type: "Feature", properties: { role: "off" }, geometry: { type: "LineString", coordinates: [a, ghost, b] } });
		}
		return out;
	};

	const addLayers = (): void => {
		if (map.getSource(ROUTE_LAYER_IDS.src)) return;
		map.addSource(ROUTE_LAYER_IDS.src, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
		const role = (r: string) => ["==", ["get", "role"], r] as maplibregl.FilterSpecification;
		const round = { "line-cap": "round", "line-join": "round" } as const;
		map.addLayer({ id: ROUTE_LAYER_IDS.casing, type: "line", source: ROUTE_LAYER_IDS.src, filter: role("line"), layout: round, paint: { "line-color": "#ffffff", "line-width": 9 } });
		map.addLayer({ id: ROUTE_LAYER_IDS.line, type: "line", source: ROUTE_LAYER_IDS.src, filter: role("line"), layout: round, paint: { "line-color": BLUE, "line-width": 5 } });
		map.addLayer({ id: ROUTE_LAYER_IDS.off, type: "line", source: ROUTE_LAYER_IDS.src, filter: role("off"), layout: round, paint: { "line-color": BLUE, "line-width": 3, "line-dasharray": [1, 2] } });
		map.addLayer({ id: ROUTE_LAYER_IDS.via, type: "circle", source: ROUTE_LAYER_IDS.src, filter: role("via"), paint: { "circle-radius": 8, "circle-color": "#ffffff", "circle-stroke-color": BLUE, "circle-stroke-width": 4 } });
	};

	const paint = (): void => {
		if (!map.isStyleLoaded()) return;
		addLayers();
		(map.getSource(ROUTE_LAYER_IDS.src) as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: features() });
	};

	const solve = async (fit: boolean): Promise<void> => {
		const mine = ++asked;
		say(m.ofmap_route_finding());
		const r = await findRoute(stops, read);
		if (mine !== asked) return;
		result = r;
		paint();
		if (r.ok) {
			say(m.ofmap_route_by_road({ distance: distanceText(r.km) }), true);
			if (fit) {
				const xs = r.line.map((p) => p[0]);
				const ys = r.line.map((p) => p[1]);
				map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, duration: 600 });
			}
			return;
		}
		const distance = distanceText(r.crowKm);
		say(
			r.reason === "too-far"
				? m.ofmap_route_too_far({ distance })
				: r.missing > 0
					? m.ofmap_route_not_downloaded({ distance })
					: m.ofmap_route_no_road({ distance }),
		);
	};

	function clear(): void {
		asked++;
		stops = [];
		result = null;
		ghost = null;
		drag = null;
		pill.hidden = true;
		paint();
	}

	const to = (dest: Readonly<LngLat>): void => {
		const from = opts.origin();
		if (!from) {
			clear();
			say(m.ofmap_route_no_fix());
			return;
		}
		stops = [from, [dest[0], dest[1]]];
		void solve(true);
	};

	/** Which leg a press on the line belongs to: the leg holding the nearest vertex. */
	const legAt = (at: LngLat): number => {
		if (!result?.ok) return 0;
		const p = map.project(at);
		let best = 0;
		let bd = Number.POSITIVE_INFINITY;
		result.line.forEach((v, i) => {
			const q = map.project(v);
			const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
			if (d < bd) {
				bd = d;
				best = i;
			}
		});
		const leg = result.legEnds.findIndex((end) => end >= best);
		return leg === -1 ? result.legEnds.length - 1 : leg;
	};

	type PressEvent = maplibregl.MapMouseEvent | maplibregl.MapTouchEvent;
	const onMove = (e: PressEvent): void => {
		ghost = [e.lngLat.lng, e.lngLat.lat];
		paint();
	};
	const onUp = (e: PressEvent): void => {
		map.off("mousemove", onMove);
		map.off("touchmove", onMove);
		map.off("mouseup", onUp);
		map.off("touchend", onUp);
		const d = drag;
		const moved = downPx ? Math.hypot(e.point.x - downPx.x, e.point.y - downPx.y) : 0;
		const at = ghost;
		drag = null;
		ghost = null;
		downPx = null;
		if (!d || !at) return paint();
		if (moved < TAP_PX) {
			if (d.kind === "move") {
				stops.splice(d.stop, 1);
				return void solve(false);
			}
			return paint();
		}
		if (d.kind === "new") stops.splice(d.leg + 1, 0, at);
		else stops[d.stop] = at;
		void solve(false);
	};
	const onDown = (e: PressEvent): void => {
		if (!result?.ok || drag) return;
		const oe = e.originalEvent as TouchEvent | MouseEvent;
		if ("touches" in oe && oe.touches.length !== 1) return;
		// Holds the map still while the line is pulled.
		e.preventDefault();
		const via = map.queryRenderedFeatures(e.point, { layers: [ROUTE_LAYER_IDS.via] })[0];
		const stop = Number(via?.properties?.stop);
		drag = Number.isInteger(stop) ? { kind: "move", stop } : { kind: "new", leg: legAt([e.lngLat.lng, e.lngLat.lat]) };
		downPx = { x: e.point.x, y: e.point.y };
		ghost = [e.lngLat.lng, e.lngLat.lat];
		map.on("mousemove", onMove);
		map.on("touchmove", onMove);
		map.on("mouseup", onUp);
		map.on("touchend", onUp);
	};
	const pressLayers = [ROUTE_LAYER_IDS.casing, ROUTE_LAYER_IDS.via];
	map.on("mousedown", pressLayers, onDown);
	map.on("touchstart", pressLayers, onDown);
	// A style swap drops every custom layer.
	map.on("styledata", paint);

	const handle = (): void => {
		if (live === handle) live = null;
		asked++;
		map.off("mousedown", pressLayers, onDown);
		map.off("touchstart", pressLayers, onDown);
		map.off("styledata", paint);
		map.off("mousemove", onMove);
		map.off("touchmove", onMove);
		map.off("mouseup", onUp);
		map.off("touchend", onUp);
		pill.remove();
	};
	handle.to = to;
	live = handle;
	return handle;
}
