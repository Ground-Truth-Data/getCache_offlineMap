import { beforeEach, describe, expect, it, vi } from "vitest";

const onDisk = new Map<
	string,
	{ blob: Blob; bounds: number[]; source?: string }
>();
const bakes: Array<[number, number]> = [];
let bakeResult: (() => { blob: Blob; bounds: number[] } | null) | null = null;

vi.mock(
	"../../lib/onPhone/satellite/satelliteImage",
	() => ({
		BAKE_RADIUS_KM: 2,
		satImageKey: (c: [number, number]) =>
			`${c[0].toFixed(4)},${c[1].toFixed(4)}`,
		getSatImageByKey: async (k: string) => onDisk.get(k),
		isCurrentPhoto: (img?: { source?: string }) => !!img && img.source !== "USGS",
		satImageMeta: async () =>
			[...onDisk.entries()].map(([key, v]) => ({
				key,
				bytes: v.blob.size,
				source: v.source,
			})),
		bakeSatelliteImage: async (c: [number, number], _tiles: unknown, beforeSave?: () => Promise<void>) => {
			bakes.push(c);
			const r = bakeResult?.() ?? null;
			if (!r) return r;
			await beforeSave?.();
			onDisk.set(`${c[0].toFixed(4)},${c[1].toFixed(4)}`, r);
			return r;
		},
		deleteSatImage: async (k: string) => {
			onDisk.delete(k);
		},
	}),
);
let photoBytesReported = -1;
const { rowless, AreaGone } = vi.hoisted(() => ({ rowless: new Set<string>(), AreaGone: class AreaGone extends Error {} }));
vi.mock("./store", () => ({
	AreaGone,
	regionId: (lng: number, lat: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`,
	claimArea: async (id: string) => {
		if (rowless.has(id)) throw new AreaGone(id);
	},
	regionsSnapshot: () => ({ regions: Promise.resolve([]) }),
	notePhotoBytes: (n: number) => {
		photoBytesReported = n;
	},
	putPhotoTiles: async () => undefined,
	photoTileBytes: async () => new Map(),
}));
vi.mock("./blobService", () => ({ onBlob: () => () => undefined }));

const { PHOTO_RETRY_MS, bakePhotos, dropPhoto, photoKey, photoInfo } =
	await import("./satellite");

const PENTICTON: [number, number] = [-119.5937, 49.4991];
const photo = () => ({
	blob: new Blob(["x".repeat(2048)], { type: "image/webp" }),
	bounds: [-119.62, 49.48, -119.57, 49.52],
});

beforeEach(() => {
	onDisk.clear();
	bakes.length = 0;
	bakeResult = photo;
	vi.useRealTimers();
});

describe("the photo pass", () => {
	it("a photo from a beaten source is re-baked, not kept because one exists", async () => {
		// the bug: the pass skipped any centre with a photo on disk, so a USGS photo stayed after USGS was dropped
		onDisk.set(photoKey(...PENTICTON), { ...photo(), source: "USGS" });
		await bakePhotos([PENTICTON]);
		expect(bakes).toEqual([PENTICTON]);
	});

	it("a blob without a photo gets one, keyed on its centre", async () => {
		const n = await bakePhotos([PENTICTON]);
		expect(n).toBe(1);
		expect(bakes).toEqual([PENTICTON]);
		expect(onDisk.has(photoKey(...PENTICTON))).toBe(true);
	});

	it("a blob with a photo on disk is left alone", async () => {
		onDisk.set(photoKey(...PENTICTON), photo());
		const n = await bakePhotos([PENTICTON]);
		expect(n).toBe(0);
		expect(bakes).toEqual([]);
	});

	it("a photo whose area went mid-bake is never saved, and the pass goes on to the next", async () => {
		const other: [number, number] = [-118, 49];
		rowless.add(`${PENTICTON[1].toFixed(5)},${PENTICTON[0].toFixed(5)}`);
		expect(await bakePhotos([PENTICTON, other])).toBe(1);
		expect(bakes).toEqual([PENTICTON, other]);
		expect(onDisk.has(photoKey(...PENTICTON))).toBe(false);
		rowless.clear();
	});

	it("no imagery pauses the pass, and it runs again after PHOTO_RETRY_MS", async () => {
		vi.useFakeTimers();
		bakeResult = () => null;
		const other: [number, number] = [-118, 49];
		expect(await bakePhotos([PENTICTON, other])).toBe(0);
		expect(bakes).toEqual([PENTICTON]);
		bakeResult = photo;
		expect(await bakePhotos([PENTICTON, other])).toBe(0);
		expect(bakes).toHaveLength(1);
		vi.advanceTimersByTime(PHOTO_RETRY_MS + 1);
		expect(await bakePhotos([PENTICTON, other])).toBe(2);
		expect(bakes).toHaveLength(3);
	});

	it("dropping a blob drops its photo", async () => {
		await bakePhotos([PENTICTON]);
		await dropPhoto(...PENTICTON);
		expect(onDisk.has(photoKey(...PENTICTON))).toBe(false);
	});

	it("photoInfo reads bytes per key without touching the pixels", async () => {
		// the pause test above leaves the pass paused into real time
		vi.useFakeTimers();
		vi.advanceTimersByTime(PHOTO_RETRY_MS + 1);
		await bakePhotos([PENTICTON]);
		const sizes = await photoInfo();
		expect(sizes[photoKey(...PENTICTON)].bytes).toBe(2048);
		expect(photoBytesReported).toBe(
			Object.values(sizes).reduce((a, p) => a + p.bytes, 0),
		);
	});
});
