/** A photo is saved whole or not at all: a failed tile retries, a tile the source lacks comes from Sentinel. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved = new Map<string, unknown>();
vi.mock("../store/keyedIdbStore", () => ({
	makeKeyedIdbStore: () => ({
		get: async (k: string) => saved.get(k),
		put: async (k: string, v: unknown) => void saved.set(k, v),
		keys: async () => [...saved.keys()],
		delete: async (k: string) => void saved.delete(k),
		getAll: async () => [...saved.values()],
		getAllProjected: async () => [],
	}),
}));

const PIN: [number, number] = [-76.7, 45.6];
const KEY = "-76.7000,45.6000";

/** Every tile decodes and every draw lands; the test is about which tiles the bake will accept. */
const drawn: number[][] = [];
beforeEach(() => {
	vi.resetModules();
	saved.clear();
	drawn.length = 0;
	vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
	vi.stubGlobal("document", {
		createElement: () => ({
			getContext: () => ({ drawImage: (_b: unknown, ...box: number[]) => drawn.push(box) }),
			toBlob: (cb: (b: Blob) => void) => cb(new Blob(["webp"])),
		}),
	});
});
afterEach(() => vi.unstubAllGlobals());

async function bake(answer: (keys: string[], source: string | undefined) => Map<string, ArrayBuffer>) {
	const { CLOSE_UP, bakeSatelliteImage } = await import("./satelliteImage");
	const asked: (string | undefined)[] = [];
	const img = await bakeSatelliteImage(KEY, PIN, CLOSE_UP, async (keys, source) => {
		asked.push(source);
		return answer(keys, source);
	});
	return { img, asked };
}

const all = (keys: string[]) => new Map(keys.map((k) => [k, new ArrayBuffer(8)]));

describe("a photo is whole or not saved", () => {
	it("every tile arrived: the photo is saved", async () => {
		const { img } = await bake(all);
		expect(img).not.toBeNull();
		expect(saved.has(KEY)).toBe(true);
	});

	it("one tile failed: nothing is saved, so the next pass bakes it again", async () => {
		const { img } = await bake((keys) => {
			const got = all(keys);
			got.delete(keys[Math.floor(keys.length / 2)]!);
			return got;
		});
		expect(img).toBeNull();
		expect(saved.has(KEY)).toBe(false);
	});

	it("a tile the source has no imagery for is filled from Sentinel, under the rest", async () => {
		const { img, asked } = await bake((keys, source) => {
			const got = all(keys);
			if (!source) got.set(keys[0]!, new ArrayBuffer(0));
			return got;
		});
		expect(asked).toEqual([undefined, "sentinel"]);
		expect(img).not.toBeNull();
		expect(saved.has(KEY)).toBe(true);
	});

	it("Sentinel fails too: nothing is saved", async () => {
		const { img } = await bake((keys, source) => {
			const got = all(keys);
			if (!source) got.set(keys[0]!, new ArrayBuffer(0));
			else got.clear();
			return got;
		});
		expect(img).toBeNull();
		expect(saved.has(KEY)).toBe(false);
	});
});

describe("the held edge", () => {
	it("rings two overlapping photos once, with no line inside either", async () => {
		const { heldEdge } = await import("./satelliteImage");
		const box = ([x, y]: [number, number]): [number, number, number, number] => [x - 0.026, y - 0.018, x + 0.026, y + 0.018];
		const a = box(PIN);
		const b = box([PIN[0] + 0.03, PIN[1]]);
		const segs = heldEdge([{ bounds: a, z: 16 }, { bounds: b, z: 16 }]);
		const { kmBetween } = await import("../../shared/kmGeo");
		// Well inside the round photo: its tiles cover everything within 2 km of the centre.
		const inside = (p: [number, number], [w, s, e, n]: number[]) => kmBetween(p, [(w + e) / 2, (s + n) / 2]) < 1.5;
		const mid = ([p, q]: [number, number][]): [number, number] => [(p![0] + q![0]) / 2, (p![1] + q![1]) / 2];
		expect(segs.length).toBeGreaterThan(8);
		expect(segs.filter((seg) => inside(mid(seg), a) && inside(mid(seg), b))).toEqual([]);
	});

	it("runs only where photo meets nothing, across zooms and box cuts", async () => {
		const { heldEdge, photoTilesFor } = await import("./satelliteImage");
		const photos = [
			{ bounds: [PIN[0] - 0.02, PIN[1] - 0.015, PIN[0] + 0.02, PIN[1] + 0.015] as [number, number, number, number], z: 16 },
			{ bounds: [PIN[0] + 0.005, PIN[1] - 0.025, PIN[0] + 0.045, PIN[1] + 0.005] as [number, number, number, number], z: 15 },
		];
		const covered = ([lng, lat]: [number, number]) =>
			photos.some(({ bounds: [w, s, e, n], z }) =>
				lng > w && lng < e && lat > s && lat < n &&
				photoTilesFor([(w + e) / 2, (s + n) / 2], z).some((t) => lng > t.w && lng < t.e && lat > t.s && lat < t.n),
			);
		const segs = heldEdge(photos);
		expect(segs.length).toBeGreaterThan(8);
		const d = 1e-6;
		const wrong = segs.filter(([[x0, y0], [x1, y1]]) => {
			const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
			const sides: [[number, number], [number, number]] = x0 === x1 ? [[mx - d, my], [mx + d, my]] : [[mx, my - d], [mx, my + d]];
			return covered(sides[0]) === covered(sides[1]);
		});
		expect(wrong).toEqual([]);
	});
});
