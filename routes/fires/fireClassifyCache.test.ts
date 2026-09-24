import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetClassifyCacheForTest,
	classifiedCount,
	classifyPending,
	peekUrbanVerdict,
	setUrbanVerdict,
} from "./fireClassifyCache";
import { CELL_DEG } from "./masks/staticHeatSources";

beforeEach(() => {
	__resetClassifyCacheForTest();
});

const at = (i: number): [number, number] => [-121 + i * 0.01, 50];

describe("a verdict is remembered, not recomputed", () => {
	it("returns null before anything is known", () => {
		expect(peekUrbanVerdict(-121, 50)).toBeNull();
	});

	it("remembers what it was told", () => {
		setUrbanVerdict(-121, 50, true);
		expect(peekUrbanVerdict(-121, 50)).toBe(true);
		setUrbanVerdict(-122, 50, false);
		expect(peekUrbanVerdict(-122, 50)).toBe(false);
	});

	it("shares one verdict across a ~375 m CELL, not per coordinate", () => {
		// Anchored at a cell centre so the test exercises sharing, not the rounding boundary.
		const centre = Math.round(-121 / CELL_DEG) * CELL_DEG;
		setUrbanVerdict(centre, 50, true);
		expect(peekUrbanVerdict(centre + CELL_DEG * 0.4, 50)).toBe(true);
		expect(peekUrbanVerdict(centre - CELL_DEG * 0.4, 50)).toBe(true);
		expect(peekUrbanVerdict(centre + CELL_DEG * 2, 50)).toBeNull();
	});
});

describe("classifyPending — the expensive call happens ONCE per cell", () => {
	it("asks the expensive question once per distinct cell, not per detection", () => {
		const isUrbanFn = vi.fn(() => false);
		const coords = Array.from({ length: 500 }, () => [-121, 50] as const);
		return classifyPending(coords, isUrbanFn).then(() => {
			expect(isUrbanFn).toHaveBeenCalledTimes(1);
		});
	});

	it("never re-asks a question it has already answered", async () => {
		const isUrbanFn = vi.fn(() => false);
		const coords = [at(0), at(1), at(2)];
		await classifyPending(coords, isUrbanFn);
		expect(isUrbanFn).toHaveBeenCalledTimes(3);
		isUrbanFn.mockClear();
		await classifyPending(coords, isUrbanFn);
		expect(isUrbanFn).not.toHaveBeenCalled();
	});

	it("reports whether it learned anything, so paint isn't re-run for free", async () => {
		const coords = [at(0)];
		expect(await classifyPending(coords, () => false)).toBe(true);
		expect(await classifyPending(coords, () => false)).toBe(false);
	});

	it("does nothing at all for an empty list", async () => {
		const isUrbanFn = vi.fn(() => false);
		expect(await classifyPending([], isUrbanFn)).toBe(false);
		expect(isUrbanFn).not.toHaveBeenCalled();
	});

	it("stores the verdicts it computed", async () => {
		await classifyPending([at(0), at(1)], (lng) => lng < -120.995);
		expect(peekUrbanVerdict(...at(0))).toBe(true);
		expect(peekUrbanVerdict(...at(1))).toBe(false);
		expect(classifiedCount()).toBe(2);
	});

	it("YIELDS between slices so the map keeps painting", async () => {
		const coords = Array.from({ length: 1000 }, (_, i) => at(i));
		let resolved = false;
		const p = classifyPending(coords, () => false, 100).then(() => {
			resolved = true;
		});
		await Promise.resolve();
		expect(resolved).toBe(false);
		await p;
		expect(resolved).toBe(true);
	});
});

describe("the paint path never blocks on classification", () => {
	it("an unknown cell reads as NOT urban, so the fire renders", () => {
		expect(peekUrbanVerdict(-121, 50)).toBeNull();
		// The paint predicate is `=== true`, so null renders the hotspot.
		expect(peekUrbanVerdict(-121, 50) === true).toBe(false);
	});
});
