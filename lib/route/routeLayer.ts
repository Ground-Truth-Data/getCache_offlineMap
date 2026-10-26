/** Directions on either map: the blue line, its draggable waypoints and one status pill. Reads tiles through `readTile`; never fetches on its own. */

import type * as maplibregl from "maplibre-gl";
import { m } from "$parent/src/lib/paraglide/messages";
import { safeEaseTo, safeFitBounds } from "$gc/safeMap";
import { longUnit } from "$gc/units.svelte";
import { kmBetween, type LngLat } from "../shared/kmGeo";
import { readStoredFix } from "../shared/liveFix";
import { tileUrl } from "../worker/tilesHost";
import { markerCtor } from "../shared/rendererOf";
import targetPinUrl from "./targetPin.webp";
import routeSignUrl from "./routeSign.svg";
import crowLineUrl from "./crowLine.svg";
import { ARRIVED_M, courseDeg, metresAlong, OFF_ROUTE_FIXES, OFF_ROUTE_M, progressOn } from "./follow";
import { fitsRoute, type RouteResult } from "./roadGraph";
import type { FromWorker, ToWorker } from "./routeWorker";

export const ROUTE_LAYER_IDS = {
	src: "rt-route-geo",
	done: "rt-route-done",
	casing: "rt-route-casing",
	line: "rt-route-line",
	alt: "rt-route-alt",
	off: "rt-route-off",
	via: "rt-route-via",
	me: "rt-route-me",
} as const;

const GOLD = "#F8D848";
/** The black edge that keeps gold readable over satellite. */
const INK = "#0b0b0b";
const RUST = "#c97a4a";
const HAND_PATHS =
	"<rect x='6' y='6' width='16' height='11' stroke='none'/><path d='M18 11V6a2 2 0 0 0-4 0'/><path d='M14 10V4a2 2 0 0 0-4 0v2'/><path d='M10 10.5V6a2 2 0 0 0-4 0v8'/><path d='M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'/>";
/** Over a waypoint: an open white hand edged in rust — this one moves, it doesn't add. */
const HAND_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
	`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='#fff' stroke='${RUST}' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'>${HAND_PATHS}</svg>`,
)}") 16 16, grab`;
/** The drag hint stops after this many routes: by then the trick is known. */
const HINT_ROUTES = 3;
const HINT_KEY = "gc.route.hints";
/** Screen px from the art's bottom edge up to its rust disc's centre — the disc is the point. */
const TARGET_DISC_PX = 1.6;
/** Survives a closed app without the database: a search target is not a record, it's where you were headed. */
const SAVED_KEY = "gc.route.v1";
const FOLLOW_ZOOM = 16;
/** Pixels a press may wander and still be a tap — a tapped waypoint is removed. */
const TAP_PX = 6;
/** A fresh line draws itself in over this long — the answer reads as arriving, not as a jump. */
const REVEAL_MS = 700;

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
	reach: (at: Readonly<LngLat>) => Reach | null;
}

/** How far a place is from the last GPS fix, and whether a road route can be tried or it's a straight line. */
export type Reach = { readonly km: number; readonly road: boolean };

// One map is live at a time; its route layer is the one every "Directions" button drives.
let live: RouteHandle | null = null;

export const canRoute = (): boolean => live !== null;

const reachFrom = (from: LngLat | null, at: Readonly<LngLat>): Reach | null =>
	from ? { km: kmBetween(from, at), road: fitsRoute([from, [at[0], at[1]]]) } : null;

/** Never asks for a fix: null until the phone has one. Cheap enough for every list row; off the map, the stored fix. */
export function fromYou(at: Readonly<LngLat>): Reach | null {
	return live ? live.reach(at) : reachFrom(readStoredFix(), at);
}

/** "3.2 km" in the user's long unit — the one spelling every distance on the map shares. */
export function distanceText(km: number): string {
	const u = longUnit();
	const n = (km * 1000) / u.metres;
	return `${n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US")} ${u.name}`;
}

