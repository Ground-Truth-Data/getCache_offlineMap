// A map names its own renderer on its canvas container, and the Marker and
// Popup handed back are that renderer's — never the other library's.
import { describe, expect, it, vi } from "vitest";

const { lib } = vi.hoisted(() => ({ lib: { Marker: class MaplibreMarker {}, Popup: class MaplibrePopup {} } }));
vi.mock("maplibre-gl", () => lib);

import { isMaplibreMap, markerCtor, popupCtor, useMapbox } from "./rendererOf";

const mapOf = (className?: string) => ({ getCanvasContainer: () => (className === undefined ? undefined : { className }) });

describe("rendererOf", () => {
	it("reads the canvas container's class, defaulting to Mapbox", () => {
		expect(isMaplibreMap(mapOf("maplibregl-canvas-container"))).toBe(true);
		expect(isMaplibreMap(mapOf("mapboxgl-canvas-container"))).toBe(false);
		expect(isMaplibreMap(mapOf())).toBe(false);
		expect(isMaplibreMap(null)).toBe(false);
	});

	it("hands back the owning library's Marker and Popup", () => {
		const mapbox = { Marker: class MapboxMarker {}, Popup: class MapboxPopup {} };
		useMapbox(mapbox as never);
		expect(markerCtor(mapOf("maplibregl-x"))).toBe(lib.Marker);
		expect(popupCtor(mapOf("maplibregl-x"))).toBe(lib.Popup);
		expect(markerCtor(mapOf("mapboxgl-x"))).toBe(mapbox.Marker);
		expect(popupCtor(mapOf("mapboxgl-x"))).toBe(mapbox.Popup);
	});
});
