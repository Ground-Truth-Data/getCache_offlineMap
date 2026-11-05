import { describe, expect, it } from "vitest";
import { DEFAULT_SOURCE, SATELLITE_SOURCES, type SatelliteSource, sourceAt, sourceNamed } from "./satelliteSources";

const all = Object.entries(SATELLITE_SOURCES) as [string, SatelliteSource][];

describe("the satellite sources", () => {
	it("default to MapTiler, and every source keeps its tiles in R2", () => {
		expect(DEFAULT_SOURCE).toBe("maptiler");
		expect(all.filter(([, s]) => s.cacheToR2).map(([id]) => id)).toEqual(["maptiler", "sentinel", "usgs", "nsw", "ign", "pdok", "pnoa"]);
	});

	it("each regional source wins inside its own ground and nowhere else", () => {
		for (const [at, id] of [
			[[148.6, -32.25], "nsw"], // Dubbo
			[[150.3, -34.5], "nsw"], // Bowral
			[[2.5, 45.5], "ign"], // Massif Central
			[[-3.0, 48.2], "ign"], // Brittany
			[[5.3, 52.1], "pdok"], // Utrecht
			[[-3.7, 40.4], "pnoa"], // Madrid
			[[144.96, -37.81], "maptiler"], // Melbourne: Victoria's imagery is paid
			[[147.3, -42.9], "maptiler"], // Hobart: Tasmania's is non-commercial
			[[153.03, -27.47], "maptiler"], // Brisbane: Queensland's fill is all rights reserved
			[[-123.1, 49.28], "maptiler"], // Vancouver: BC's is Access Only
			[[4.35, 50.85], "maptiler"], // Brussels
			[[-9.14, 38.72], "maptiler"], // Lisbon
		] as [[number, number], string][])
			expect(sourceAt(at, "maptiler")).toBe(id);
	});

	it("no two sources claim the same ground", () => {
		const boxes = all.flatMap(([id, s]) => (s.covers ?? []).map((b) => [id, b] as const));
		for (const [a, [aw, as, ae, an]] of boxes)
			for (const [b, [bw, bs, be, bn]] of boxes) if (a !== b) expect(aw < be && bw < ae && as < bn && bs < an).toBe(false);
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
