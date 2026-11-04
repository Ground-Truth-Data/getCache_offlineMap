// @vitest-environment happy-dom
// The photo mount on a recording map: the close-up source goes in once, a
// photo near the camera mounts under it with a zoom fade, a far one is
// unmounted and its blob URL revoked, and a disposed mount does nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapDouble } from "$gc/mapDouble";

const images = vi.hoisted(() => new Map<string, { blob: Blob; bounds: [number, number, number, number]; canvasPx?: number; levels?: Blob[] }>());
const edges = vi.hoisted(() => ({ n: 0 }));
vi.mock("./satelliteImage", async (orig) => {
	const real = await orig<typeof import("./satelliteImage")>();
	return {
		...real,
		getSatImageByKey: async (k: string) => images.get(k),
		photoLevels: async (_k: string, img: { levels?: Blob[] }) => img.levels ?? null,
		heldEdge: (p: Parameters<typeof real.heldEdge>[0]) => (edges.n++, real.heldEdge(p)),
	};
});

import { createSatelliteMount, SAT_CLOSE_ID, SAT_CLOSE_LAYER, SAT_EDGE_ID, SAT_MIN_Z, satLayerId } from "./mountSatellite";

let n = 0;
const created: string[] = [];
const revoked: string[] = [];
const blobAt = new Map<string, Blob>();
beforeEach(() => {
	images.clear();
	created.length = revoked.length = 0;
	vi.stubGlobal("URL", Object.assign(URL, {
		createObjectURL: (b: Blob) => (created.push(`blob:${++n}`), blobAt.set(`blob:${n}`, b), `blob:${n}`),
		revokeObjectURL: (u: string) => void revoked.push(u),
	}));
});
afterEach(() => vi.unstubAllGlobals());

const NEAR = { key: "49.50000,-119.60000", center: [-119.6, 49.5] as [number, number] };
const FAR = { key: "47.65000,-117.42000", center: [-117.42, 47.65] as [number, number] };
const CAMERA: [number, number, number, number] = [-119.7, 49.4, -119.5, 49.6];
const bounds = (c: [number, number]): [number, number, number, number] => [c[0] - 0.01, c[1] - 0.01, c[0] + 0.01, c[1] + 0.01];

function rig() {
	const d = mapDouble();
	d.layers.push({ id: "roads", type: "line" });
	const mount = createSatelliteMount(d.map as never, "roads", "v10://photo/{z}/{x}/{y}");
	images.set(NEAR.key, { blob: new Blob(["n"]), bounds: bounds(NEAR.center) });
	images.set(FAR.key, { blob: new Blob(["f"]), bounds: bounds(FAR.center) });
	return { d, mount };
}

describe("createSatelliteMount", () => {
	it("adds the close-up raster under the given layer", () => {
		const { d } = rig();
		expect(d.sources.get(SAT_CLOSE_ID)).toMatchObject({ type: "raster", tiles: ["v10://photo/{z}/{x}/{y}"], tileSize: 512 });
		expect(d.layers.map((l) => l.id)).toEqual([SAT_CLOSE_LAYER, "roads"]);
	});

	it("mounts the near photo with its corners and fade, culls the far one, and unmounts on a pan", async () => {
		const { d, mount } = rig();
		expect(await mount.reconcile(CAMERA, [NEAR, FAR], 12)).toBe(1);
		const id = satLayerId(NEAR.key);
		expect(id).toBe("v4-sat-49_50000__119_60000");
		const [w, s, e, nn] = bounds(NEAR.center);
		expect(d.sources.get(id)).toMatchObject({ type: "image", url: "blob:" + n, coordinates: [[w, nn], [e, nn], [e, s], [w, s]] });
		expect(d.layers.map((l) => l.id)).toEqual([`${id}-l`, SAT_CLOSE_LAYER, SAT_EDGE_ID, "roads"]);
		expect(d.layers[2]).toMatchObject({ type: "line", paint: { "line-color": "#f5a119" } });
		expect((d.layers[0]!.paint as Record<string, unknown[]>)["raster-opacity"]).toEqual(["interpolate", ["linear"], ["zoom"], SAT_MIN_Z, 0, SAT_MIN_Z + 0.5, 1]);
		expect([...mount.mounted()]).toEqual([NEAR.key]);
		expect(await mount.reconcile(CAMERA, [NEAR, FAR], 12)).toBe(1);
		expect(created).toHaveLength(1);

		expect(await mount.reconcile(CAMERA, [NEAR], 6)).toBe(0);
		expect(d.sources.has(id)).toBe(false);
		expect(d.layers.map((l) => l.id)).toEqual([SAT_CLOSE_LAYER, SAT_EDGE_ID, "roads"]);
		expect((d.sources.get(SAT_EDGE_ID) as unknown as { geometry: { coordinates: unknown[] } }).geometry.coordinates).toEqual([]);
		expect(revoked).toEqual([created[0]]);
	});

	it("draws the edge once a pass, however many photos it mounts", async () => {
		const { mount } = rig();
		const sites = [-119.62, -119.6, -119.58].map((lng) => ({ key: `49.5,${lng}`, center: [lng, 49.5] as [number, number] }));
		for (const s of sites) images.set(s.key, { blob: new Blob(["s"]), bounds: bounds(s.center) });
		edges.n = 0;
		expect(await mount.reconcile(CAMERA, sites, 12)).toBe(3);
		expect(edges.n).toBe(1);
		await mount.reconcile(CAMERA, sites, 12);
		expect(edges.n).toBe(1);
	});

	it("mounts the level the zoom needs and swaps it in the same source on a zoom", async () => {
		const { d, mount } = rig();
		const [full, quarter, sixteenth] = [new Blob(["full"]), new Blob(["1/4"]), new Blob(["1/16"])];
		// 0.02° wide: 15 px at z9, 233 at z13, 1864 at z16.
		images.set(NEAR.key, { blob: full, bounds: bounds(NEAR.center), canvasPx: 3456, levels: [quarter, sixteenth] });
		const id = satLayerId(NEAR.key);
		const shown = () => blobAt.get(created.at(-1)!);
		await mount.reconcile(CAMERA, [NEAR], 9);
		expect(shown()).toBe(sixteenth);
		await mount.reconcile(CAMERA, [NEAR], 13);
		expect(shown()).toBe(quarter);
		await mount.reconcile(CAMERA, [NEAR], 16);
		expect(shown()).toBe(full);
		expect(d.raw.getSource(id)!.updateImage).toHaveBeenLastCalledWith({ url: created.at(-1) });
		expect(d.layers.filter((l) => l.id === `${id}-l`)).toHaveLength(1);
		expect(revoked).toEqual(created.slice(0, 2));
	});

	it("closeUpChanged re-sets the tiles; dispose revokes every URL and stops mounting", async () => {
		const { d, mount } = rig();
		mount.closeUpChanged();
		expect(d.raw.getSource(SAT_CLOSE_ID)!.setTiles).toHaveBeenCalledWith(["v10://photo/{z}/{x}/{y}"]);
		await mount.reconcile(CAMERA, [NEAR, { key: "missing", center: [-119.6, 49.5] }], 12);
		mount.dispose();
		expect(revoked).toEqual(created);
		expect(mount.mounted().size).toBe(0);
		expect(await mount.reconcile(CAMERA, [NEAR], 12)).toBe(0);
		mount.closeUpChanged();
		expect(d.raw.getSource(SAT_CLOSE_ID)!.setTiles).toHaveBeenCalledTimes(1);
		expect(created).toHaveLength(1);
	});
});
