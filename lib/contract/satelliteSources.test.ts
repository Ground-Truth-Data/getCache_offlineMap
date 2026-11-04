import { describe, expect, it } from "vitest";
import { DEFAULT_SOURCE, SATELLITE_SOURCES, type SatelliteSource, sourceAt, sourceNamed } from "./satelliteSources";

const all = Object.entries(SATELLITE_SOURCES) as [string, SatelliteSource][];

describe("the satellite sources", () => {
	it("default to MapTiler, and only MapTiler, Sentinel and USGS keep their tiles in R2", () => {
		expect(DEFAULT_SOURCE).toBe("maptiler");
		expect(all.filter(([, s]) => s.cacheToR2).map(([id]) => id)).toEqual(["maptiler", "sentinel", "usgs"]);
	});

	it("each name its attribution and licence, and is found again by the name a photo stores", () => {
		for (const [, s] of all) {
			expect(s.attribution.length).toBeGreaterThan(5);
			expect(s.licence.length).toBeGreaterThan(3);
			expect(sourceNamed(s.name)).toBe(s);
		}
		expect(sourceNamed("USGS")).toBeUndefined();
	});

	it("Sentinel is EOX's 2016 mosaic, never a non-commercial later year", () => {
		expect(SATELLITE_SOURCES.sentinel.tileUrl("", 14, 1, 2)).toBe("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/14/2/1.jpg");
		expect(SATELLITE_SOURCES.sentinel.licence).toBe("CC BY 4.0");
	});

	it("USGS outranks the switched-on source inside the US, and nowhere across the border", () => {
		expect(sourceAt([-122.33, 47.6], "maptiler")).toBe("usgs"); // Seattle
		expect(sourceAt([-149.9, 61.2], "maptiler")).toBe("usgs"); // Anchorage
		for (const [lng, lat] of [
			[-123.1, 49.28], // Vancouver
			[-119.59, 49.49], // Penticton
			[-79.38, 43.65], // Toronto
			[-83.0, 42.3], // Windsor
			[-117.03, 32.53], // Tijuana
			[-100.3, 25.67], // Monterrey
		] as [number, number][])
			expect(sourceAt([lng, lat], "maptiler")).toBe("maptiler");
	});
});
