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
