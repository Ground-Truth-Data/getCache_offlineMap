import { describe, expect, it } from "vitest";
import { kindOf } from "./dataMeter.svelte";

/**
 * The buckets are the whole point of the meter: a row that says "satellite" must
 * actually hold satellite bytes. These pin the URL shapes against the real
 * builders in tilesHost.ts and photoSources.ts — the assumption that satellite
 * comes from api.mapbox.com was wrong, and it would have reported the heaviest
 * feature as zero.
 */

const HOST = "https://tiles-prod.getcache.org";

describe("dataMeter buckets", () => {
	it("files every real download URL under the feature that caused it", () => {
		expect(kindOf(`${HOST}/fires?lng=-120.8&lat=48.3&km=500`)).toBe("fires");
		expect(kindOf(`${HOST}/hospitals?lng=-120.8&lat=48.3&km=500`)).toBe("hospitals");
		expect(kindOf(`${HOST}/satellite/15/5673/11344.jpg`)).toBe("satellite");
		expect(
			kindOf("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/15/11344/5673"),
		).toBe("satellite");
		expect(
			kindOf("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/14/5672/2836.jpg"),
		).toBe("satellite");
		expect(kindOf(`${HOST}/pack?lng=-120.8&lat=48.3&pv=4`)).toBe("map tiles");
		expect(kindOf(`${HOST}/13/1345/2836.pbf`)).toBe("map tiles");
	});

	it("keeps satellite out of the mapbox bucket — three sources, none of them Mapbox", () => {
		// The bug this pins: `/satellite/…` is on OUR Worker origin, so a
		// tiles-host-first rule would swallow it and the satellite row would read 0
		// while the map tiles row absorbed the app's single heaviest feature.
		expect(kindOf(`${HOST}/satellite/15/5673/11344.jpg`)).not.toBe("map tiles");
		expect(kindOf(`${HOST}/satellite/15/5673/11344.jpg`)).not.toBe("mapbox");
	});

	it("separates directions from the rest of Mapbox, since only one is per-trip traffic", () => {
		expect(kindOf("https://api.mapbox.com/directions/v5/mapbox/driving/-120,48;-121,49")).toBe("directions");
		expect(kindOf("https://api.mapbox.com/styles/v1/mapbox/streets-v12")).toBe("mapbox");
	});

	it("never loses a URL — an unknown one is still counted, under other", () => {
		// A bucket miss must not silently drop bytes; the total is the headline.
		expect(kindOf("https://example.com/something-new")).toBe("other");
	});
});
