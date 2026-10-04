/**
 * photoCovering — a photo already covering the ground means NO new download.
 *
 * The key dedups at ~11 m (4 decimals); a photo covers 2 km. Those numbers
 * were never related, so a stand of Quality 704 plots dropped metres apart
 * minted a near-identical photo per plot — the same imagery fetched dozens of
 * times. These pin the reuse rule that replaced it. Reuse is judged by each
 * photo's stored centre, never by parsing its key.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Rec {
	bakeVersion: number;
	source: string;
	center: [number, number];
}
const store = new Map<string, Rec>();
let best = true;

vi.mock("../store/keyedIdbStore", () => ({
	makeKeyedIdbStore: () => ({
		get: async (k: string) => store.get(k),
		keys: async () => [...store.keys()],
		put: async (k: string, v: never) => void store.set(k, v),
		delete: async (k: string) => void store.delete(k),
		getAll: async () => [...store.values()],
		getAllProjected: async (project: (v: Rec) => unknown) => [...store.values()].map(project),
	}),
}));
vi.mock("./photoSources", () => ({
	isBestPhotoSource: () => best,
	PHOTO_SOURCES: [],
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

const bake = (at: [number, number], over: Partial<Rec> = {}): void => {
	store.set(satImageKey(at), { bakeVersion: BAKE_VERSION, source: "a", center: at, ...over });
};
const covering = (at: [number, number]) => photoCovering(satImageKey(at), at);

beforeEach(() => {
	store.clear();
	best = true;
});

describe("a photo already covering the ground is reused", () => {
	it("reuses the neighbour's photo for a plot 100 m away — no new key", async () => {
		bake(STAND);
		const near = east(STAND, 0.1);
		// a different key entirely — the old rule would have baked
		expect(satImageKey(near)).not.toBe(satImageKey(STAND));
		expect(await covering(near)).toBeDefined();
	});

	it("still bakes for ground genuinely outside the reuse radius", async () => {
		bake(STAND);
		expect(await covering(east(STAND, PHOTO_REUSE_KM + 0.5))).toBeUndefined();
	});

	it("ten plots across a stand reuse ONE photo between them", async () => {
		let baked = 0;
		for (let i = 0; i < 10; i++) {
			const at = east(STAND, i * 0.05); // 50 m apart, 450 m across
			if (await covering(at)) continue;
			bake(at);
			baked++;
		}
		expect(baked).toBe(1);
	});

	it("does not reuse a photo from a beaten source — a sharper bake still wins", async () => {
		bake(STAND, { source: "old" });
		best = false;
		expect(await covering(east(STAND, 0.1))).toBeUndefined();
	});

	it("does not reuse a stale-geometry photo", async () => {
		bake(STAND, { bakeVersion: BAKE_VERSION - 1 });
		expect(await covering(east(STAND, 0.1))).toBeUndefined();
	});

	it("judges by the stored centre: a key that lies about it changes nothing", async () => {
		// Filed under a key that parses to the other side of the world; its centre is right here.
		store.set("0.0000,0.0000", { bakeVersion: BAKE_VERSION, source: "a", center: STAND });
		expect(await covering(east(STAND, 0.1))).toBeDefined();
	});
});
