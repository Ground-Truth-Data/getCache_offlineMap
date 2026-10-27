// Two renderers are live and are not interchangeable at runtime: every map is MapLibre GL JS but georef's pane, which is still Mapbox GL JS.
// Wrong library's Marker/Popup on a map doesn't fail politely — it throws "TypeError: e2._addMarker is not a function" from inside addTo (Mapbox-only private method); observed as a BLACK map with no blue dot.
// Worse, if it doesn't throw: a Popup from the wrong library gets the other namespace's DOM classes, so close-button wiring and CSS silently no-op.
// Sniffs the live instance rather than a passed "library" flag — a flag can be forgotten at a call site and reintroduce the wrong-library bug; the instance can't lie.
// Prefer an explicit injection point where one exists (fireLayer's popupLib) — this file is only for helpers with no such seam.

import type mapboxgl from "mapbox-gl";
import * as maplibregl from "maplibre-gl";

// Mapbox is never imported here: a static import would ship its ~1.7 MB to every map. Georef's pane hands the library over before its first marker.
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
// Callers construct with: new (markerCtor(map))({...}). Typed as MapLibre's: only georef's map is still Mapbox.
export function markerCtor(map: unknown): typeof maplibregl.Marker {
	return isMaplibreMap(map) ? maplibregl.Marker : (mapbox!.Marker as unknown as typeof maplibregl.Marker);
}

// MapLibre's `loadImage(url)` returns a promise; Mapbox's takes a callback and ignores a missing one.
export function loadMapImage(map: maplibregl.Map, url: string): Promise<HTMLImageElement | ImageBitmap> {
	if (isMaplibreMap(map)) return map.loadImage(url).then((r) => r.data);
	return new Promise((resolve, reject) => {
		(
			map as unknown as {
				loadImage: (u: string, cb: (err: Error | null | undefined, img?: HTMLImageElement | ImageBitmap | null) => void) => void;
			}
		).loadImage(url, (err, img) => {
			if (err || !img) reject(err ?? new Error("no image"));
			else resolve(img);
		});
	});
}

/** The `Popup` class for this map — SYNCHRONOUS. Same rationale as markerCtor. */
export function popupCtor(map: unknown): typeof maplibregl.Popup {
	return isMaplibreMap(map) ? maplibregl.Popup : (mapbox!.Popup as unknown as typeof maplibregl.Popup);
}
