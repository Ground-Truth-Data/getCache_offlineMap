/** The 1 GB wall and the 12-month sweep, against the real store on a fake IndexedDB. */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostPorts } from "../../lib/shared/hostPorts";
import { configureTilesDevHost } from "../../lib/worker/worker-local-dev/tilesHost";
import { removeArea, removeStaleAreas, startBlobService } from "./blobService";
import { BudgetError, isStale, OFFLINE_TILES_BYTES, setBudgetMb, STALE_AREA_MONTHS } from "./budget";
import { downloadRegion, roomFor } from "./download";
import {
	areaUsage,
	deleteRegion,
	listRegions,
	patchRegion,
	putRegion,
	putTiles,
	type Region,
	regionId,
	regionKnown,
	touchRegions,
	allTileKeys,
	usedBytes,
	wipe,
} from "./store";
import { rangeContains, rangeTiles, regionRange, tileKey } from "./tiles";

vi.stubGlobal("window", new EventTarget());
vi.mock("./places", () => ({ nearestPlace: async () => null }));

const MB = 1048576;
const DAY = 86_400_000;

function region(id: string, at: number, lng: number, lat: number, more: Partial<Region> = {}): Region {
	return { id, lng, lat, range: regionRange(lng, lat), at, tiles: 1, fetched: 1, bytes: 0, ms: 1, ...more };
}

// Far enough apart that no two blobs share tiles.
const SPOTS: Array<[number, number]> = [
	[-119.59, 49.49],
	[-117.42, 47.65],
	[-114.06, 51.04],
];

/** A z13 tile under this spot's area and no other's. */
function ownTile(r: Region): string {
	return tileKey(rangeTiles(r.range).filter((t) => t.z === 13)[0]);
}

beforeEach(async () => {
	await wipe();
	setBudgetMb(1024);
});

describe("the 1 GB wall refuses, it never evicts", () => {
	it("is 1 GB and 12 months", () => {
		expect(OFFLINE_TILES_BYTES).toBe(1_073_741_824);
		expect(STALE_AREA_MONTHS).toBe(12);
	});

	it("refuses the write that would cross it and leaves every area on disk", async () => {
		setBudgetMb(4);
		for (let i = 0; i < 3; i++) {
			const r = region(`b${i}`, 1000 + i, ...SPOTS[i]);
			await putRegion(r);
			await putTiles([[ownTile(r), new ArrayBuffer(MB)]]);
		}
		const err = await putTiles([["3/0/0", new ArrayBuffer(2 * MB)]]).catch((e) => e);
		expect(err).toBeInstanceOf(BudgetError);
		expect(err.message).toBe("Offline areas are limited to 4 MB. Remove an area to make room.");
		expect((await listRegions()).map((r) => r.id).sort()).toEqual(["b0", "b1", "b2"]);
		expect(await usedBytes()).toBe(3 * MB);
	});

	it("says 1 GB at the shipped budget", () => {
		expect(new BudgetError(0, 0, 0).message).toBe("Offline areas are limited to 1 GB. Remove an area to make room.");
	});

	it("refuses an area before a byte is fetched when the guess does not fit", async () => {
		setBudgetMb(4);
		// One byte a tile so far; SPOTS[1] is ~1,400 tiles nobody has fetched.
		const r = region("a", 1, ...SPOTS[0], { fetched: 1000, newBytes: 1000 });
		await putRegion(r);
		await putTiles([[ownTile(r), new ArrayBuffer(4 * MB - 100)]]);
		await expect(roomFor(...SPOTS[1])).rejects.toBeInstanceOf(BudgetError);
		setBudgetMb(1024);
		await expect(roomFor(...SPOTS[1])).resolves.toBeUndefined();
	});
});

