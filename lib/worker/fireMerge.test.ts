import { describe, expect, it } from "vitest";
import { mergeFires } from "./fireMerge";
import type { FireCollection } from "./firesWorker";

const KM_LAT = 1 / 111.195;
const spot = (lng: number, lat: number, t = 1_000, frp = 1) => ({
	type: "Feature" as const,
	geometry: { type: "Point" as const, coordinates: [lng, lat] as const },
	properties: { t, c: "nominal" as const, frp },
});
const fc = (features: ReturnType<typeof spot>[]): FireCollection => ({ type: "FeatureCollection", features });
const kinds = (out: ReturnType<typeof mergeFires>) => {
	type Feature = (typeof out.collection.features)[number];
	const pts = out.collection.features.filter(
		(f): f is Extract<Feature, { geometry: { type: "Point" } }> => f.geometry.type === "Point",
	);
	return {
		fires: pts.filter((f) => "n" in f.properties),
		hotspots: pts.filter((f) => !("n" in f.properties)),
		outlines: out.collection.features.filter((f) => f.geometry.type === "Polygon"),
	};
};

describe("mergeFires: hotspots within 2 km are one fire", () => {
	it("1.5 km apart is one fire, 2.5 km apart is two", () => {
		expect(kinds(mergeFires(fc([spot(0, 10), spot(0, 10 + 1.5 * KM_LAT)]), 0, 10, 500)).fires).toHaveLength(1);
		expect(kinds(mergeFires(fc([spot(0, 10), spot(0, 10 + 2.5 * KM_LAT)]), 0, 10, 500)).fires).toHaveLength(2);
	});

	it("chains: A–B and B–C under 2 km make one fire even with A–C at 3 km", () => {
		const chain = [spot(0, 10), spot(0, 10 + 1.5 * KM_LAT), spot(0, 10 + 3 * KM_LAT)];
		expect(kinds(mergeFires(fc(chain), 0, 10, 500)).fires).toHaveLength(1);
	});

	it("the fire sits on its hottest real hotspot and carries count, cells, first and last sighting, and passes", () => {
		const out = mergeFires(
			fc([spot(1, 10, 1_000, 5), spot(1, 10 + 0.5 * KM_LAT, 4_000_000, 90), spot(1, 10 + 1 * KM_LAT, 2_000_000, 7)]),
			0,
			10,
			500,
		);
		const [fire] = kinds(out).fires;
		expect(fire.geometry.coordinates).toEqual([1, 10 + 0.5 * KM_LAT]);
		expect(fire.properties).toMatchObject({ n: 3, a: 3, t: 4_000_000, t0: 1_000, frp: 90, f: "1.00000,10.00450" });
		expect(fire.properties.p).toEqual([[0, 5], [1_800_000, 7], [3_600_000, 90]]);
	});
});

describe("mergeFires: the nearest 250 fires, and the radius they reach", () => {
	// 2.5 km apart, so each is its own fire.
	const far = (i: number) => spot(0, 10 + (5 + i * 2.5) * KM_LAT);

	it("sends every fire and the asked radius when there are 250 or fewer", () => {
		const out = mergeFires(fc(Array.from({ length: 250 }, (_, i) => far(i))), 0, 10, 1000);
		expect(kinds(out).fires).toHaveLength(250);
		expect(out.radiusKm).toBe(1000);
	});

	it("keeps the nearest 250 and reports how far they reach", () => {
		const out = mergeFires(fc(Array.from({ length: 300 }, (_, i) => far(299 - i))), 0, 10, 1000);
		const { fires } = kinds(out);
		expect(fires).toHaveLength(250);
		expect(out.radiusKm).toBeCloseTo(5 + 250 * 2.5, 0);
		expect(Math.max(...fires.map((f) => (f.geometry.coordinates[1] - 10) / KM_LAT))).toBeLessThan(out.radiusKm);
	});
});

describe("mergeFires: individual hotspots near the centre, tagged with their fire", () => {
	it("sends each hotspot within 60 km with its fire's id, and none beyond", () => {
		const out = mergeFires(fc([spot(0, 10 + 10 * KM_LAT), spot(0, 10 + 11 * KM_LAT), spot(0, 10 + 80 * KM_LAT)]), 0, 10, 500);
		const { fires, hotspots } = kinds(out);
		expect(hotspots).toHaveLength(2);
		const near = fires.find((f) => f.properties.n === 2)!;
		expect(hotspots.every((h) => h.properties.f === near.properties.f)).toBe(true);
	});

	it("never sends more than the nearest 250", () => {
		const dense = Array.from({ length: 400 }, (_, i) => spot(0, 10 + (i * 0.1 + 1) * KM_LAT));
		const { hotspots } = kinds(mergeFires(fc(dense), 0, 10, 500));
		expect(hotspots).toHaveLength(250);
		expect(Math.max(...hotspots.map((h) => h.geometry.coordinates[1]))).toBeLessThan(10 + 26 * KM_LAT);
	});
});

describe("mergeFires: outlines around the real hotspots", () => {
	it("draws one outline per fire, tagged with its id", () => {
		const blob = [];
		for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) blob.push(spot(2 + x * 0.00375, 10 + y * 0.00375));
		const { fires, outlines } = kinds(mergeFires(fc(blob), 0, 10, 500));
		expect(outlines).toHaveLength(1);
		expect(outlines[0].properties.f).toBe(fires[0].properties.f);
	});
});
