// @vitest-environment happy-dom
// The satellite mount on a recording map: each source's overview and close tiles go in once as raster layers over
// v10://photo, and the gold edge rings the held areas near the camera, redrawn only when that set changes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapDouble } from "$gc/mapDouble";

const records = vi.hoisted(() => new Map<string, { zoom: number; source: string }>());
const edges = vi.hoisted(() => ({ n: 0, last: [] as unknown[] }));
vi.mock("./satelliteImage", async (orig) => {
	const real = await orig<typeof import("./satelliteImage")>();
	return {
		...real,
		getSatImageByKey: async (k: string) => records.get(k),
		heldEdge: (p: Parameters<typeof real.heldEdge>[0]) => (edges.n++, (edges.last = [...p]), real.heldEdge(p)),
	};
});

import { createSatelliteMount, SAT_EDGE_ID, SAT_LAYERS, SAT_MIN_Z } from "./mountSatellite";

const sq = (x: number, y: number): [number, number][] => [[x, y], [x + 0.01, y], [x + 0.01, y + 0.007], [x, y + 0.007], [x, y]];
const NEAR = { key: "piece:near", ring: sq(-119.6, 49.5) };
const FAR = { key: "piece:far", ring: sq(-117.42, 47.65) };
const CAMERA: [number, number, number, number] = [-119.7, 49.4, -119.5, 49.6];

beforeEach(() => {
	records.clear();
	edges.n = 0;
	records.set(NEAR.key, { zoom: 16, source: "MapTiler" });
	records.set(FAR.key, { zoom: 16, source: "MapTiler" });
});

function rig() {
	const d = mapDouble();
	d.layers.push({ id: "roads", type: "line" });
	const mount = createSatelliteMount(d.map as never, "roads", "v10://photo/{source}/{z}/{x}/{y}");
	return { d, mount };
}

describe("createSatelliteMount", () => {
	it("adds every source's overview and close tiles under the given layer, Sentinel's lowest", () => {
		const { d } = rig();
		expect(d.layers.map((l) => l.id)).toEqual([...SAT_LAYERS, "roads"]);
		expect(SAT_LAYERS[0]).toBe("v4-sat-sentinel-far-l");
		expect(d.sources.get("v4-sat-maptiler-far")).toMatchObject({ type: "raster", tiles: ["v10://photo/maptiler/{z}/{x}/{y}"], tileSize: 256, minzoom: 10, maxzoom: 12 });
		expect(d.sources.get("v4-sat-maptiler")).toMatchObject({ tiles: ["v10://photo/maptiler/{z}/{x}/{y}"], tileSize: 128, minzoom: 16, maxzoom: 16 });
		expect(d.sources.get("v4-sat-sentinel")).toMatchObject({ tiles: ["v10://photo/sentinel/{z}/{x}/{y}"], minzoom: 14, maxzoom: 14 });
	});

	it("rings every held area once, under the roads; a camera move never redraws it, a change in what is held does", async () => {
		const { d, mount } = rig();
		expect(await mount.reconcile(CAMERA, [NEAR, FAR])).toBe(1);
		expect(edges.n).toBe(1);
		expect(edges.last).toEqual([{ ring: NEAR.ring, z: 16 }, { ring: FAR.ring, z: 16 }]);
		expect(d.layers.at(-2)).toMatchObject({ id: SAT_EDGE_ID, type: "line", minzoom: SAT_MIN_Z, paint: { "line-color": "#f5a119" } });
		expect(mount.attributions()).toHaveLength(1);
		expect(await mount.reconcile([-117.5, 47.6, -117.3, 47.7], [NEAR, FAR])).toBe(1);
		expect(edges.n).toBe(1);
		await mount.reconcile(CAMERA, [NEAR]);
		expect(edges.n).toBe(2);
		expect(edges.last).toEqual([{ ring: NEAR.ring, z: 16 }]);
	});

	it("an area with no current record is not ringed or credited", async () => {
		const { d, mount } = rig();
		records.delete(NEAR.key);
		expect(await mount.reconcile(CAMERA, [NEAR])).toBe(0);
		expect(d.sources.has(SAT_EDGE_ID)).toBe(false);
		expect(mount.attributions()).toEqual([]);
	});

	it("tilesChanged re-sets every source's tiles; dispose stops it", async () => {
		const { d, mount } = rig();
		mount.tilesChanged();
		expect(d.raw.getSource("v4-sat-usgs")!.setTiles).toHaveBeenCalledWith(["v10://photo/usgs/{z}/{x}/{y}"]);
		mount.dispose();
		mount.tilesChanged();
		expect(d.raw.getSource("v4-sat-usgs")!.setTiles).toHaveBeenCalledTimes(1);
		expect(await mount.reconcile(CAMERA, [NEAR])).toBe(0);
	});
});
