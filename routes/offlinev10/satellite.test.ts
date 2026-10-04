import { beforeEach, describe, expect, it, vi } from "vitest";

const onDisk = new Map<
	string,
	{ blob: Blob; bounds: number[]; source?: string }
>();
const bakes: Array<{ key: string; center: [number, number]; owner: string }> = [];
let bakeResult: (() => { blob: Blob; bounds: number[] } | null) | null = null;

vi.mock(
	"../../lib/onPhone/satellite/satelliteImage",
	() => ({
		BAKE_RADIUS_KM: 2,
		getSatImageByKey: async (k: string) => onDisk.get(k),
		isCurrentPhoto: (img?: { source?: string }) => !!img && img.source !== "USGS",
		satImageMeta: async () =>
			[...onDisk.entries()].map(([key, v]) => ({
				key,
				bytes: v.blob.size,
				source: v.source,
			})),
		bakeSatelliteImage: async (
			key: string,
			center: [number, number],
			_tiles: unknown,
			beforeSave?: () => Promise<void>,
		) => {
			bakes.push({ key, center, owner: "" });
			const r = bakeResult?.() ?? null;
			if (!r) return r;
			await beforeSave?.();
			onDisk.set(key, r);
			return r;
		},
		deleteSatImage: async (k: string) => {
			onDisk.delete(k);
		},
	}),
);

let photoBytesReported = -1;
// The real claim: a row with exactly this id, not removed. Anything else throws, with the reason.
const { rows, AreaGone } = vi.hoisted(() => ({
	rows: new Map<string, { removed?: number }>(),
	AreaGone: class AreaGone extends Error {
		constructor(
			readonly id: string,
			readonly why: "removed" | "missing",
		) {
			super(`offline area ${id} is ${why}`);
		}
	},
}));
let regions: Array<{ id: string; photoKey?: string }> = [];
vi.mock("./store", () => ({
	AreaGone,
	claimArea: async (id: string) => {
		const r = rows.get(id);
		if (!r || r.removed) throw new AreaGone(id, r ? "removed" : "missing");
	},
	regionsSnapshot: () => ({ regions: Promise.resolve(regions) }),
	notePhotoBytes: (n: number) => {
		photoBytesReported = n;
	},
	putPhotoTiles: async () => undefined,
	photoTileBytes: async () => new Map(),
}));
vi.mock("./blobService", () => ({ onBlob: () => () => undefined }));

const { PHOTO_RETRY_MS, bakePhotos, dropPhoto, photoInfo, setPhotoNarration } =
	await import("./satellite");

/** A pin's coordinates are full-precision floats, as a GPS fix or a map tap delivers them. */
const PIN: [number, number] = [136.4721487975096, -14.117754653776629];
const PENTICTON: [number, number] = [-119.5937, 49.4991];
const SPOKANE: [number, number] = [-117.426, 47.6588];

/** What the engine carries from a blob's birth; this mirrors it so the tests hold the ids, not recompute them. */
const askOf = ([lng, lat]: [number, number]) => ({
	id: `${lat.toFixed(5)},${lng.toFixed(5)}`,
	photoKey: `${lng.toFixed(4)},${lat.toFixed(4)}`,
	at: [lng, lat] as [number, number],
});
const live = (...at: Array<[number, number]>) => {
	for (const p of at) rows.set(askOf(p).id, {});
};
const photo = () => ({
	blob: new Blob(["x".repeat(2048)], { type: "image/webp" }),
	bounds: [-119.62, 49.48, -119.57, 49.52],
});