describe("an area unopened for 12 months removes itself", () => {
	const now = Date.UTC(2026, 9, 2);

	it("judges by last opened, or by birth when never opened", () => {
		expect(isStale({ at: now - 400 * DAY }, now)).toBe(true);
		expect(isStale({ at: now - 400 * DAY, lastOpened: now - 30 * DAY }, now)).toBe(false);
		expect(isStale({ at: now - 300 * DAY }, now)).toBe(false);
	});

	it("removes only the stale area, frees its tiles, and keeps its row so the pin is not refetched", async () => {
		const old = region("old", now - 500 * DAY, ...SPOTS[0], { lastOpened: now - 400 * DAY });
		const opened = region("opened", now - 500 * DAY, ...SPOTS[1], { lastOpened: now - 10 * DAY });
		const young = region("young", now - 20 * DAY, ...SPOTS[2]);
		for (const r of [old, opened, young]) {
			await putRegion(r);
			await putTiles([[ownTile(r), new ArrayBuffer(1024)]]);
		}
		const gone = await removeStaleAreas(now);
		expect(gone.map((r) => r.id)).toEqual(["old"]);
		expect((await listRegions()).map((r) => r.id).sort()).toEqual(["opened", "young"]);
		expect(await regionKnown("old")).toBe(true);
		expect(await usedBytes()).toBe(2048);
	});

	it("opening an area marks it, at most once an hour", async () => {
		await putRegion(region("a", 1, ...SPOTS[0]));
		await touchRegions(["a"], now);
		expect((await listRegions())[0].lastOpened).toBe(now);
		await touchRegions(["a"], now + 60_000);
		expect((await listRegions())[0].lastOpened).toBe(now);
	});
});

describe("what each area costs", () => {
	it("counts only what removing it would free, and the total drops by exactly that", async () => {
		const a = region("a", 1, ...SPOTS[0]);
		const b = region("b", 2, SPOTS[0][0] + 0.001, SPOTS[0][1]);
		const c = region("c", 3, ...SPOTS[1]);
		for (const r of [a, b, c]) await putRegion(r);
		await putTiles([
			[ownTile(a), new ArrayBuffer(5000)],
			[ownTile(c), new ArrayBuffer(7000)],
		]);
		const before = await areaUsage();
		const cost = Object.fromEntries(before.areas.map((u) => [u.region.id, u.bytes]));
		// a and b stand on the same ground: neither alone frees it.
		expect(cost).toEqual({ a: 0, b: 0, c: 7000 });
		expect(before.total).toBe(12000);
		await removeArea(c);
		expect((await areaUsage()).total).toBe(before.total - cost.c);
	});
});

describe("a deleted blob stays deleted", () => {
	it("a late update to a blob deleted meanwhile does not bring it back", async () => {
		await putRegion(region("a", 1, ...SPOTS[0]));
		await deleteRegion("a");
		await patchRegion("a", { msPaint: 12 });
		expect(await listRegions()).toEqual([]);
	});

	it("patches a blob that is still there", async () => {
		await putRegion(region("a", 1, ...SPOTS[0]));
		await patchRegion("a", { msPaint: 12 });
		expect((await listRegions())[0].msPaint).toBe(12);
	});
});

describe("a removed area's row leaves with its pin", () => {
	it("a pin deleted after its area was removed takes the row with it", async () => {
		const at = SPOTS[0];
		const r = region(regionId(...at), 1, ...at);
		await putRegion(r);
		await putTiles([[ownTile(r), new ArrayBuffer(1024)]]);
		await removeArea(r);
		const pins = [{ anchors: [at], lastTouched: new Date().toISOString(), corridor: false }];
		let changed = (): void => undefined;
		const ports = {
			places: () => pins,
			ready: () => true,
			onPlacesChanged: (fn: () => void) => {
				changed = fn;
				fn();
				return () => undefined;
			},
		} as unknown as HostPorts;
		const stop = startBlobService(ports);
		pins.length = 0;
		changed();
		await vi.waitFor(async () => expect(await regionKnown(r.id)).toBe(false));
		stop();
	});
});

// Last: the hung fetches below hold the download pool for the rest of this file.
describe("a download that stops for any reason leaves no tile without a row", () => {
	it("tiles written before the page went away are named by a row the engine fetches again", async () => {
		configureTilesDevHost("https://tiles.test");
		let served = 0;
		vi.stubGlobal("fetch", async () => {
			if (++served > 300) return new Promise<never>(() => undefined);
			return new Response(new ArrayBuffer(10));
		});
		const at = SPOTS[2];
		void downloadRegion(...at).catch(() => undefined);
		await vi.waitFor(async () => expect((await allTileKeys()).size).toBeGreaterThanOrEqual(256));
		const rows = await listRegions();
		const orphans = [...(await allTileKeys())].filter((k) => {
			const [z, x, y] = k.split("/").map(Number);
			return !rows.some((r) => rangeContains(r.range, { z, x, y }));
		});
		expect(orphans).toEqual([]);
		expect(await regionKnown(regionId(...at))).toBe(false);
		vi.unstubAllGlobals();
	});
});
