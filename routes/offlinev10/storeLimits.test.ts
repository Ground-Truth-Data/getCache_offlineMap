/** The 1 GB wall and the 12-month sweep, against the real store on a fake IndexedDB. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostPorts } from "../../lib/shared/hostPorts";
import { configureTilesDevHost } from "../../lib/worker/tilesHost";
import { blobBusy, onBlob, removeArea, removeStaleAreas, saveSpots, startBlobService, viewing, type WaitingSet } from "./blobService";
import { startPhotoService } from "./satellite";
import { BudgetError, fullMessage, isStale, OFFLINE_TILES_BYTES, setBudgetMb, STALE_AREA_MONTHS } from "./budget";
import { downloadRegion, estimateBytes, roomFor } from "./download";
import { satImageKey } from "../../lib/onPhone/satellite/satelliteImage";
import {
	AreaGone,
	choosePhoto,
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
	checkRegions,
	usedBytes,
	wipe,
} from "./store";
import { rangeContains, rangeTiles, regionRange, tileKey } from "./tiles";

// An IndexedDB sweep outruns waitFor's 1 s default when the whole suite loads the machine.
const SWEEP = { timeout: 10_000 };

vi.stubGlobal("window", new EventTarget());
vi.mock("./places", () => ({ nearestPlace: async () => null }));
const photosDropped = vi.hoisted(() => [] as string[]);
// The photo's pixels come from MapTiler through a canvas; here the bake only records what it was asked for.
const baked = vi.hoisted(() => [] as string[]);
vi.mock("../../lib/onPhone/satellite/satelliteImage", async (orig) => ({
	...(await orig<typeof import("../../lib/onPhone/satellite/satelliteImage")>()),
	deleteSatImage: async (k: string) => void photosDropped.push(k),
	bakeSatelliteImage: async (k: string) => (baked.push(k), { blob: new Blob(["x"]) }),
}));

const MB = 1048576;
const DAY = 86_400_000;

function region(id: string, at: number, lng: number, lat: number, more: Partial<Region> = {}): Region {
	return { id, lng, lat, range: regionRange(lng, lat), at, tiles: 1, fetched: 1, bytes: 0, ms: 1, photoKey: satImageKey([lng, lat]), photoCenter: [lng, lat], ...more };
}

/** A pin's blob as the engine births it: id and photo key, once. */
const born = (at: [number, number]) => ({ id: regionId(...at), ...choosePhoto(at, []) });
const download = (at: [number, number]) => downloadRegion(at[0], at[1], undefined, born(at));

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
	photosDropped.length = 0;
});

/** Tiles on disk that no live row covers. */
async function orphanTiles(): Promise<string[]> {
	const rows = await listRegions();
	return [...(await allTileKeys())].filter((k) => {
		const [z, x, y] = k.split("/").map(Number);
		return !rows.some((r) => rangeContains(r.range, { z, x, y }));
	});
}