/** Off the map (the inbox), the trip is saved for the map's restore to solve when it opens. */
export function directionsTo(at: Readonly<LngLat>): void {
	if (live) live.to(at);
	else localStorage.setItem(SAVED_KEY, JSON.stringify({ target: null, ahead: [[at[0], at[1]]] }));
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
type Feature = GeoJSON.Feature<GeoJSON.Geometry, { role: string; stop?: number; hot?: boolean }>;

/** The tiles Worker's bytes for "z/x/y" — the online map's reader for tiles the pack lacks. A 204 is an empty tile. */
export async function networkTile(key: string): Promise<ArrayBuffer | undefined> {
	const [z, x, y] = key.split("/").map(Number);
	const url = tileUrl(z, x, y);
	if (!url) return undefined;
	const r = await fetch(url).catch(() => null);
	if (!r?.ok) return undefined;
	return r.status === 204 ? new ArrayBuffer(0) : r.arrayBuffer();
}

export function attachRouteLayer(map: maplibregl.Map, opts: RouteLayerOptions): RouteHandle {
	let stops: LngLat[] = [];
	let result: RouteResult | null = null;
	let ghost: LngLat | null = null;
	let drag: Drag | null = null;
	/** The road through the ghost, solved while the finger is still down. */
	let alt: LngLat[] | null = null;
	let peeking = false;
	/** Under the mouse on the line: anywhere on it can be grabbed. */
	let hover: LngLat | null = null;
	/** The waypoint under the mouse: it glows rust and no second node is offered on top of it. */
	let hot: number | null = null;
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
	/** Past the road graph's reach: the honest answer is a straight line and a bearing. */
	let crow: [LngLat, LngLat] | null = null;
	// A DOM marker, not a map layer: block labels are DOM markers, and every DOM marker sits above the canvas.
	const pinEl = document.createElement("img");
	pinEl.src = targetPinUrl;
	pinEl.alt = "";
	pinEl.className = "rt-target-pin";
	const pin = new (markerCtor(map) as unknown as typeof maplibregl.Marker)({ element: pinEl, anchor: "bottom", offset: [0, TARGET_DISC_PX] });

	const pill = document.createElement("div");
	pill.className = "rt-route-pill";
	pill.hidden = true;
	map.getContainer().appendChild(pill);
	const words = document.createElement("b");
	let pillAction: string | null = null;

	const hintBar = document.createElement("div");
	hintBar.className = "rt-route-hint";
	hintBar.hidden = true;
	const hintDo = document.createElement("b");
	hintBar.append(hintDo, "");
	map.getContainer().appendChild(hintBar);
	const hintOnce = (): void => {
		let shown = 0;
		try {
			shown = Number(localStorage.getItem(HINT_KEY)) || 0;
			if (shown >= HINT_ROUTES) return;
			localStorage.setItem(HINT_KEY, String(shown + 1));
		} catch {
			// codestyle-allow-swallow: storage blocked — the hint just shows again.
		}
		hintDo.textContent = m.ofmap_route_drag_line();
		hintBar.lastChild!.textContent = ` ${m.ofmap_route_drag_hint()}`;
		hintBar.hidden = false;
	};

	/** The number white and big, every other word the unit's grey. */
	const setWords = (text: string): void => {
		const n = /\d[\d,.]*/.exec(text);
		const unit = (s: string): HTMLElement => Object.assign(document.createElement("span"), { className: "u", textContent: s });
		words.replaceChildren(...(n ? [unit(text.slice(0, n.index)), n[0], unit(text.slice(n.index + n[0].length))] : [text]));
	};

	const button = (className: string, label: string, run: () => void): HTMLButtonElement => {
		const b = document.createElement("button");
		b.type = "button";
		b.className = className;
		b.setAttribute("aria-label", label);
		b.addEventListener("click", run);
		return b;
	};

	/** While following, the banner shrinks to a chip — live dot, distance left, stop — and gives the map back. */
	const say = (text: string, hint?: string, action?: { label: string; run: () => void }): void => {
		const chip = following && !!action;
		// Same button as last time: swap the words only, so a fix landing mid-tap never rebuilds the button under the thumb.
		if (!pill.hidden && (action?.label ?? null) === pillAction && !hint && chip === pill.classList.contains("rt-route-chip")) {
			setWords(text);
			return;
		}
		pill.hidden = false;
		pill.replaceChildren();
		pill.classList.toggle("rt-route-chip", chip);
		pillAction = action?.label ?? null;
		setWords(text);
		if (chip) {
			const stop = button("rt-route-stop", action.label, action.run);
			stop.append(document.createElement("i"));
			pill.append(Object.assign(document.createElement("span"), { className: "rt-route-live" }), words, stop);
			return;
		}
		const icon = Object.assign(document.createElement("img"), { src: crow ? crowLineUrl : routeSignUrl, alt: "", className: "rt-route-icon" });
		const body = document.createElement("div");
		body.className = "rt-route-pill-text";
		body.append(words);
		if (hint) body.append(Object.assign(document.createElement("span"), { className: "rt-route-pill-hint", textContent: hint }));
		pill.append(icon, body);
		if (action) pill.append(Object.assign(button("rt-route-pill-go", action.label, action.run), { textContent: action.label }));
		pill.append(Object.assign(button("rt-route-pill-x", m.ofmap_route_clear(), clear), { textContent: "✕" }));
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
			say(m.ofmap_route_to_go({ distance: distanceText((toGoM ?? along[along.length - 1]) / 1000) }), undefined, {
				label: m.ofmap_route_stop_follow(),
				run: () => setFollow(false),
			});
		else
			say(m.ofmap_route_by_road({ distance: distanceText(result.km) }), undefined, {
				label: m.ofmap_route_follow(),
				run: () => setFollow(true),
			});
	};

	function setFollow(on: boolean): void {
		following = on;
		hintBar.hidden = true;
		offFixes = 0;
		stayAwake(on);
		if (!on) me = null;
		showRoute();
		paint();
		const at = lastFix ?? opts.origin();
		if (on && at) fix(at[0], at[1]);
	}

	const worker = new Worker(new URL("./routeWorker.ts", import.meta.url), { type: "module" });
	const jobs = new Map<number, { ok: (r: RouteResult) => void; fail: (e: unknown) => void }>();
	let jobN = 0;
	const tell = (m: ToWorker): void => worker.postMessage(m);
	worker.onmessage = (e: MessageEvent<FromWorker>): void => {
		const m = e.data;
		if (m.kind === "done") {
			jobs.get(m.job)?.ok(m.result);
			jobs.delete(m.job);
			return;
		}
		void opts.readTile(m.key).then(
			(bytes) => tell({ kind: "tile", ask: m.ask, bytes }),
			() => tell({ kind: "tile", ask: m.ask, bytes: undefined }),
		);
	};
	worker.onerror = (e): void => {
		for (const j of jobs.values()) j.fail(e);
		jobs.clear();
	};
	const route = (s: LngLat[]): Promise<RouteResult> =>
		new Promise((ok, fail) => {
			const job = ++jobN;
			jobs.set(job, { ok, fail });
			tell({ kind: "route", job, stops: s });
		});

	/** How many of the line's points are drawn — a fresh line grows into place. */
	let drawn = Number.POSITIVE_INFINITY;
	const reveal = (mine: number, n: number): void => {
		const t0 = performance.now();
		const step = (now: number): void => {
			if (mine !== asked) return;
			const k = Math.min(1, (now - t0) / REVEAL_MS);
			drawn = k < 1 ? Math.max(2, Math.ceil(k * n)) : Number.POSITIVE_INFINITY;
			paint();
			if (k < 1) requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	};

	const features = (): Feature[] => {
		const out: Feature[] = [];
		if (result?.ok) {
			let line = drawn < result.line.length ? result.line.slice(0, drawn) : result.line;
			if (following && me) {
				out.push({ type: "Feature", properties: { role: "done" }, geometry: { type: "LineString", coordinates: [...line.slice(0, from + 1), me] } });
				line = [me, ...line.slice(from + 1)];
			}
			out.push({ type: "Feature", properties: { role: "line" }, geometry: { type: "LineString", coordinates: line } });
			for (const seg of result.offRoad)
				out.push({ type: "Feature", properties: { role: "off" }, geometry: { type: "LineString", coordinates: seg } });
			// A waypoint lives on its line: none while solving, none on a straight-line answer. The one being moved is drawn by its ghost alone.
			stops.forEach((s, i) => {
				if (i > 0 && i < stops.length - 1 && !(drag?.kind === "move" && drag.stop === i && ghost))
					out.push({ type: "Feature", properties: { role: "via", stop: i, hot: i === hot }, geometry: { type: "Point", coordinates: s } });
			});
		}
		if (ghost && drag) {
			const [a, b] =
				drag.kind === "new" ? [stops[drag.leg], stops[drag.leg + 1]] : [stops[drag.stop - 1], stops[drag.stop + 1]];
			out.push({ type: "Feature", properties: { role: "via" }, geometry: { type: "Point", coordinates: ghost } });
			// The road answer once it's in, a straight guess until then; the route itself stays solid underneath.
			out.push({ type: "Feature", properties: { role: alt ? "alt" : "off" }, geometry: { type: "LineString", coordinates: alt ?? [a, ghost, b] } });
		} else if (hover)
			out.push({ type: "Feature", properties: { role: "via" }, geometry: { type: "Point", coordinates: hover } });
		if (following && me) out.push({ type: "Feature", properties: { role: "me" }, geometry: { type: "Point", coordinates: me } });
		if (crow) out.push({ type: "Feature", properties: { role: "off" }, geometry: { type: "LineString", coordinates: crow } });
		return out;
	};

	const addLayers = (): void => {
		if (map.getSource(ROUTE_LAYER_IDS.src)) return;
		map.addSource(ROUTE_LAYER_IDS.src, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
		const role = (r: string) => ["==", ["get", "role"], r] as maplibregl.FilterSpecification;
		const round = { "line-cap": "round", "line-join": "round" } as const;
		// Dash lengths are in line widths: 2px on, 9px off at 5px wide.
		map.addLayer({ id: ROUTE_LAYER_IDS.done, type: "line", source: ROUTE_LAYER_IDS.src, filter: role("done"), layout: round, paint: { "line-color": GOLD, "line-opacity": 0.3, "line-width": 5, "line-dasharray": [0.4, 1.8] } });
		// Under the route: where the two share road the alternative hides, so only where it leaves shows dotted.
		map.addLayer({ id: ROUTE_LAYER_IDS.alt, type: "line", source: ROUTE_LAYER_IDS.src, filter: role("alt"), layout: round, paint: { "line-color": GOLD, "line-width": 6, "line-dasharray": [0.1, 2] } });
		map.addLayer({ id: ROUTE_LAYER_IDS.casing, type: "line", source: ROUTE_LAYER_IDS.src, filter: role("line"), layout: round, paint: { "line-color": INK, "line-width": 11 } });
		map.addLayer({ id: ROUTE_LAYER_IDS.line, type: "line", source: ROUTE_LAYER_IDS.src, filter: role("line"), layout: round, paint: { "line-color": GOLD, "line-width": 6 } });
		map.addLayer({ id: ROUTE_LAYER_IDS.off, type: "line", source: ROUTE_LAYER_IDS.src, filter: role("off"), layout: round, paint: { "line-color": GOLD, "line-width": 3, "line-dasharray": [1, 2] } });
		map.addLayer({ id: ROUTE_LAYER_IDS.via, type: "circle", source: ROUTE_LAYER_IDS.src, filter: role("via"), paint: { "circle-radius": ["case", ["boolean", ["get", "hot"], false], 10, 8], "circle-color": GOLD, "circle-stroke-color": ["case", ["boolean", ["get", "hot"], false], RUST, INK], "circle-stroke-width": 3 } });
		map.addLayer({ id: ROUTE_LAYER_IDS.me, type: "circle", source: ROUTE_LAYER_IDS.src, filter: role("me"), paint: { "circle-radius": 8, "circle-color": INK, "circle-stroke-color": GOLD, "circle-stroke-width": 3 } });
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
		if (target) pin.setLngLat(target).addTo(map);
		else pin.remove();
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
		addLayers();
		(map.getSource(ROUTE_LAYER_IDS.src) as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: features() });
	};

	const fitTo = (pts: readonly LngLat[]): void => {
		const xs = pts.map((p) => p[0]);
		const ys = pts.map((p) => p[1]);
		safeFitBounds(map, [Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], { padding: 60, duration: 600 });
	};

	/** A dashed line from here to there, its length and compass point — and why, when a road route was tried. */
	const showCrow = (why?: string): void => {
		const a = stops[0];
		const b = stops[stops.length - 1];
		result = null;
		crow = [a, b];
		paint();
		if (!following) fitTo(crow);
		const deg = (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI;
		const points = m.ofmap_route_compass().split(" ");
		const bearing = points[Math.round(((deg + 360) % 360) / (360 / points.length)) % points.length];
		say(m.ofmap_route_crow({ distance: distanceText(kmBetween(a, b)), bearing }), why);
	};

	const solve = async (fit: boolean, finding = m.ofmap_route_finding()): Promise<void> => {
		const mine = ++asked;
		crow = null;
		if (!fitsRoute(stops)) {
			showCrow();
			return;
		}
		solving = true;
		say(finding);
		// Frame the trip now; the route arrives into a view that already holds it.
		if (fit && !following) fitTo(stops);
		let r: RouteResult;
		try {
			r = await route(stops);
		} catch (e) {
			console.error("[route] the router worker failed", e);
			if (mine === asked) clear();
			return;
		} finally {
			if (mine === asked) solving = false;
		}
		if (mine !== asked) return;
		result = r;
		drawn = fit && r.ok && !following ? 2 : Number.POSITIVE_INFINITY;
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
				fitTo(r.line);
				reveal(mine, r.line.length);
				hintOnce();
			}
			return;
		}
		showCrow(r.reason === "too-far" ? undefined : r.missing > 0 ? m.ofmap_route_not_downloaded() : m.ofmap_route_no_road());
	};

	function clear(): void {
		asked++;
		solving = false;
		stops = [];
		result = null;
		crow = null;
		ghost = null;
		drag = null;
		hover = null;
		hot = null;
		following = false;
		me = null;
		target = null;
		stayAwake(false);
		pill.hidden = true;
		hintBar.hidden = true;
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
			safeEaseTo(map, { center: at, bearing, zoom, duration: 900, essential: true });
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
		safeEaseTo(map, { center: p.snapped, bearing, zoom, duration: 900, essential: true });
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
	const trial = (): LngLat[] | null => {
		if (!drag || !ghost) return null;
		const s = [...stops];
		if (drag.kind === "new") s.splice(drag.leg + 1, 0, ghost);
		else s[drag.stop] = ghost;
		return s;
	};
	/** One solve in flight at a time; when it lands, the next one asks from wherever the finger is now. */
	const peek = (): void => {
		const s = trial();
		if (peeking || !s) return;
		peeking = true;
		const at = ghost;
		route(s)
			.then((r) => (alt = drag && r.ok ? r.line : null), () => (alt = null))
			.finally(() => {
				peeking = false;
				paint();
				if (drag && ghost !== at) peek();
			});
	};
	const onMove = (e: PressEvent): void => {
		ghost = [e.lngLat.lng, e.lngLat.lat];
		paint();
		peek();
	};
	const onLine = (p: { x: number; y: number }): boolean =>
		map.queryRenderedFeatures([[p.x - 8, p.y - 8], [p.x + 8, p.y + 8]], { layers: [ROUTE_LAYER_IDS.casing] }).length > 0;
	const onHover = (e: maplibregl.MapMouseEvent): void => {
		if (drag || following) return;
		const stop = map.queryRenderedFeatures(e.point, { layers: [ROUTE_LAYER_IDS.via] }).find((f) => Number.isInteger(f.properties?.stop))?.properties?.stop;
		hot = stop ?? null;
		hover = hot === null ? [e.lngLat.lng, e.lngLat.lat] : null;
		map.getCanvas().style.cursor = hot === null ? "grab" : HAND_CURSOR;
		paint();
	};
	const onLeave = (): void => {
		hover = null;
		hot = null;
		map.getCanvas().style.cursor = "";
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
		alt = null;
		downPx = null;
		map.getCanvas().style.cursor = "";
		// Pulled out and put back: no node, the route as it was.
		if (!d || !at || (d.kind === "new" && onLine(e.point))) return paint();
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
		hintBar.hidden = true;
		hover = null;
		hot = null;
		map.getCanvas().style.cursor = "grabbing";
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

	pinEl.addEventListener("click", (e) => {
		e.stopPropagation();
		target = null;
		paint();
	});
	const pressLayers = [ROUTE_LAYER_IDS.casing, ROUTE_LAYER_IDS.via];
	map.on("mousedown", pressLayers, onDown);
	map.on("touchstart", pressLayers, onDown);
	map.on("dragstart", onDragStart);
	map.on("mousemove", pressLayers, onHover);
	map.on("mouseleave", pressLayers, onLeave);
	// A style swap drops every custom layer.
	map.on("styledata", paint);

	const handle = (): void => {
		if (live === handle) live = null;
		asked++;
		map.off("mousedown", pressLayers, onDown);
		map.off("touchstart", pressLayers, onDown);
		map.off("dragstart", onDragStart);
		map.off("mousemove", pressLayers, onHover);
		map.off("mouseleave", pressLayers, onLeave);
		map.off("styledata", paint);
		stayAwake(false);
		worker.terminate();
		map.off("mousemove", onMove);
		map.off("touchmove", onMove);
		map.off("mouseup", onUp);
		map.off("touchend", onUp);
		pill.remove();
		hintBar.remove();
		pin.remove();
	};
	handle.to = to;
	handle.fix = fix;
	handle.reach = (at: Readonly<LngLat>): Reach | null => reachFrom(lastFix ?? opts.origin(), at);
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
