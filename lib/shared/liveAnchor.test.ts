import { describe, expect, it } from "vitest";
import {
	FIRE_TRIGGER_KM,
	fireDiscCentres,
	FIRE_RELEVANCE_KM,
	fireCentresWorthFetching,
	isUsableFix,
	kmToNearest,
	needsFireDisc,
} from "./liveAnchor";
import { FIRE_RADIUS_KM } from "./fireContract";
import type { LngLat } from "./kmGeo";

// A block in the Ottawa valley — the repo's usual test locale.
const BLOCK: LngLat = [-76.3, 45.2];

/** Move km due north; ~111 km/° is exact enough for threshold tests without a projection. */
function north(from: LngLat, km: number): LngLat {
	return [from[0], from[1] + km / 111.32];
}

describe("needsFireDisc — geography only", () => {
	it("pulls a disc on the first fix", () => {
		expect(needsFireDisc(BLOCK, [])).toBe(true);
	});

	it("triggers a fire refetch INSIDE the disc it already has", () => {
		expect(FIRE_TRIGGER_KM).toBeLessThan(FIRE_RADIUS_KM);
	});

	it("does not refetch across a whole season at one camp", () => {
		for (const km of [1, 10, 50, 100, 200, 300]) {
			expect(needsFireDisc(north(BLOCK, km), [BLOCK])).toBe(false);
		}
	});

	it("refetches after a genuine relocation", () => {
		expect(needsFireDisc(north(BLOCK, FIRE_TRIGGER_KM + 10), [BLOCK])).toBe(
			true,
		);
	});
});

describe("kmToNearest", () => {
	it("is Infinity with no coverage, so the first fix always triggers", () => {
		expect(kmToNearest(BLOCK, [])).toBe(Number.POSITIVE_INFINITY);
	});

	it("is zero at a centre", () => {
		expect(kmToNearest(BLOCK, [BLOCK])).toBeCloseTo(0, 5);
	});
});

describe("isUsableFix — junk is never a position", () => {
	it("accepts a real fix", () => {
		expect(isUsableFix(BLOCK)).toBe(true);
	});

	it("rejects null island — a zeroed struct, not a location", () => {
		expect(isUsableFix([0, 0])).toBe(false);
	});

	it("rejects NaN, out-of-range, and malformed input", () => {
		expect(isUsableFix([Number.NaN, 45])).toBe(false);
		expect(isUsableFix([-76, 91])).toBe(false);
		expect(isUsableFix([-181, 45])).toBe(false);
		expect(isUsableFix([-76])).toBe(false);
		expect(isUsableFix(null)).toBe(false);
		expect(isUsableFix("-76,45")).toBe(false);
	});
});

describe("fireDiscCentres — blob-scale centres must not become disc-scale fetches", () => {
	/** Two blobs 14 m apart, as the live cache actually held them. */
	const PAIR: LngLat[] = [
		[-89.2294, 48.7902],
		[-89.2295, 48.7903],
	];

	it("collapses a metres-apart pair to ONE disc", () => {
		expect(fireDiscCentres(PAIR)).toEqual([PAIR[0]]);
	});

	it("keeps centres further apart than the trigger", () => {
		const far = north(BLOCK, FIRE_TRIGGER_KM + 10);
		expect(fireDiscCentres([BLOCK, far])).toHaveLength(2);
	});

	it("covers EVERY input centre it dropped — the whole point", () => {
		const cluster = Array.from({ length: 40 }, (_, i) =>
			north(BLOCK, i * 0.01),
		);
		const chosen = fireDiscCentres(cluster);
		expect(chosen.length).toBeLessThan(cluster.length);
		for (const c of cluster)
			expect(needsFireDisc(c, chosen)).toBe(false);
	});

	it("is stable: reducing an already-reduced set changes nothing", () => {
		const once = fireDiscCentres([...PAIR, north(BLOCK, 900)]);
		expect(fireDiscCentres(once)).toEqual(once);
	});

	it("handles an empty list", () => {
		expect(fireDiscCentres([])).toEqual([]);
	});
});

describe("fireCentresWorthFetching — distant maps must not pull discs", () => {
	it("drops ground the user is nowhere near", () => {
		const faraway = north(BLOCK, FIRE_RELEVANCE_KM + 100);
		expect(fireCentresWorthFetching([BLOCK, faraway], [BLOCK])).toEqual([
			BLOCK,
		]);
	});

	it("keeps ground within reach — a day's drive stays covered", () => {
		const nearby = north(BLOCK, FIRE_RELEVANCE_KM - 100);
		expect(
			fireCentresWorthFetching([BLOCK, nearby], [BLOCK]),
		).toHaveLength(2);
	});

	it("an unknown position keeps everything — a GPS outage must not stop fires", () => {
		const spread = [BLOCK, north(BLOCK, 5000), north(BLOCK, 9000)];
		expect(fireCentresWorthFetching(spread, [])).toEqual(spread);
	});

	it("the 21-disc case: many saved maps, user standing in one", () => {
		// Every 400 km up the map, as a well-travelled user's blob list looks.
		const saved = Array.from({ length: 21 }, (_, i) => north(BLOCK, i * 400));
		const worth = fireCentresWorthFetching(saved, [BLOCK]);
		expect(worth.length).toBeLessThan(5);
		expect(worth[0]).toEqual(north(BLOCK, 0));
	});

	it("reduces AFTER filtering to the covering set — the two compose", () => {
		const saved = Array.from({ length: 21 }, (_, i) => north(BLOCK, i * 400));
		const discs = fireDiscCentres(fireCentresWorthFetching(saved, [BLOCK]));
		expect(discs.length).toBeLessThanOrEqual(3);
	});
});
