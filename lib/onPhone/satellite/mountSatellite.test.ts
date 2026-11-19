// @vitest-environment happy-dom
// The satellite mount on a recording map: one raster source per source over v10://photo, at that source's zoom only, and the gold edge rings the held areas, redrawn only when that set changes.
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

import { createSatelliteMount, SAT_EDGE_ID, SAT_FAR_Z, SAT_LAYERS, SAT_MIN_Z } from "./mountSatellite";

const sq = (x: number, y: number): [number, number][] => [[x, y], [x + 0.01, y], [x + 0.01, y + 0.007], [x, y + 0.007], [x, y]];
const NEAR = { key: "piece:near", rings: [sq(-119.6, 49.5)] };
const FAR = { key: "piece:far", rings: [sq(-117.42, 47.65)] };
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
	it("starts with Sentinel alone under the given layer, at its own zoom only", () => {
		const { d } = rig();
		expect(SAT_LAYERS[0]).toBe("v4-sat-sentinel-l");
		expect(d.layers.map((l) => l.id)).toEqual([SAT_LAYERS[0], "roads"]);
		expect(d.sources.get("v4-sat-sentinel")).toMatchObject({ type: "raster", tiles: ["v10://photo/sentinel/{z}/{x}/{y}"], tileSize: 128, minzoom: 14, maxzoom: 14 });
		expect(d.sources.has("v4-sat-maptiler")).toBe(false);
	});

	it("a finer source draws its own zoom, scaled down from camera SAT_FAR_Z, asked only inside its held areas", async () => {
		const { d, mount } = rig();
		await mount.reconcile(CAMERA, [NEAR, FAR]);
		const src = d.sources.get("v4-sat-maptiler") as { tileSize: number; minzoom: number; maxzoom: number; bounds: number[] };
		expect(src).toMatchObject({ tiles: ["v10://photo/maptiler/{z}/{x}/{y}"], minzoom: 16, maxzoom: 16 });
		// MapLibre asks tiles at camera + log2(512 / tileSize).
		expect(SAT_FAR_Z + Math.log2(512 / src.tileSize)).toBe(16);
		expect(src.bounds).toEqual([-119.6, 47.65, -117.41, 49.507]);
		expect(d.layers.map((l) => l.id)).toEqual(["v4-sat-shadow", SAT_LAYERS[0], "v4-sat-maptiler-l", SAT_EDGE_ID, "roads"]);
		await mount.reconcile(CAMERA, [NEAR]);
		expect((d.sources.get("v4-sat-maptiler") as { bounds: number[] }).bounds).toEqual([...NEAR.rings[0]![0]!, ...NEAR.rings[0]![2]!]);
		await mount.reconcile(CAMERA, []);
		expect(d.sources.has("v4-sat-maptiler")).toBe(false);
		expect(d.layers.some((l) => l.id === "v4-sat-maptiler-l")).toBe(false);
	});

	it("rings every held area once, under the roads; a camera move never redraws it, a change in what is held does", async () => {
		const { d, mount } = rig();
		expect(await mount.reconcile(CAMERA, [NEAR, FAR])).toBe(1);
		expect(edges.n).toBe(1);
		expect(edges.last).toEqual([{ ring: NEAR.rings[0], z: 16 }, { ring: FAR.rings[0], z: 16 }]);
		// The shadow traces the same edge, under every photo, so the photos hide its inside half.
		const ids = d.layers.map((l) => l.id);
		expect(ids.indexOf("v4-sat-shadow")).toBe(ids.indexOf(SAT_LAYERS[0]!) - 1);
		expect(d.layers.find((l) => l.id === "v4-sat-shadow")).toMatchObject({ source: SAT_EDGE_ID });
		expect(d.layers.find((l) => l.id === SAT_EDGE_ID)).toMatchObject({ id: SAT_EDGE_ID, type: "line", minzoom: SAT_MIN_Z, paint: { "line-color": "#e99366" } });
		expect(mount.attributions()).toHaveLength(1);
		expect(await mount.reconcile([-117.5, 47.6, -117.3, 47.7], [NEAR, FAR])).toBe(1);
		expect(edges.n).toBe(1);
		await mount.reconcile(CAMERA, [NEAR]);
		expect(edges.n).toBe(2);
		expect(edges.last).toEqual([{ ring: NEAR.rings[0], z: 16 }]);
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
		expect(d.raw.getSource("v4-sat-sentinel")!.setTiles).toHaveBeenCalledWith(["v10://photo/sentinel/{z}/{x}/{y}"]);
		mount.dispose();
		mount.tilesChanged();
		expect(d.raw.getSource("v4-sat-sentinel")!.setTiles).toHaveBeenCalledTimes(1);
		expect(await mount.reconcile(CAMERA, [NEAR])).toBe(0);
	});
});
