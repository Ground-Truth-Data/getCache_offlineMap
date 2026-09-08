import { describe, expect, it } from "vitest";
import {
	ANCHOR_Z,
	boxesIntersect,
	MAX_Z,
	MIN_Z,
	missingKeys,
	rangeBox,
	rangeContains,
	rangeTiles,
	regionBox,
	regionRange,
	tileBox,
	tileKey,
} from "./tiles";

const PIN = { lng: -119.5937, lat: 49.4991 }; // Penticton

describe("regionRange", () => {
	const r = regionRange(PIN.lng, PIN.lat);
	const box = regionBox(PIN.lng, PIN.lat);

	it("is 9–16 anchor tiles that together contain the 30 km box", () => {
		const n = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
		expect(n).toBeGreaterThanOrEqual(9);
		expect(n).toBeLessThanOrEqual(16);
		const b = rangeBox(r);
		expect(b.w).toBeLessThanOrEqual(box.w);
		expect(b.e).toBeGreaterThanOrEqual(box.e);
		expect(b.s).toBeLessThanOrEqual(box.s);
		expect(b.n).toBeGreaterThanOrEqual(box.n);
	});

	it("the pyramid has a top above the cut", () => {
		expect(MIN_Z).toBeLessThan(ANCHOR_Z);
		expect(ANCHOR_Z).toBeLessThanOrEqual(MAX_Z);
	});
});

describe("rangeTiles", () => {
	const r = regionRange(PIN.lng, PIN.lat);
	const tiles = rangeTiles(r);
	const border = rangeBox(r);

	it("covers exactly the same ground at every zoom from the cut down — the border is real at z10 and z13 alike", () => {
		for (let z = ANCHOR_Z; z <= MAX_Z; z++) {
			const level = tiles.filter((t) => t.z === z).map(tileBox);
			expect(level.length).toBeGreaterThan(0);
			expect(Math.min(...level.map((b) => b.w))).toBeCloseTo(border.w, 9);
			expect(Math.max(...level.map((b) => b.e))).toBeCloseTo(border.e, 9);
			expect(Math.min(...level.map((b) => b.s))).toBeCloseTo(border.s, 9);
			expect(Math.max(...level.map((b) => b.n))).toBeCloseTo(border.n, 9);
			for (const b of level) expect(boxesIntersect(b, border)).toBe(true);
		}
	});

	it("above the cut, every level is the few parents that contain the border — the top is one tile, not a province", () => {
		for (let z = MIN_Z; z < ANCHOR_Z; z++) {
			const level = tiles.filter((t) => t.z === z).map(tileBox);
			expect(level.length).toBeGreaterThan(0);
			expect(level.length).toBeLessThanOrEqual(4 ** Math.max(0, z - MIN_Z + 1));
			expect(Math.min(...level.map((b) => b.w))).toBeLessThanOrEqual(border.w);
			expect(Math.max(...level.map((b) => b.e))).toBeGreaterThanOrEqual(
				border.e,
			);
			expect(Math.min(...level.map((b) => b.s))).toBeLessThanOrEqual(border.s);
			expect(Math.max(...level.map((b) => b.n))).toBeGreaterThanOrEqual(
				border.n,
			);
			for (const b of level) expect(boxesIntersect(b, border)).toBe(true);
		}
		const parents = tiles.filter((t) => t.z < ANCHOR_Z).length;
		expect(parents).toBeLessThan(40);
	});

	it("is a whole pyramid per anchor tile, plus the parents", () => {
		const anchors = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
		let perAnchor = 0;
		for (let z = ANCHOR_Z; z <= MAX_Z; z++) perAnchor += 4 ** (z - ANCHOR_Z);
		const parents = tiles.filter((t) => t.z < ANCHOR_Z).length;
		expect(tiles.length).toBe(anchors * perAnchor + parents);
	});

	it("rangeContains agrees with the tile list", () => {
		for (const t of tiles) expect(rangeContains(r, t)).toBe(true);
		expect(rangeContains(r, { z: MAX_Z, x: 0, y: 0 })).toBe(false);
		expect(rangeContains(r, { z: MIN_Z - 1, x: r.x0 >> 4, y: r.y0 >> 4 })).toBe(
			false,
		);
		expect(rangeContains(r, { z: ANCHOR_Z - 1, x: 0, y: 0 })).toBe(false);
	});

	it("a parent is shared by neighbouring blobs, so deleting one blob keeps it", () => {
		const east = { ...r, x0: r.x1 + 1, x1: r.x1 + 1 };
		const parent = tiles.find((t) => t.z === ANCHOR_Z - 1 && t.x === r.x1 >> 1);
		expect(parent).toBeDefined();
		if (parent)
			expect(rangeContains(east, parent)).toBe((r.x1 + 1) >> 1 === parent.x);
	});

	it("keys are unique", () => {
		expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length);
	});
});

describe("missingKeys", () => {
	const r = regionRange(PIN.lng, PIN.lat);
	const all = rangeTiles(r).map(tileKey);

	it("a blob with every tile on disk is whole — an empty 0-byte row counts as on disk, it is a key", () => {
		expect(missingKeys(r, new Set(all))).toEqual([]);
	});

	it("names exactly the tiles that are not there, at any zoom", () => {
		const gone = [all[0], all[all.length - 1], all[Math.floor(all.length / 2)]];
		const have = new Set(all.filter((k) => !gone.includes(k)));
		expect(missingKeys(r, have).sort()).toEqual([...gone].sort());
	});

	it("an evicted store is missing everything", () => {
		expect(missingKeys(r, new Set()).length).toBe(all.length);
	});
});
