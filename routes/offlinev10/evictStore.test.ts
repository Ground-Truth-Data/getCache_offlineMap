/**
 * The policy is pure and tested next door; this asks the only question that
 * cannot be answered there — does the axe actually reach the disk when the
 * wall is hit, or does `putTiles` still just throw?
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { setBudgetMb } from "./budget";
import {
	deleteRegion,
	listRegions,
	putRegion,
	putTiles,
	type Region,
	usedBytes,
	wipe,
} from "./store";
import { rangeTiles, regionRange, tileKey } from "./tiles";

const MB = 1048576;

function region(id: string, at: number, lng: number, lat: number): Region {
	return {
		id,
		lng,
		lat,
		range: regionRange(lng, lat),
		at,
		tiles: 1,
		fetched: 1,
		bytes: 0,
		ms: 1,
	};
}

/** Distinct spots, so no two blobs share tiles and each one's bytes are its own. */
const SPOTS: Array<[number, number]> = [
	[-119.59, 49.49],
	[-117.42, 47.65],
	[-114.06, 51.04],
];

beforeEach(async () => {
	await wipe();
	setBudgetMb(1024);
});

describe("eviction reaches the disk", () => {
	it("frees the oldest blob instead of throwing when the budget is full", async () => {
		// Three blobs, each a megabyte of tiles, on a four-megabyte budget.
		setBudgetMb(4);
		for (let i = 0; i < 3; i++) {
			const [lng, lat] = SPOTS[i];
			const r = region(`b${i}`, 1000 + i, lng, lat);
			await putRegion(r);
			// A tile from the blob's OWN range, so its size is attributable to it.
			await putTiles([[tileKey(rangeTiles(r.range)[0]), new ArrayBuffer(MB)]]);
		}
		expect((await listRegions()).map((r) => r.id).sort()).toEqual([
			"b0",
			"b1",
			"b2",
		]);

		// A fourth megabyte crosses the line: the oldest goes, the write lands.
		await expect(
			putTiles([["3/0/0", new ArrayBuffer(2 * MB)]]),
		).resolves.toBeUndefined();

		const left = (await listRegions()).map((r) => r.id).sort();
		expect(left).not.toContain("b0");
		expect(left).toContain("b2");
		expect(await usedBytes()).toBeLessThanOrEqual(4 * MB);
	});

	it("still refuses a blob larger than the whole budget, disk intact", async () => {
		setBudgetMb(4);
		const [lng, lat] = SPOTS[0];
		await putRegion(region("keep", 1, lng, lat));
		await putTiles([["0/0/0", new ArrayBuffer(MB)]]);

		await expect(
			putTiles([["huge/0/0", new ArrayBuffer(99 * MB)]]),
		).rejects.toThrow(/budget/i);
		// the refusal must not have cleared the map on its way out
		expect((await listRegions()).map((r) => r.id)).toEqual(["keep"]);
	});

	it("deleteRegion is what the axe uses, so shared ground survives", async () => {
		setBudgetMb(1024);
		const [lng, lat] = SPOTS[0];
		await putRegion(region("a", 1, lng, lat));
		await putRegion(region("b", 2, lng + 0.001, lat));
		await putTiles([["shared/0/0", new ArrayBuffer(1024)]]);
		await deleteRegion("a");
		expect((await listRegions()).map((r) => r.id)).toEqual(["b"]);
	});
});