describe("the 1 GB wall", () => {
	it("is 1 GB and 12 months", () => {
		expect(OFFLINE_TILES_BYTES).toBe(1_073_741_824);
		expect(STALE_AREA_MONTHS).toBe(12);
	});

	it("refuses the write that would cross it and leaves every area on disk", async () => {
		setBudgetMb(4);
		for (let i = 0; i < 3; i++) {
			const r = region(`b${i}`, 1000 + i, ...SPOTS[i]);
			await putRegion(r);
			await putTiles([[ownTile(r), new ArrayBuffer(MB)]], r.id);
		}
		const err = await putTiles([["3/0/0", new ArrayBuffer(2 * MB)]], "b0").catch((e) => e);
		expect(err).toBeInstanceOf(BudgetError);
		expect(err.message).toBe("This pin's offline map didn't fit: the areas on screen fill all 4 MB. Zoom in on the pin to save it.");
		expect((await listRegions()).map((r) => r.id).sort()).toEqual(["b0", "b1", "b2"]);
		expect(await usedBytes()).toBe(3 * MB);
	});

	it("says 1 GB at the shipped budget", () => {
		expect(new BudgetError(0, 0, 0).message).toBe("This pin's offline map didn't fit: the areas on screen fill all 1 GB. Zoom in on the pin to save it.");
	});

	it("refuses an area before a byte is fetched when the guess does not fit", async () => {
		setBudgetMb(4);
		// One byte a tile so far; SPOTS[1] is ~1,400 tiles nobody has fetched.
		const r = region("a", 1, ...SPOTS[0], { fetched: 1000, newBytes: 1000 });
		await putRegion(r);
		await putTiles([[ownTile(r), new ArrayBuffer(4 * MB - 100)]], r.id);
		await expect(roomFor(...SPOTS[1])).rejects.toBeInstanceOf(BudgetError);
		setBudgetMb(1024);
		await expect(roomFor(...SPOTS[1])).resolves.toBeUndefined();
	});

	// Many maps with many pins each is normal: bytes are the only wall, never a count of areas.
	it("takes area 1,201 when the bytes fit", async () => {
		for (let i = 0; i < 1200; i++) await putRegion(region(`p${i}`, i, -136 + (i % 40) * 0.05, -14 + Math.floor(i / 40) * 0.05));
		await expect(roomFor(...SPOTS[0])).resolves.toBeUndefined();
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
			await putTiles([[ownTile(r), new ArrayBuffer(1024)]], r.id);
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
		await putTiles([[ownTile(r), new ArrayBuffer(1024)]], r.id);
		await removeArea(r);
		const pins = [{ anchors: [at], lastTouchedAt: new Date().toISOString(), corridor: false }];
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
		await vi.waitFor(async () => expect(await regionKnown(r.id)).toBe(false), SWEEP);
		stop();
	});
});

describe("an area lives and dies with its pin", () => {
	it("a pin gone while nobody watched takes its area, its photo and its row once the map store is ready", async () => {
		const [p, t, f] = SPOTS;
		const now = Date.now();
		const pinned = region(regionId(...p), now, ...p, { pin: true });
		const tomb = region(regionId(...t), now, ...t, { pin: true, removed: now });
		const follow = region(regionId(...f), now, ...f, { photoKey: undefined, photoCenter: undefined });
		for (const r of [pinned, tomb, follow]) await putRegion(r);
		await putTiles([[ownTile(pinned), new ArrayBuffer(1024)]], pinned.id);
		await putTiles([[ownTile(follow), new ArrayBuffer(1024)]], follow.id);
		let ready = false;
		let changed = (): void => undefined;
		const ports = {
			places: () => [],
			ready: () => ready,
			onPlacesChanged: (fn: () => void) => {
				changed = fn;
				fn();
				return () => undefined;
			},
		} as unknown as HostPorts;
		const stop = startBlobService(ports);
		await new Promise((r) => setTimeout(r, 20));
		// Hydrating is not empty.
		expect(await regionKnown(pinned.id)).toBe(true);
		ready = true;
		changed();
		await vi.waitFor(async () => expect(await regionKnown(pinned.id)).toBe(false), SWEEP);
		await vi.waitFor(async () => expect(await regionKnown(tomb.id)).toBe(false), SWEEP);
		expect((await listRegions()).map((r) => r.id)).toEqual([follow.id]);
		expect([...(await allTileKeys())]).toEqual([ownTile(follow)]);
		expect(photosDropped).toContain(satImageKey(p));
		stop();
	});

	it("an area removed mid-download stops the download and leaves no tile without a row", async () => {
		configureTilesDevHost("https://tiles.test");
		const at = SPOTS[1];
		const id = regionId(...at);
		let served = 0;
		vi.stubGlobal("fetch", async () => {
			if (++served === 300) await deleteRegion(id, true);
			// A network slower than the disk, as on a phone: writes land between fetches.
			await new Promise((r) => setTimeout(r, 2));
			return new Response(new ArrayBuffer(10));
		});
		const err = await download(at).catch((e) => e);
		expect(err).toBeInstanceOf(AreaGone);
		expect(served).toBeLessThan(rangeTiles(regionRange(...at)).length);
		expect(await orphanTiles()).toEqual([]);
		// The removed row stays, so the pin is not fetched straight back.
		expect(await regionKnown(id)).toBe(true);
		vi.unstubAllGlobals();
	});

	it("a failed download takes its photo with its row", async () => {
		configureTilesDevHost("https://tiles.test");
		const at = SPOTS[0];
		vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(download(at)).rejects.toThrow("HTTP 500");
		expect(await regionKnown(regionId(...at))).toBe(false);
		expect(photosDropped).toEqual([satImageKey(at)]);
		vi.unstubAllGlobals();
	});
});

