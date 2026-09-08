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
		satImageMeta: async () =>
			[...onDisk.entries()].map(([key, v]) => ({
				key,
				bytes: v.blob.size,
				source: v.source,
			})),
		bakeSatelliteImage: async (c: [number, number]) => {
			bakes.push(c);
			const r = bakeResult?.() ?? null;
			if (r) onDisk.set(`${c[0].toFixed(4)},${c[1].toFixed(4)}`, r);
			return r;
		},
		deleteSatImage: async (k: string) => {
			onDisk.delete(k);
		},
	}),
);
let photoBytesReported = -1;
vi.mock("./store", () => ({
	regionsSnapshot: () => ({ regions: Promise.resolve([]) }),
	notePhotoBytes: (n: number) => {
		photoBytesReported = n;
	},
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
		// the pause test above leaves the pass paused into real time — step past it
		vi.useFakeTimers();
		vi.advanceTimersByTime(PHOTO_RETRY_MS + 1);
		await bakePhotos([PENTICTON]);
		const sizes = await photoInfo();
		expect(sizes[photoKey(...PENTICTON)].bytes).toBe(2048);
		// the photos' total goes to the tile store, which counts it against the budget
		expect(photoBytesReported).toBe(
			Object.values(sizes).reduce((a, p) => a + p.bytes, 0),
		);
	});
});
