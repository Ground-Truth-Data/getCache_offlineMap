import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostPorts } from "../../lib/shared/hostPorts";
import type { Region } from "./store";
import { regionRange } from "./tiles";

const disk: Region[] = [];
const downloads: Array<[number, number]> = [];
const photosDropped: string[] = [];
let release: (() => void) | null = null;

let keepAsked = 0;
vi.mock("./store", () => ({
	regionsSnapshot: () => ({ version: 0, regions: Promise.resolve([...disk]) }),
	keepStorage: async () => {
		keepAsked++;
		return "kept";
	},
	regionId: (lng: number, lat: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`,
	deleteRegion: async (id: string) => {
		const i = disk.findIndex((r) => r.id === id);
		if (i >= 0) disk.splice(i, 1);
		return i >= 0 ? 1 : 0;
	},
}));
vi.mock(
	"../../lib/onPhone/satellite/satelliteImage",
	() => ({
		satImageKey: (c: [number, number]) =>
			`${c[0].toFixed(4)},${c[1].toFixed(4)}`,
		deleteSatImage: async (k: string) => {
			photosDropped.push(k);
		},
	}),
);
vi.mock("./download", () => ({
	downloadRegion: async (
		lng: number,
		lat: number,
		_p?: unknown,
		opts: { photo?: boolean } = {},
	) => {
		downloads.push([lng, lat]);
		await new Promise<void>((r) => {
			release = r;
		});
		const region: Region = {
			id: `${lat.toFixed(5)},${lng.toFixed(5)}`,
			lng,
			lat,
			range: regionRange(lng, lat),
			at: Date.now(),
			tiles: 1,
			fetched: 1,
			bytes: 1,
			ms: 1,
		};
		if (opts.photo === false) region.photo = false;
		disk.push(region);
		return region;
	},
}));

const { blobBusy, onBlob, queueBlob, startBlobService } = await import(
	"./blobService"
);

const PENTICTON: [number, number] = [-119.5937, 49.4991];
const SPOKANE: [number, number] = [-117.426, 47.6588];
const tick = () => new Promise((r) => setTimeout(r, 0));
const soon = () => new Date(Date.now() + 1000).toISOString();
const ago = () => new Date(Date.now() - 1000).toISOString();

function fakePorts(
	places: () => HostPorts["places"] extends () => infer P ? P : never,
) {
	let cb: (() => void) | null = null;
	const ports = {
		places,
		ready: () => true,
		onPlacesChanged: (fn: () => void) => {
			cb = fn;
			fn();
			return () => {
				cb = null;
			};
		},
	} as unknown as HostPorts;
	return { ports, changed: () => cb?.(), listening: () => cb !== null };
}

beforeEach(() => {
	disk.length = 0;
	downloads.length = 0;
	photosDropped.length = 0;
	release = null;
});

describe("blob service", () => {
	it("a pin touched after the start earns a blob; older pins do not", async () => {
		const list = [
			{ anchors: [PENTICTON], lastTouched: ago(), corridor: false },
		];
		const { ports, changed, listening } = fakePorts(() => list);
		const stop = startBlobService(ports);
		// the engine asks the browser to keep the store at boot, while there is nothing to lose
		expect(keepAsked).toBe(1);
		await tick();
		expect(downloads).toEqual([]);
		list.push({ anchors: [SPOKANE], lastTouched: soon(), corridor: false });
		changed();
		await tick();
		expect(downloads).toEqual([SPOKANE]);
		release?.();
		await tick();
		stop();
		expect(listening()).toBe(false);
	});

	it("a corridor bakes every anchor, roads only — no photo", async () => {
		const list = [
			{
				anchors: [PENTICTON, SPOKANE],
				lastTouched: soon(),
				corridor: true,
			},
		];
		const { ports } = fakePorts(() => list);
		const stop = startBlobService(ports);
		await tick();
		expect(downloads).toEqual([PENTICTON]);
		release?.();
		await tick();
		await tick();
		expect(downloads).toEqual([PENTICTON, SPOKANE]);
		release?.();
		await tick();
		await tick();
		// roads are the point of a line; a photo per anchor is what makes one expensive
		expect(disk.map((r) => r.photo)).toEqual([false, false]);
		stop();
	});

	it("one download at a time, in order; the same spot is never queued twice; disk wins", async () => {
		const events: string[] = [];
		const off = onBlob((e) => events.push(e.kind));
		expect(await queueBlob(...PENTICTON)).toBe(true);
		expect(await queueBlob(...PENTICTON)).toBe(false);
		expect(await queueBlob(...SPOKANE)).toBe(true);
		expect(blobBusy()).toBe(true);
		await tick();
		expect(downloads).toEqual([PENTICTON]);
		release?.();
		await tick();
		await tick();
		expect(downloads).toEqual([PENTICTON, SPOKANE]);
		release?.();
		await tick();
		await tick();
		expect(blobBusy()).toBe(false);
		expect(events).toEqual(["start", "landed", "start", "landed"]);
		expect(await queueBlob(...PENTICTON)).toBe(false);
		off();
	});

	it("a deleted pin takes its blob and its photo; a pin with no blob takes nothing", async () => {
		const events: string[] = [];
		const off = onBlob((e) => events.push(e.kind));
		const list = [
			{ anchors: [PENTICTON], lastTouched: ago(), corridor: false },
			{ anchors: [SPOKANE], lastTouched: soon(), corridor: false },
		];
		const { ports, changed } = fakePorts(() => list);
		const stop = startBlobService(ports);
		await tick();
		release?.();
		await tick();
		await tick();
		expect(disk.map((r) => r.id)).toEqual([
			`${SPOKANE[1].toFixed(5)},${SPOKANE[0].toFixed(5)}`,
		]);
		// the old pin had no blob: deleting it drops nothing
		list.splice(0, 1);
		changed();
		await tick();
		expect(disk.length).toBe(1);
		expect(photosDropped).toEqual([]);
		// the blob's pin goes: blob and photo go with it
		list.splice(0, 1);
		changed();
		await tick();
		await tick();
		expect(disk).toEqual([]);
		expect(photosDropped).toEqual([
			`${SPOKANE[0].toFixed(4)},${SPOKANE[1].toFixed(4)}`,
		]);
		expect(events.at(-1)).toBe("removed");
		stop();
		off();
	});

	it("a follow-me blob lands marked no-photo; a pin's blob is not marked", async () => {
		expect(await queueBlob(...PENTICTON, { photo: false })).toBe(true);
		await tick();
		release?.();
		await tick();
		await tick();
		expect(await queueBlob(...SPOKANE)).toBe(true);
		await tick();
		release?.();
		await tick();
		await tick();
		expect(disk.map((r) => r.photo)).toEqual([false, undefined]);
	});

	it("a pin inside an older blob's ground still earns its own blob", async () => {
		expect(await queueBlob(...PENTICTON)).toBe(true);
		await tick();
		release?.();
		await tick();
		await tick();
		const nextDoor: [number, number] = [PENTICTON[0] + 0.001, PENTICTON[1]];
		expect(await queueBlob(...nextDoor)).toBe(true);
		await tick();
		release?.();
		await tick();
		await tick();
		expect(downloads).toEqual([PENTICTON, nextDoor]);
		expect(await queueBlob(...nextDoor)).toBe(false);
	});
});
