/**
 * photoCovering — a photo already covering the ground means NO new download.
 *
 * The key dedups at ~11 m (4 decimals); a photo covers 2 km. Those numbers
 * were never related, so a stand of Quality 704 plots dropped metres apart
 * minted a near-identical photo per plot — the same imagery fetched dozens of
 * times. These pin the reuse rule that replaced it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, { bakeVersion: number; source: string }>();
let best = true;

vi.mock("../store/keyedIdbStore", () => ({
	makeKeyedIdbStore: () => ({
		get: async (k: string) => store.get(k),
		keys: async () => [...store.keys()],
		put: async (k: string, v: never) => void store.set(k, v),
		delete: async (k: string) => void store.delete(k),
		getAll: async () => [...store.values()],
		getAllProjected: async () => [],
	}),
}));
vi.mock("./photoSources", () => ({
	isBestPhotoSource: () => best,
	photoSourcesFor: () => [],
	registerPhotoSource: () => {},
}));

const { BAKE_VERSION, photoCovering, satImageKey, PHOTO_REUSE_KM } =
	await import("./satelliteImage");

/** A point `km` east of `from` — lng degrees shrink with latitude. */
const east = (from: [number, number], km: number): [number, number] => [
	from[0] + km / (111.32 * Math.cos((from[1] * Math.PI) / 180)),
	from[1],
];

const STAND: [number, number] = [-117.2, 56.9];

beforeEach(() => {
	store.clear();
	best = true;
});

describe("a photo already covering the ground is reused", () => {
	it("reuses the neighbour's photo for a plot 100 m away — no new key", async () => {
		store.set(satImageKey(STAND), { bakeVersion: BAKE_VERSION, source: "a" });
		const near = east(STAND, 0.1);
		// a different key entirely — the old rule would have baked
		expect(satImageKey(near)).not.toBe(satImageKey(STAND));
		expect(await photoCovering(near)).toBeDefined();
	});

	it("still bakes for ground genuinely outside the reuse radius", async () => {
		store.set(satImageKey(STAND), { bakeVersion: BAKE_VERSION, source: "a" });
		expect(await photoCovering(east(STAND, PHOTO_REUSE_KM + 0.5))).toBeUndefined();
	});

	it("ten plots across a stand reuse ONE photo between them", async () => {
		let baked = 0;
		for (let i = 0; i < 10; i++) {
			const at = east(STAND, i * 0.05); // 50 m apart, 450 m across
			if (await photoCovering(at)) continue;
			store.set(satImageKey(at), { bakeVersion: BAKE_VERSION, source: "a" });
			baked++;
		}
		expect(baked).toBe(1);
	});

	it("does not reuse a photo from a beaten source — a sharper bake still wins", async () => {
		store.set(satImageKey(STAND), { bakeVersion: BAKE_VERSION, source: "old" });
		best = false;
		expect(await photoCovering(east(STAND, 0.1))).toBeUndefined();
	});

	it("does not reuse a stale-geometry photo", async () => {
		store.set(satImageKey(STAND), {
			bakeVersion: BAKE_VERSION - 1,
			source: "a",
		});
		expect(await photoCovering(east(STAND, 0.1))).toBeUndefined();
	});
});
