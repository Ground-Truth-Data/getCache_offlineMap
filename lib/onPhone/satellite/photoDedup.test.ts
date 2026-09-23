/**
 * The one-time sweep for photos baked before the reuse rule.
 *
 * The rule that must never break: a photo is deleted ONLY when a surviving
 * photo covers the same ground. A sweep that leaves an area blank is worse
 * than the wasted bytes it reclaimed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const photos = new Map<string, number>(); // key -> bytes
const coverage: { key: string; hasPhoto: boolean; photoBytes: number }[] = [];

// `photoReusableFor` is the REAL one, not a stub: it is the rule the bake uses
// to skip a download, and a sweep tested against a different rule is how the
// two drifted apart in the first place.
vi.mock("./satelliteImage", async (importOriginal) => ({
	...(await importOriginal<typeof import("./satelliteImage")>()),
	satImageMeta: async () =>
		[...photos].map(([key, bytes]) => ({ key, bytes, source: SOURCE })),
	deleteSatImage: async (k: string) => void photos.delete(k),
}));
vi.mock("../store/coverageRegistry", () => ({
	noteCoverage: async (
		key: string,
		_lng: number,
		_lat: number,
		p: { hasPhoto?: boolean; photoBytes?: number },
	) => {
		coverage.push({
			key,
			hasPhoto: p.hasPhoto ?? true,
			photoBytes: p.photoBytes ?? 0,
		});
	},
	dropCoverage: async () => {},
}));

const { planPhotoDedup, runPhotoDedup } = await import("./photoDedup");

const STAND: [number, number] = [-117.2, 56.9];
/** The row that serves STAND (Canada — outside every USGS box). */
const SOURCE = "MapTiler";
const key = (c: [number, number]) => `${c[0].toFixed(4)},${c[1].toFixed(4)}`;
const east = (from: [number, number], km: number): [number, number] => [
	from[0] + km / (111.32 * Math.cos((from[1] * Math.PI) / 180)),
	from[1],
];

beforeEach(() => {
	photos.clear();
	coverage.length = 0;
});

describe("the duplicate-photo sweep", () => {
	it("collapses a stand of near-identical photos to one", async () => {
		for (let i = 0; i < 10; i++) photos.set(key(east(STAND, i * 0.05)), 1000);
		const plan = await runPhotoDedup();
		expect(plan.keep).toHaveLength(1);
		expect(photos.size).toBe(1);
		expect(plan.bytes).toBe(9000);
	});

	it("reaches zero and STAYS there — a second sweep finds nothing", async () => {
		// The button's whole promise. When the sweep judged by distance alone it
		// kept reporting photos the bake had minted deliberately, so the count
		// came back however often it was pressed.
		for (let i = 0; i < 10; i++) photos.set(key(east(STAND, i * 0.05)), 1000);
		await runPhotoDedup();
		expect((await planPhotoDedup()).drop).toHaveLength(0);
	});

	it("NEVER deletes a photo nothing else covers", async () => {
		photos.set(key(STAND), 1000);
		photos.set(key(east(STAND, 40)), 1000); // a different job, far away
		const plan = await runPhotoDedup();
		expect(plan.drop).toHaveLength(0);
		expect(photos.size).toBe(2);
	});

	it("keeps the BIGGEST photo of a cluster — the widest canvas, least detail lost", async () => {
		photos.set(key(STAND), 500);
		photos.set(key(east(STAND, 0.1)), 9000);
		const plan = await runPhotoDedup();
		expect(plan.keep).toEqual([key(east(STAND, 0.1))]);
	});

	it("clears the photo half of the budget record, keeping the area's row", async () => {
		photos.set(key(STAND), 1000);
		photos.set(key(east(STAND, 0.1)), 1000);
		await runPhotoDedup();
		// patched, not dropped: the area keeps its road tiles
		expect(coverage).toHaveLength(1);
		expect(coverage[0]).toMatchObject({ hasPhoto: false, photoBytes: 0 });
	});

	it("plan() destroys nothing — a number can be shown before deleting", async () => {
		for (let i = 0; i < 5; i++) photos.set(key(east(STAND, i * 0.05)), 1000);
		const plan = await planPhotoDedup();
		expect(plan.drop).toHaveLength(4);
		expect(photos.size).toBe(5);
	});
});
