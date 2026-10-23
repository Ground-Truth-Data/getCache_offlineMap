// The tile store's read side, on a fake IndexedDB: a tile reads back by key,
// sizes are counted per blob and in total, an unsized blob is sized from its
// tiles on the next check, and a write to a gone area names why.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	AreaGone,
	bytesOfTiles,
	checkRegions,
	claimArea,
	deleteRegion,
	deleteTiles,
	getTile,
	listRegions,
	notePhotoBytes,
	putRegion,
	putTiles,
	type Region,
	regionsSnapshot,
	stats,
	touchRegions,
	usedBytes,
	wipe,
} from "./store";
import { rangeTiles, regionRange, tileKey } from "./tiles";

vi.mock("../../lib/onPhone/satellite/satelliteImage", async (orig) => ({
	...(await orig<typeof import("../../lib/onPhone/satellite/satelliteImage")>()),
	deleteSatImage: vi.fn(async () => {}),
}));

const buf = (n: number) => new ArrayBuffer(n);
const range = regionRange(-119.59, 49.49);
const keys = rangeTiles(range).map(tileKey);
const row = (id: string, more: Partial<Region> = {}): Region => ({ id, lng: -119.59, lat: 49.49, range, at: 1, tiles: keys.length, fetched: 0, bytes: 0, ms: 1, ...more });

beforeEach(async () => {
	await wipe();
	notePhotoBytes(0);
});

describe("reads", () => {
	it("a tile reads back by key; sizes add up per key set, in total and with the photos", async () => {
		await putRegion(row("a"));
		await putTiles([[keys[0]!, buf(10)], [keys[1]!, buf(20)], ["p/13/1/1", buf(5)]], "a");
		expect((await getTile(keys[0]!))!.byteLength).toBe(10);
		expect(await getTile("0/9/9")).toBeUndefined();
		expect(await bytesOfTiles([])).toBe(0);
		expect(await bytesOfTiles([keys[1]!, "nope"])).toBe(20);
		expect(await stats()).toEqual({ tiles: 3, bytes: 35 });
		notePhotoBytes(1000);
		expect(await usedBytes()).toBe(1035);
		await deleteTiles([]);
		await deleteTiles([keys[0]!]);
		expect(await usedBytes()).toBe(1025);
	});

	it("checkRegions counts each blob's missing tiles and sizes a blob saved without a size", async () => {
		await putRegion(row("a"));
		await putRegion(row("b", { bytes: 99, at: 2 }));
		await putTiles(keys.slice(0, 3).map((k) => [k, buf(7)] as [string, ArrayBuffer]), "a");
		const missing = await checkRegions();
		expect(missing).toEqual({ a: keys.length - 3, b: keys.length - 3 });
		const rows = await listRegions();
		expect(rows.map((r) => [r.id, r.bytes])).toEqual([["b", 99], ["a", 21]]);
	});

	it("regionsSnapshot caches the list until a row changes, and bumps its version then", async () => {
		await putRegion(row("a"));
		const one = regionsSnapshot();
		expect(regionsSnapshot().regions).toBe(one.regions);
		expect((await one.regions).map((r) => r.id)).toEqual(["a"]);
		await putRegion(row("b", { at: 5 }));
		const two = regionsSnapshot();
		expect(two.version).toBe(one.version + 1);
		expect((await two.regions).map((r) => r.id)).toEqual(["b", "a"]);
	});
});

describe("area rows", () => {
	it("claimArea and putTiles throw AreaGone naming removed or missing", async () => {
		await expect(claimArea("ghost")).rejects.toMatchObject({ name: "AreaGone", why: "missing" });
		await putRegion(row("a"));
		await claimArea("a");
		await deleteRegion("a", true);
		await expect(claimArea("a")).rejects.toBeInstanceOf(AreaGone);
		await expect(putTiles([[keys[0]!, buf(1)]], "a")).rejects.toMatchObject({ why: "removed", message: "offline area a is removed" });
		await expect(putTiles([[keys[0]!, buf(1)]], "ghost")).rejects.toThrow("missing (no row has this id)");
		expect(await deleteRegion("ghost")).toBeNull();
	});

	it("touchRegions marks only live rows an hour stale, and nothing for no ids", async () => {
		await putRegion(row("a", { lastOpened: 1_000 }));
		await putRegion(row("b", { lastOpened: 3_000_000 }));
		await touchRegions([]);
		await touchRegions(["a", "b"], 3_700_000);
		const byId = Object.fromEntries((await listRegions()).map((r) => [r.id, r.lastOpened]));
		expect(byId).toEqual({ a: 3_700_000, b: 3_000_000 });
	});
});

describe("keepStorage", () => {
	it("asks once, and reports kept, evictable or unknown", async () => {
		const persist = vi.fn(async () => false);
		vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist } });
		vi.resetModules();
		const fresh = await import("./store");
		expect(await fresh.keepStorage()).toBe("evictable");
		expect(await fresh.keepStorage()).toBe("evictable");
		expect(persist).toHaveBeenCalledTimes(1);
		for (const [storage, want] of [
			[{ persisted: async () => true, persist }, "kept"],
			[{ persisted: async () => false, persist: async () => true }, "kept"],
			[{}, "unknown"],
			[{ persisted: async () => Promise.reject(new Error("no")), persist }, "unknown"],
		] as const) {
			vi.stubGlobal("navigator", { storage });
			vi.resetModules();
			expect(await (await import("./store")).keepStorage()).toBe(want);
		}
		vi.unstubAllGlobals();
	});
});