// The LRU stack: the newest-touched areas keep their blobs, the bottom ones lose theirs, and a pin
// that comes back into view goes back on top. A real store, a fake network of 10-byte tiles.
describe("offline areas are an LRU cache of the 16 MB test budget", () => {
	const far = (i: number): [number, number] => [-130 + i * 2, 60];
	const view = ([lng, lat]: [number, number]) => ({ w: lng - 0.01, e: lng + 0.01, s: lat - 0.01, n: lat + 0.01 });
	const ids = async () => (await listRegions()).map((r) => r.id).sort();
	let stop = (): void => undefined;

	/** Four whole 4 MB areas touched oldest first, every one a pin; a new area is guessed at ~4 MB. */
	async function fillToBudget(): Promise<string[]> {
		setBudgetMb(16);
		const now = Date.now();
		const fill = [0, 1, 2, 3].map((i) => {
			const r = region(regionId(...far(i)), now - (40 - i) * DAY, ...far(i), { lastOpened: now - (30 - i) * DAY, pin: true });
			return { ...r, fetched: rangeTiles(r.range).length, newBytes: 4 * MB };
		});
		for (const r of fill) {
			await putRegion(r);
			const keys = rangeTiles(r.range).map(tileKey).filter((k) => k !== ownTile(r));
			await putTiles([[ownTile(r), new ArrayBuffer(4 * MB - keys.length * 10)], ...keys.map((k): [string, ArrayBuffer] => [k, new ArrayBuffer(10)])], r.id);
		}
		expect(await usedBytes()).toBe(16 * MB);
		return fill.map((r) => r.id);
	}

	/** The host's pins: the four that filled the budget plus any dropped since. */
	function host(extra: [number, number][] = []): HostPorts {
		const pins = [0, 1, 2, 3].map(far).concat(extra);
		return {
			places: () => pins.map((a) => ({ anchors: [a], corridor: false })),
			ready: () => true,
			onPlacesChanged: (fn: () => void) => (fn(), () => undefined),
		};
	}

	beforeEach(() => {
		configureTilesDevHost("https://tiles.test");
		// The tests above unstub every global, the file's window included.
		vi.stubGlobal("window", new EventTarget());
		vi.stubGlobal("fetch", async (url: string) =>
			String(url).endsWith("/squirrel/active") ? new Response(JSON.stringify({ active: "maptiler" })) : new Response(new ArrayBuffer(10)),
		);
		baked.length = 0;
	});
	afterEach(async () => {
		// The queue is the module's: a download still in it would land in the next test's store.
		await vi.waitFor(() => expect(blobBusy()).toBe(false), SWEEP);
		stop();
		vi.unstubAllGlobals();
	});

	it("A: a dropped pin stores its blob, its satellite photo asked for as its tiles start", async () => {
		const at = far(5);
		const stopPhotos = startPhotoService();
		stop = startBlobService(host([at]));
		await vi.waitFor(async () => expect(await regionKnown(regionId(...at))).toBe(true), SWEEP);
		expect((await checkRegions())[regionId(...at)]).toBe(0);
		expect(await orphanTiles()).toEqual([]);
		await vi.waitFor(() => expect(baked).toContain(satImageKey(at)), SWEEP);
		stopPhotos();
	});

	it("B: a pin dropped on a full budget evicts the least recently touched area and lands", async () => {
		const [oldest, ...rest] = await fillToBudget();
		const at = far(5);
		stop = startBlobService(host([at]));
		await vi.waitFor(async () => expect(await ids()).toEqual([...rest, regionId(...at)].sort()), SWEEP);
		expect(await usedBytes()).toBeLessThanOrEqual(16 * MB);
		// The evicted pin keeps its row as removed, so the reconcile does not fetch it straight back.
		expect(await regionKnown(oldest)).toBe(true);
	});

	it("C: an evicted area that comes back into view downloads again and goes to the top", async () => {
		const [oldest] = await fillToBudget();
		const at = far(5);
		stop = startBlobService(host([at]));
		await vi.waitFor(async () => expect(await ids()).not.toContain(oldest), SWEEP);
		await viewing(view(far(0)), 12);
		await vi.waitFor(async () => expect((await listRegions())[0].id).toBe(oldest), SWEEP);
		expect(await usedBytes()).toBeLessThanOrEqual(16 * MB);
	});

	it("D: an area on the visible map is never evicted, however old", async () => {
		const [oldest, second, ...rest] = await fillToBudget();
		await viewing(view(far(0)), 12);
		const at = far(5);
		stop = startBlobService(host([at]));
		await vi.waitFor(async () => expect(await ids()).toEqual([oldest, ...rest, regionId(...at)].sort()), SWEEP);
		expect(await ids()).not.toContain(second);
	});

	it("E: a pin that cannot fit fails loud with the words the map shows", async () => {
		await fillToBudget();
		// The whole stack is on screen: nothing may go.
		await viewing({ w: -131, e: -123, s: 59, n: 61 }, 12);
		const failed: unknown[] = [];
		const off = onBlob((e) => e.kind === "failed" && failed.push(e.error));
		const at = far(5);
		stop = startBlobService(host([at]));
		await vi.waitFor(() => expect(failed).toHaveLength(1), SWEEP);
		expect(failed[0]).toBeInstanceOf(BudgetError);
		expect((failed[0] as Error).message).toBe(fullMessage());
		expect(await ids()).toHaveLength(4);
		off();
	});

	it("F: an import of 21 waits for the planter, who sees its size and saves one pin", async () => {
		const set = { key: "groote", name: "Groote" };
		const imported = Array.from({ length: 21 }, (_, i) => far(10 + i));
		const at = far(5);
		const ports = host([at]);
		const hand = ports.places;
		ports.places = () => [...hand(), ...imported.map((a) => ({ anchors: [a], corridor: false, set }))];
		stop = startBlobService(ports);
		await vi.waitFor(async () => expect(await ids()).toContain(regionId(...at)), SWEEP);
		await vi.waitFor(() => expect(blobBusy()).toBe(false), SWEEP);
		expect(await ids()).toEqual([...[0, 1, 2, 3].map((i) => regionId(...far(i))), regionId(...at)].sort());

		const waiting: WaitingSet[][] = [];
		const off = onBlob((e) => e.kind === "waiting" && waiting.push(e.sets));
		await viewing(view(imported[0]), 12);
		expect(waiting.at(-1)).toEqual([{ ...set, here: [{ at: imported[0], photo: true }], all: imported.map((a) => ({ at: a, photo: true })) }]);
		const one = await estimateBytes(waiting.at(-1)![0].here);
		expect(one).toBeGreaterThan(0);
		expect(await estimateBytes(waiting.at(-1)![0].all)).toBeGreaterThan(one);

		saveSpots(waiting.at(-1)![0].here);
		await vi.waitFor(async () => expect(await ids()).toContain(regionId(...imported[0])), SWEEP);
		await vi.waitFor(() => expect(blobBusy()).toBe(false), SWEEP);
		expect(await ids()).not.toContain(regionId(...imported[1]));
		await viewing(view(imported[0]), 12);
		expect(waiting.at(-1)).toEqual([]);
		off();
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
		void download(at).catch(() => undefined);
		await vi.waitFor(async () => expect((await allTileKeys()).size).toBeGreaterThanOrEqual(256), SWEEP);
		expect(await orphanTiles()).toEqual([]);
		expect(await regionKnown(regionId(...at))).toBe(false);
		vi.unstubAllGlobals();
	});
});
