// A recording Mapbox/MapLibre double; the camera is a flat 400×800 px window over `box`. Needs happy-dom.
import type { FeatureCollection } from "geojson";
import type { Map as MapboxMap } from "mapbox-gl";
import { vi } from "vitest";
export type LngLatBox = { w: number; s: number; e: number; n: number };
export const PX = { w: 400, h: 800 };
type Fn = (e?: unknown) => void;
function sized(tag: string): HTMLElement {
	const el = Object.defineProperties(document.createElement(tag), { clientWidth: { value: PX.w }, clientHeight: { value: PX.h } });
	el.getBoundingClientRect = () => ({ left: 0, top: 0, width: PX.w, height: PX.h, right: PX.w, bottom: PX.h, x: 0, y: 0, toJSON: () => ({}) });
	return el;
}

export function mapDouble(box: LngLatBox = { w: -119.3, s: 50.2, e: -119.2, n: 50.3 }, zoom = 15) {
	const sources = new Map<string, FeatureCollection | Record<string, unknown>>();
	const handles = new Map<string, { setData: (d: FeatureCollection) => void; type: string; [k: string]: unknown }>();
	const layers: Record<string, unknown>[] = [];
	const paint: Record<string, Record<string, unknown>> = {}, layout: Record<string, Record<string, unknown>> = {};
	const filters: Record<string, unknown> = {};
	const featureState = new Map<string, Record<string, unknown>>();
	const handlers = new Map<string, Fn[]>();
	const key = (ev: string, layer?: unknown) => (typeof layer === "string" ? `${ev}:${layer}` : ev);
	const container = sized("div"), canvas = sized("canvas");
	const lngLat = (ll: { lng: number; lat: number } | [number, number]) => (Array.isArray(ll) ? ll : [ll.lng, ll.lat]);
	const map = {
		zoom,
		style: {} as unknown,
		getZoom: () => map.zoom,
		getCenter: () => ({ lng: (box.w + box.e) / 2, lat: (box.s + box.n) / 2 }),
		getBounds: () => ({ getSouthWest: () => ({ lng: box.w, lat: box.s }), getNorthEast: () => ({ lng: box.e, lat: box.n }) }),
		project: (ll: { lng: number; lat: number } | [number, number]) => {
			const [lng, lat] = lngLat(ll);
			return { x: ((lng - box.w) / (box.e - box.w)) * PX.w, y: ((box.n - lat) / (box.n - box.s)) * PX.h };
		},
		unproject: ([x, y]: [number, number]) => ({ lng: box.w + (x / PX.w) * (box.e - box.w), lat: box.n - (y / PX.h) * (box.n - box.s) }),
		addSource: (id: string, spec: Record<string, unknown>) => {
			sources.set(id, (spec.data as FeatureCollection) ?? spec);
			handles.set(id, { type: String(spec.type), setData: (d) => void sources.set(id, d), updateImage: vi.fn(), setTiles: vi.fn(), setCoordinates: vi.fn() });
		},
		getSource: (id: string) => handles.get(id),
		isSourceLoaded: (id: string) => handles.has(id),
		removeSource: (id: string) => void (sources.delete(id), handles.delete(id)),
		addLayer: (l: Record<string, unknown>, before?: string) => {
			const at = before ? layers.findIndex((x) => x.id === before) : -1;
			at < 0 ? layers.push(l) : layers.splice(at, 0, l);
		},
		getLayer: (id: string) => layers.find((l) => l.id === id),
		removeLayer: (id: string) => void layers.splice(layers.findIndex((l) => l.id === id) >>> 0, 1),
		setPaintProperty: (id: string, p: string, v: unknown) => void ((paint[id] ??= {})[p] = v),
		setLayoutProperty: (id: string, p: string, v: unknown) => void ((layout[id] ??= {})[p] = v),
		setFilter: (id: string, f: unknown) => void (filters[id] = f),
		setFeatureState: (t: { source: string; id: number | string }, s: Record<string, unknown>) =>
			void featureState.set(`${t.source}:${t.id}`, { ...featureState.get(`${t.source}:${t.id}`), ...s }),
		getFeatureState: (t: { source: string; id: number | string }) => featureState.get(`${t.source}:${t.id}`) ?? {},
		removeFeatureState: (t: { source: string; id?: number | string }) => void featureState.delete(`${t.source}:${t.id}`),
		queryRenderedFeatures: vi.fn((): unknown[] => []),
		isStyleLoaded: () => true, loaded: () => true,
		getStyle: () => ({ layers }),
		setStyle: vi.fn(), hasImage: vi.fn(() => false), addImage: vi.fn(),
		on: (ev: string, a: unknown, b?: Fn) => (handlers.set(key(ev, b ? a : undefined), [...(handlers.get(key(ev, b ? a : undefined)) ?? []), b ?? (a as Fn)]), map),
		off: (ev: string, a: unknown, b?: Fn) => (handlers.set(key(ev, b ? a : undefined), (handlers.get(key(ev, b ? a : undefined)) ?? []).filter((f) => f !== (b ?? a) && (f as { orig?: unknown }).orig !== (b ?? a))), map),
		once: (ev: string, fn: Fn) => {
			const wrap: Fn & { orig?: Fn } = (e) => (map.off(ev, wrap), fn(e));
			wrap.orig = fn;
			return map.on(ev, wrap);
		},
		getCanvas: () => canvas, getContainer: () => container, getCanvasContainer: () => container,
		getProjection: () => ({ name: "mercator" }),
		cameraForBounds: () => ({ center: map.getCenter(), zoom: 14, bearing: 0 }),
		stop: vi.fn(), easeTo: vi.fn(), flyTo: vi.fn(), jumpTo: vi.fn(), setTerrain: vi.fn(),
	};
	const fire = (ev: string, e?: unknown, layer?: string) => {
		for (const fn of [...(handlers.get(key(ev, layer)) ?? [])]) fn(e);
	};
	return { map: map as unknown as MapboxMap, raw: map, sources, layers, paint, layout, filters, featureState, handlers, fire, canvas, container };
}
