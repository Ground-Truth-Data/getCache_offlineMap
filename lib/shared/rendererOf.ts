// Two renderers are live and are not interchangeable at runtime: /mobile/map uses Mapbox GL JS, /mobile/offlinev4 uses MapLibre GL JS (see wallProtocol.ts).
// Wrong library's Marker/Popup on a map doesn't fail politely — it throws "TypeError: e2._addMarker is not a function" from inside addTo (Mapbox-only private method); observed as a BLACK map with no blue dot.
// Worse, if it doesn't throw: a Popup from the wrong library gets the other namespace's DOM classes, so close-button wiring and CSS silently no-op.
// Sniffs the live instance rather than a passed "library" flag — a flag can be forgotten at a call site and reintroduce the wrong-library bug; the instance can't lie.
// Prefer an explicit injection point where one exists (fireLayer's popupLib) — this file is only for helpers with no such seam.

import type mapboxgl from "mapbox-gl";
import * as maplibregl from "maplibre-gl";

// Mapbox is never imported here: the offline route is MapLibre-only, and a static import would ship Mapbox's ~1.7 MB to it. A Mapbox map's creator hands the library over before its first marker.
let mapbox: typeof mapboxgl | undefined;
export function useMapbox(lib: typeof mapboxgl): void {
	mapbox = lib;
}

// True when built by MapLibre; defaults FALSE (Mapbox) if the probe fails, so unrecognised maps keep existing behaviour.
export function isMaplibreMap(map: unknown): boolean {
	const el = (
		map as { getCanvasContainer?: () => HTMLElement | undefined } | null
	)?.getCanvasContainer?.();
	return el?.className?.includes("maplibregl") ?? false;
}

// Synchronous on purpose — pin rendering is a hot loop (one call per pin per reconcile) that can't await a per-marker import.
// Callers construct with: new (markerCtor(map))({...})
export function markerCtor(map: unknown): typeof mapboxgl.Marker {
	return isMaplibreMap(map)
		? (maplibregl.Marker as unknown as typeof mapboxgl.Marker)
		: mapbox!.Marker;
}

/** The `Popup` class for this map — SYNCHRONOUS. Same rationale as markerCtor. */
export function popupCtor(map: unknown): typeof mapboxgl.Popup {
	return isMaplibreMap(map)
		? (maplibregl.Popup as unknown as typeof mapboxgl.Popup)
		: mapbox!.Popup;
}