beforeEach(() => {
	onDisk.clear();
	rows.clear();
	regions = [];
	bakes.length = 0;
	bakeResult = photo;
	setPhotoNarration(false);
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("the photo pass", () => {
	it("a full-precision pin gets its photo: the claim finds the row the blob was born with", async () => {
		// The bug: the centre was rebuilt from the 4-decimal key, so the owner id came out
		// -14.11780,136.47210 and no row had it. The ask now carries the id by value.
		live(PIN);
		const ask = askOf(PIN);
		expect(ask.id).toBe("-14.11775,136.47215");
		expect(await bakePhotos([ask])).toBe(1);
		expect(bakes).toHaveLength(1);
		expect(bakes[0].center).toBe(ask.at);
		expect(bakes[0].center).toEqual(PIN);
		expect(onDisk.has("136.4721,-14.1178")).toBe(true);
	});

	it("a photo from a beaten source is re-baked, not kept because one exists", async () => {
		// the bug: the pass skipped any centre with a photo on disk, so a USGS photo stayed after USGS was dropped
		live(PENTICTON);
		onDisk.set(askOf(PENTICTON).photoKey, { ...photo(), source: "USGS" });
		await bakePhotos([askOf(PENTICTON)]);
		expect(bakes.map((b) => b.center)).toEqual([PENTICTON]);
	});

	it("a blob without a photo gets one, stored under the key its record names", async () => {
		live(PENTICTON);
		expect(await bakePhotos([askOf(PENTICTON)])).toBe(1);
		expect(bakes[0].key).toBe(askOf(PENTICTON).photoKey);
		expect(onDisk.has(askOf(PENTICTON).photoKey)).toBe(true);
	});

	it("a blob with a photo on disk is left alone", async () => {
		live(PENTICTON);
		onDisk.set(askOf(PENTICTON).photoKey, photo());
		expect(await bakePhotos([askOf(PENTICTON)])).toBe(0);
		expect(bakes).toEqual([]);
	});

	it("a photo whose area was removed mid-bake is never saved, the pass goes on, and it says why without crying wolf", async () => {
		const other: [number, number] = [-118, 49];
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		rows.set(askOf(PENTICTON).id, { removed: 1 });
		live(other);
		expect(await bakePhotos([askOf(PENTICTON), askOf(other)])).toBe(1);
		expect(bakes).toHaveLength(2);
		expect(onDisk.has(askOf(PENTICTON).photoKey)).toBe(false);
		expect(info).toHaveBeenCalledWith(expect.stringContaining("removed"));
		expect(warn).not.toHaveBeenCalled();
	});

	it("an ask whose id no blob was born with warns loudly, names the id, and the pass goes on", async () => {
		const other: [number, number] = [-118, 49];
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		live(other); // PENTICTON has no row
		expect(await bakePhotos([askOf(PENTICTON), askOf(other)])).toBe(1);
		expect(onDisk.has(askOf(PENTICTON).photoKey)).toBe(false);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(askOf(PENTICTON).id));
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("no blob was born with"));
	});

	it("no imagery pauses the pass, and it runs again after PHOTO_RETRY_MS", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		live(PENTICTON, SPOKANE);
		bakeResult = () => null;
		const both = [askOf(PENTICTON), askOf(SPOKANE)];
		expect(await bakePhotos(both)).toBe(0);
		expect(bakes).toHaveLength(1);
		bakeResult = photo;
		expect(await bakePhotos(both)).toBe(0);
		expect(bakes).toHaveLength(1);
		vi.advanceTimersByTime(PHOTO_RETRY_MS + 1);
		expect(await bakePhotos(both)).toBe(2);
		expect(bakes).toHaveLength(3);
	});

	it("a skipped pass says so when narration is on — silence is never the only signal", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		live(PENTICTON);
		bakeResult = () => null;
		await bakePhotos([askOf(PENTICTON)]); // pauses
		setPhotoNarration(true);
		await bakePhotos([askOf(PENTICTON)]);
		expect(info).toHaveBeenCalledWith(expect.stringContaining("paused"));
		vi.advanceTimersByTime(PHOTO_RETRY_MS + 1);
		onDisk.set(askOf(PENTICTON).photoKey, photo());
		await bakePhotos([askOf(PENTICTON)]);
		expect(info).toHaveBeenCalledWith(expect.stringContaining("already has its photo"));
	});

	it("dropping a blob drops its photo by the key its record names", async () => {
		live(PENTICTON);
		await bakePhotos([askOf(PENTICTON)]);
		await dropPhoto(askOf(PENTICTON).photoKey);
		expect(onDisk.has(askOf(PENTICTON).photoKey)).toBe(false);
	});

	it("photoInfo reads bytes per key without touching the pixels", async () => {
		// the pause tests above leave the pass paused into real time
		vi.useFakeTimers();
		vi.advanceTimersByTime(PHOTO_RETRY_MS + 1);
		live(PENTICTON);
		regions = [askOf(PENTICTON)];
		await bakePhotos([askOf(PENTICTON)]);
		const sizes = await photoInfo();
		expect(sizes[askOf(PENTICTON).photoKey].bytes).toBe(2048);
		expect(photoBytesReported).toBe(
			Object.values(sizes).reduce((a, p) => a + p.bytes, 0),
		);
	});
});
