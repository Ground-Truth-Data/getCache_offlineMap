/** Directions on either map: the blue line, its draggable waypoints and one status pill. Reads tiles through `readTile`; never fetches on its own. */

import type * as maplibregl from "maplibre-gl";
import { m } from "$parent/src/lib/paraglide/messages";
import { longUnit } from "$gc/units.svelte";
import type { LngLat } from "../shared/kmGeo";
import { tileUrl } from "../worker/tilesHost";
import { loadMapImage } from "../shared/rendererOf";
import targetPinUrl from "./targetPin.webp";
import { ARRIVED_M, courseDeg, metresAlong, OFF_ROUTE_FIXES, OFF_ROUTE_M, progressOn } from "./follow";
import { decodeRoads, findRoute, type RoadLine, type RouteResult, type TileId } from "./roadGraph";

export const ROUTE_LAYER_IDS = {
	src: "rt-route-geo",
	casing: "rt-route-casing",
	line: "rt-route-line",
	off: "rt-route-off",
	via: "rt-route-via",
	me: "rt-route-me",
	target: "rt-route-target",
} as const;

const BLUE = "#1e6cff";
const TARGET_IMAGE = "rt-target-pin";
/** Screen px from the art's bottom edge up to its rust disc's centre — the disc is the point. The art is drawn at pixelRatio 3. */
const TARGET_DISC_PX = 1.6;
/** Survives a closed app without the database: a search target is not a record, it's where you were headed. */
const SAVED_KEY = "gc.route.v1";
const FOLLOW_ZOOM = 16;
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
	fix: (lng: number, lat: number) => void;
	mark: (at: Readonly<LngLat>) => void;
}

// One map is live at a time; its route layer is the one every "Directions" button drives.
let live: RouteHandle | null = null;

export const canRoute = (): boolean => live !== null;

export function directionsTo(at: Readonly<LngLat>): void {
	live?.to(at);
}

/** A searched place: the classic map pin, there until tapped, cleared or replaced. Never on a pin or feature already drawn. */
export function searchTarget(at: Readonly<LngLat>): void {
	live?.mark(at);
}

