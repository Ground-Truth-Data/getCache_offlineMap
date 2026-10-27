// Fires on disk: a written area reads back, an older format reads as absent,
// the coverage list and the near-origin pick see only current rows, and
// every write or delete drops the memos so the next read is fresh.
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Mod = typeof import("./fireCache");
let fc: Mod;
const spot = (lng: number, lat: number, t = 1) => ({ coordinates: [lng, lat] as [number, number], t, c: "h" as const, frp: 3 });
const area = (lng: number, lat: number, fetchedAt = 1_000) => ({ fetchedAt, center: [lng, lat] as [number, number], radiusKm: 50, sourcesOk: 3, hotspots: [spot(lng, lat)], outlines: [] });

beforeEach(async () => {
	vi.stubGlobal("indexedDB", new IDBFactory());
	vi.resetModules();
	fc = await import("./fireCache");
	return () => vi.unstubAllGlobals();
});

async function putRaw(key: string, value: unknown) {
	const { makeKeyedIdbStore } = await import("../../lib/onPhone/store/keyedIdbStore");
	await makeKeyedIdbStore({ dbName: "rt-fire-cache", storeName: "fires" }).put(key, value);
}

describe("fire cache on disk", () => {
	it("reads back what it wrote, stamped with the format, and nothing after a delete", async () => {
		expect(await fc.readFireCache("a")).toBeNull();
		await fc.writeFireCache("a", area(-119, 49));
		expect(await fc.readFireCache("a")).toMatchObject({ cacheVersion: fc.FIRE_CACHE_VERSION, center: [-119, 49] });
		await fc.deleteFireCache("a");
		expect(await fc.readFireCache("a")).toBeNull();
	});

	it("treats an older format as absent everywhere", async () => {
		await putRaw("old", { ...area(-119, 49), cacheVersion: 1 });
		expect(await fc.readFireCache("old")).toBeNull();
		expect(await fc.allFireEntries()).toEqual([]);
		expect(await fc.fireCoverage()).toEqual([]);
	});

	it("memoizes the lists until a write, and picks only discs an origin can reach", async () => {
		await fc.writeFireCache("bc", area(-119, 49, 5_000));
		await fc.writeFireCache("wa", area(-117, 47.6));
		const all = await fc.allFireEntries();
		expect(all).toHaveLength(2);
		expect(await fc.allFireEntries()).toBe(all);
		const cov = await fc.fireCoverage();
		expect(cov).toEqual([{ center: [-119, 49], radiusKm: 50, fetchedAt: 5_000 }, { center: [-117, 47.6], radiusKm: 50, fetchedAt: 1_000 }]);
		expect(await fc.fireCoverage()).toBe(cov);

		expect(await fc.fireEntriesNear([])).toBe(all);
		const near = await fc.fireEntriesNear([[-119.1, 49.1]], 10);
		expect(near.map((e) => e.center)).toEqual([[-119, 49]]);
		expect(await fc.fireEntriesNear([[-119.2, 49.05]], 10)).toBe(near);
		expect((await fc.fireEntriesNear([[-118, 48.3]], 100)).map((e) => e.center)).toEqual([[-119, 49], [-117, 47.6]]);

		const union = fc.unionHotspots(all);
		expect(fc.unionHotspots(all)).toBe(union);
		expect(fc.unionHotspots([...all])).not.toBe(union);
		expect(union).toMatchObject({ oldestFetchedAt: 1_000, degraded: false });

		await fc.writeFireCache("ab", area(-114, 51));
		expect(await fc.allFireEntries()).not.toBe(all);
		expect(await fc.allFireEntries()).toHaveLength(3);
	});
});
