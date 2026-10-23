// @vitest-environment happy-dom
// The photo mount on a recording map: the close-up source goes in once, a
// photo near the camera mounts under it with a zoom fade, a far one is
// unmounted and its blob URL revoked, and a disposed mount does nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapDouble } from "../../testing/110.6-mapDouble";

const images = vi.hoisted(() => new Map<string, { blob: Blob; bounds: [number, number, number, number] }>());
vi.mock("./satelliteImage", async (orig) => ({
	...(await orig<typeof import("./satelliteImage")>()),
	getSatImageByKey: async (k: string) => images.get(k),
}));

import { createSatelliteMount, SAT_CLOSE_ID, SAT_CLOSE_LAYER, SAT_MIN_Z, satLayerId } from "./mountSatellite";

let n = 0;
const created: string[] = [];
const revoked: string[] = [];
beforeEach(() => {
	images.clear();
	created.length = revoked.length = 0;
	vi.stubGlobal("URL", Object.assign(URL, {
		createObjectURL: () => (created.push(`blob:${++n}`), `blob:${n}`),
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
		expect(d.layers.map((l) => l.id)).toEqual([`${id}-l`, SAT_CLOSE_LAYER, "roads"]);
		expect((d.layers[0]!.paint as Record<string, unknown[]>)["raster-opacity"]).toEqual(["interpolate", ["linear"], ["zoom"], SAT_MIN_Z, 0, SAT_MIN_Z + 0.5, 1]);
		expect([...mount.mounted()]).toEqual([NEAR.key]);
		await mount.display(NEAR);
		expect(created).toHaveLength(1);

		expect(await mount.reconcile(CAMERA, [NEAR], 6)).toBe(0);
		expect(d.sources.has(id)).toBe(false);
		expect(d.layers.map((l) => l.id)).toEqual([SAT_CLOSE_LAYER, "roads"]);
		expect(revoked).toEqual([created[0]]);
		mount.unmount("never-mounted");
		expect(revoked).toHaveLength(1);
	});

	it("re-points a source already on the map, and keeps the old image if the swap throws", async () => {
		const { d, mount } = rig();
		d.raw.addSource(satLayerId(NEAR.key), { type: "image" });
		const src = d.raw.getSource(satLayerId(NEAR.key))!;
		await mount.display(NEAR);
		expect(src.updateImage).toHaveBeenCalledWith({ url: created[0], coordinates: expect.any(Array) });
		mount.unmount(NEAR.key);
		d.raw.addSource(satLayerId(NEAR.key), { type: "image" });
		const third = d.raw.getSource(satLayerId(NEAR.key))!;
		(third.updateImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("style swapping");
		});
		await mount.display(NEAR);
		expect(mount.mounted().has(NEAR.key)).toBe(true);
		expect(revoked).not.toContain(created.at(-1));
	});

	it("closeUpChanged re-sets the tiles; dispose revokes every URL and stops mounting", async () => {
		const { d, mount } = rig();
		mount.closeUpChanged();
		expect(d.raw.getSource(SAT_CLOSE_ID)!.setTiles).toHaveBeenCalledWith(["v10://photo/{z}/{x}/{y}"]);
		await mount.display(NEAR);
		await mount.display({ key: "missing", center: [0, 0] });
		mount.dispose();
		expect(revoked).toEqual(created);
		expect(mount.mounted().size).toBe(0);
		await mount.display(FAR);
		expect(await mount.reconcile(CAMERA, [NEAR], 12)).toBe(0);
		mount.closeUpChanged();
		expect(d.raw.getSource(SAT_CLOSE_ID)!.setTiles).toHaveBeenCalledTimes(1);
		expect(created).toHaveLength(1);
	});
});