/** Every live GPS fix; drives follow mode and the off-route check. */
export function routeFix(lng: number, lat: number): void {
	live?.fix(lng, lat);
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
	let solving = false;
	let following = false;
	let along: number[] = [];
	/** Segment the last on-route fix sat on — progress only looks forward from here. */
	let from = 0;
	let heading: number | null = null;
	let lastFix: LngLat | null = null;
	let me: LngLat | null = null;
	let offFixes = 0;
	let wake: WakeLockSentinel | null = null;
	let target: LngLat | null = null;
	let pinImage: Promise<void> | null = null;

	const pill = document.createElement("div");
	pill.className = "rt-route-pill";
	pill.hidden = true;
	map.getContainer().appendChild(pill);
	let pillText: Text | null = null;
	let pillAction: string | null = null;

	const say = (text: string, hint = false, action?: { label: string; run: () => void }): void => {
		// Same button as last time: swap the words only, so a fix landing mid-tap never rebuilds the button under the thumb.
		if (pillText && !pill.hidden && (action?.label ?? null) === pillAction && !hint) {
			pillText.data = text;
			return;
		}
		pill.hidden = false;
		pill.innerHTML = "";
		pillAction = action?.label ?? null;
		const body = document.createElement("div");
		body.className = "rt-route-pill-text";
		pillText = document.createTextNode(text);
		body.appendChild(pillText);
		if (hint) {
			const h = document.createElement("div");
			h.className = "rt-route-pill-hint";
			h.textContent = m.ofmap_route_drag_hint();
			body.appendChild(h);
		}
		pill.append(body);
		if (action) {
			const b = document.createElement("button");
			b.type = "button";
			b.className = "rt-route-pill-go rt-directions";
			b.textContent = action.label;
			b.addEventListener("click", action.run);
			pill.append(b);
		}
		const x = document.createElement("button");
		x.type = "button";
		x.className = "rt-route-pill-x";
		x.setAttribute("aria-label", m.ofmap_route_clear());
		x.textContent = "✕";
		x.addEventListener("click", clear);
		pill.append(x);
	};

	const stayAwake = (on: boolean): void => {
		if (!on) {
			void wake?.release();
			wake = null;
			return;
		}
		if (wake || !("wakeLock" in navigator)) return;
		navigator.wakeLock.request("screen").then(
			(w) => {
				if (following) wake = w;
				else void w.release();
			},
			(e) => console.warn("[route] screen may sleep while following", e),
		);
	};

	const showRoute = (toGoM?: number): void => {
		if (!result?.ok) return;
		if (following)
			say(m.ofmap_route_to_go({ distance: distanceText((toGoM ?? along[along.length - 1]) / 1000) }), false, {
				label: m.ofmap_route_stop_follow(),
				run: () => setFollow(false),
			});
		else
			say(m.ofmap_route_by_road({ distance: distanceText(result.km) }), true, {
				label: m.ofmap_route_follow(),
				run: () => setFollow(true),
			});
	};

	function setFollow(on: boolean): void {
		following = on;
		offFixes = 0;
		stayAwake(on);
		if (!on) me = null;
		showRoute();
		paint();
		const at = lastFix ?? opts.origin();
		if (on && at) fix(at[0], at[1]);
	}

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
		if (following && me) out.push({ type: "Feature", properties: { role: "me" }, geometry: { type: "Point", coordinates: me } });
		if (target && map.hasImage(TARGET_IMAGE)) out.push({ type: "Feature", properties: { role: "target" }, geometry: { type: "Point", coordinates: target } });
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
		map.addLayer({ id: ROUTE_LAYER_IDS.me, type: "circle", source: ROUTE_LAYER_IDS.src, filter: role("me"), paint: { "circle-radius": 10, "circle-color": BLUE, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
		map.addLayer({
			id: ROUTE_LAYER_IDS.target,
			type: "symbol",
			source: ROUTE_LAYER_IDS.src,
			filter: role("target"),
			layout: { "icon-image": TARGET_IMAGE, "icon-anchor": "bottom", "icon-offset": [0, TARGET_DISC_PX], "icon-allow-overlap": true, "icon-ignore-placement": true },
		});
	};

	const remember = (): void => {
		try {
			if (!target && !stops.length) localStorage.removeItem(SAVED_KEY);
			else localStorage.setItem(SAVED_KEY, JSON.stringify({ target, ahead: stops.slice(1) }));
		} catch (e) {
			console.warn("[route] could not keep the route for next launch", e);
		}
	};

	let waiting = false;
	const paint = (): void => {
		remember();
		// Mapbox reports busy all through a flight; a dropped paint here was a pin that landed seconds late.
		if (!map.isStyleLoaded()) {
			if (!waiting) {
				waiting = true;
				map.once("idle", () => {
					waiting = false;
					paint();
				});
			}
			return;
		}
		if (target && !map.hasImage(TARGET_IMAGE))
			pinImage ??= loadMapImage(map, targetPinUrl).then(
				(img) => {
					pinImage = null;
					if (!map.hasImage(TARGET_IMAGE)) map.addImage(TARGET_IMAGE, img, { pixelRatio: 3 });
					paint();
				},
				(e) => console.warn("[route] target pin art failed to load", e),
			);
		addLayers();
		(map.getSource(ROUTE_LAYER_IDS.src) as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: features() });
	};

	const solve = async (fit: boolean, finding = m.ofmap_route_finding()): Promise<void> => {
		const mine = ++asked;
		solving = true;
		say(finding);
		const r = await findRoute(stops, read).finally(() => {
			if (mine === asked) solving = false;
		});
		if (mine !== asked) return;
		result = r;
		from = 0;
		along = r.ok ? metresAlong(r.line) : [];
		if (!r.ok && following) {
			following = false;
			me = null;
			stayAwake(false);
		}
		paint();
		if (r.ok) {
			showRoute();
			if (fit && !following) {
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
		solving = false;
		stops = [];
		result = null;
		ghost = null;
		drag = null;
		following = false;
		me = null;
		target = null;
		stayAwake(false);
		pill.hidden = true;
		paint();
	}

	/** Re-route offline from where the truck is, through the waypoints still ahead. */
	const reroute = (at: LngLat): void => {
		offFixes = 0;
		const leg = result?.ok ? Math.max(0, result.legEnds.findIndex((end) => end > from)) : 0;
		stops = [at, ...stops.slice(leg + 1)];
		void solve(false, m.ofmap_route_off());
	};

	function fix(lng: number, lat: number): void {
		const at: LngLat = [lng, lat];
		const turned = lastFix ? courseDeg(lastFix, at) : null;
		// A small move keeps the old anchor, so a slow crawl still adds up to a heading.
		if (turned !== null) heading = turned;
		if (turned !== null || !lastFix) lastFix = at;
		if (!following || !result?.ok || solving) return;
		const bearing = heading ?? map.getBearing();
		const zoom = Math.max(map.getZoom(), FOLLOW_ZOOM);
		const p = progressOn(result.line, along, at, from);
		if (p.offM > OFF_ROUTE_M) {
			me = null;
			paint();
			map.easeTo({ center: at, bearing, zoom, duration: 900, essential: true });
			if (++offFixes >= OFF_ROUTE_FIXES) reroute(at);
			return;
		}
		offFixes = 0;
		from = p.index;
		if (p.toGoM < ARRIVED_M) {
			following = false;
			me = null;
			stayAwake(false);
			paint();
			say(m.ofmap_route_arrived());
			return;
		}
		me = p.snapped;
		showRoute(p.toGoM);
		paint();
		map.easeTo({ center: p.snapped, bearing, zoom, duration: 900, essential: true });
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
	// A hand on the map means "let me look": follow pauses, the Follow button brings it back.
	const onDragStart = (e: { originalEvent?: Event }): void => {
		if (!following || !e.originalEvent) return;
		following = false;
		me = null;
		stayAwake(false);
		showRoute();
		paint();
	};
	/** A pebble in a puddle: three rings out from the pin until they leave the screen, once. */
	const ripple = (): void => {
		if (!target) return;
		const at = target;
		const c = map.getContainer();
		const box = document.createElement("div");
		box.className = "rt-target-ripple";
		// A different splash every drop: two dark rings at a random gap, a faint one riding right behind either.
		const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
		const second = rand(0.35, 1.1);
		const ring = (delay: number, px: number, faint = false): HTMLElement => {
			const i = document.createElement("i");
			i.style.animationDelay = `${delay}s`;
			i.style.borderWidth = `${px}px`;
			if (faint) i.className = "faint";
			return i;
		};
		box.append(
			ring(0, rand(3.5, 5.5)),
			ring(second, rand(3, 5)),
			ring((Math.random() < 0.5 ? 0 : second) + rand(0.08, 0.2), rand(1.5, 2.5), true),
		);
		const place = (): void => {
			const p = map.project(at);
			box.style.transform = `translate(${p.x}px, ${p.y}px)`;
		};
		place();
		// Just past the farthest corner, so every ring spends its whole life on screen.
		const p = map.project(at);
		const reach = Math.hypot(Math.max(p.x, c.clientWidth - p.x), Math.max(p.y, c.clientHeight - p.y));
		box.style.setProperty("--d", `${2 * reach + 40}px`);
		map.on("move", place);
		let running = box.children.length;
		box.addEventListener("animationend", () => {
			if (--running) return;
			map.off("move", place);
			box.remove();
		});
		c.appendChild(box);
	};

	const onTargetTap = (): void => {
		target = null;
		paint();
	};
	const pressLayers = [ROUTE_LAYER_IDS.casing, ROUTE_LAYER_IDS.via];
	map.on("mousedown", pressLayers, onDown);
	map.on("touchstart", pressLayers, onDown);
	map.on("click", ROUTE_LAYER_IDS.target, onTargetTap);
	map.on("dragstart", onDragStart);
	// A style swap drops every custom layer.
	map.on("styledata", paint);

	const handle = (): void => {
		if (live === handle) live = null;
		asked++;
		map.off("mousedown", pressLayers, onDown);
		map.off("touchstart", pressLayers, onDown);
		map.off("click", ROUTE_LAYER_IDS.target, onTargetTap);
		map.off("dragstart", onDragStart);
		map.off("styledata", paint);
		stayAwake(false);
		map.off("mousemove", onMove);
		map.off("touchmove", onMove);
		map.off("mouseup", onUp);
		map.off("touchend", onUp);
		pill.remove();
	};
	handle.to = to;
	handle.fix = fix;
	handle.mark = (at: Readonly<LngLat>) => {
		target = [at[0], at[1]];
		paint();
		// After the flight lands, so the eye is pulled to where the map stopped.
		map.once("idle", ripple);
	};
	live = handle;

	// The app was closed mid-trip: put the pin back and re-solve from wherever the phone is now.
	try {
		const saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null") as { target: LngLat | null; ahead: LngLat[] } | null;
		target = saved?.target ?? null;
		const start = opts.origin();
		if (saved?.ahead.length && start) {
			stops = [start, ...saved.ahead];
			void solve(false);
		} else paint();
	} catch (e) {
		console.warn("[route] saved route unreadable", e);
	}
	return handle;
}
