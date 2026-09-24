import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as mod from "./fireRelevance";
import {
	distKm,
	fireAnchors,
	fireFeatureCollection,
	HARD_CUTOFF_KM,
	MAX_FIRE_ANCHORS,
	nearestAnchorKm,
	type RelevantHotspot,
	relevantHotspots,
} from "./fireRelevance";
import type { FireHotspot } from "./fireCache";

const spot = (lng: number, lat: number, frp = 100): FireHotspot => ({
	coordinates: [lng, lat],
	t: 1_786_000_000_000,
	c: "nominal",
	frp,
});

const USER: [number, number] = [-123.1, 49.28];
const AT_USER: Array<readonly [number, number]> = [USER];

const WINNIPEG = spot(-97.14, 49.9, 5000);
const BISMARCK = spot(-100.78, 46.81, 5000);
const MINNEAPOLIS = spot(-93.27, 44.98, 5000);
const DES_MOINES = spot(-93.6, 41.6, 5000);
const SQUAMISH = spot(-123.15, 49.7, 5); // ~47 km
const KAMLOOPS = spot(-120.33, 50.67, 40); // ~250 km

describe("THE WALL — nothing past 500 km from the user", () => {
	it("drops every city from the failing screenshot", () => {
		const kept = relevantHotspots(
			[WINNIPEG, BISMARCK, MINNEAPOLIS, DES_MOINES],
			AT_USER,
		);
		expect(kept).toHaveLength(0);
	});

	it("drops them even at an absurd 5000 MW — size never buys past the wall", () => {
		const monster = spot(-97.14, 49.9, 999_999);
		expect(relevantHotspots([monster], AT_USER)).toHaveLength(0);
	});

	it("keeps a fire just inside the wall and drops one just outside", () => {
		const inside = spot(-123.1 + 6.0, 49.28, 5000); // ~435 km
		const outside = spot(-123.1 + 8.0, 49.28, 5000); // ~580 km
		expect(distKm(USER, inside.coordinates)).toBeLessThan(HARD_CUTOFF_KM);
		expect(distKm(USER, outside.coordinates)).toBeGreaterThan(HARD_CUTOFF_KM);
		expect(relevantHotspots([inside, outside], AT_USER)).toHaveLength(1);
	});

	it("the wall is exactly FIRE_RADIUS_KM — we draw only what we download", () => {
		expect(HARD_CUTOFF_KM).toBe(500);
	});
});

describe("near fires are never filtered — small+close beats big+far", () => {
	it("keeps a tiny 5 MW fire 47 km away", () => {
		const kept = relevantHotspots([SQUAMISH], AT_USER);
		expect(kept).toHaveLength(1);
		expect(kept[0].km).toBeLessThan(50);
	});

	it("keeps a moderate fire at 250 km", () => {
		expect(relevantHotspots([KAMLOOPS], AT_USER)).toHaveLength(1);
	});

	it("keeps a tiny fire and a big one at the SAME distance — size is not relevance", () => {
		const farTiny = spot(-118.0, 49.28, 1);
		const farBig = spot(-118.0, 49.28, 400);
		expect(relevantHotspots([farTiny], AT_USER)).toHaveLength(1);
		expect(relevantHotspots([farBig], AT_USER)).toHaveLength(1);
	});
});

// TODO: re-point `layer` at the fire render layer's source and unskip.
describe.skip("NO DISTANCE FADE — a drawn fire is a fire", () => {
	const layer = "";

	it("the module exports no prominence function", () => {
		expect(mod).not.toHaveProperty("prominenceAt");
	});

	it("hotspots carry NO prom — nothing can fade by distance downstream", () => {
		const near = relevantHotspots([SQUAMISH], AT_USER)[0];
		const far = relevantHotspots([KAMLOOPS], AT_USER)[0];
		expect(near).not.toHaveProperty("prom");
		expect(far).not.toHaveProperty("prom");
	});

	it("distance still reaches the CARD — it just doesn't touch paint", () => {
		const far = relevantHotspots([KAMLOOPS], AT_USER)[0];
		expect(far.km).toBeGreaterThan(50);
	});

	it("no paint property multiplies by prom", () => {
		expect(layer).not.toContain('["get", "prom"]');
	});
});

describe("no origin — refuse to guess", () => {
	it("shows NOTHING rather than a continent of dots", () => {
		expect(relevantHotspots([SQUAMISH, WINNIPEG], null)).toHaveLength(0);
	});

	it("treats an EMPTY anchor list the same as none", () => {
		expect(relevantHotspots([SQUAMISH, WINNIPEG], [])).toHaveLength(0);
	});
});

describe("ANCHORS — fires near ground you touched, not just near your body", () => {
	const BLOCK: [number, number] = [-99.6, 52.4];
	/** 30 km from the block, ~1,900 km from the user */
	const NEAR_BLOCK = spot(-99.6, 52.67, 20);

	it("THE BUG: a fire beside your new block is invisible from your fix alone", () => {
		// Must stay true, or the next test becomes vacuous.
		expect(distKm(USER, NEAR_BLOCK.coordinates)).toBeGreaterThan(1500);
		expect(relevantHotspots([NEAR_BLOCK], AT_USER)).toHaveLength(0);
	});

	it("THE FIX: it renders once that block is an anchor", () => {
		const kept = relevantHotspots([NEAR_BLOCK], [USER, BLOCK]);
		expect(kept).toHaveLength(1);
		expect(kept[0].km).toBeLessThan(50);
	});

	it("adding an anchor never hides what the user's fix already showed", () => {
		const withFixOnly = relevantHotspots([SQUAMISH, KAMLOOPS], AT_USER);
		const withBoth = relevantHotspots([SQUAMISH, KAMLOOPS], [USER, BLOCK]);
		expect(withBoth.length).toBeGreaterThanOrEqual(withFixOnly.length);
	});

	it("still refuses the whole continent — the wall holds per anchor", () => {
		// Winnipeg legitimately survives (~350 km from the block); the far cities must not.
		const kept = relevantHotspots(
			[BISMARCK, MINNEAPOLIS, DES_MOINES],
			[USER, BLOCK],
		);
		expect(kept).toHaveLength(0);
	});
});

describe("fireAnchors — bounded, deduped, recency-first", () => {
	const at = (lng: number, lat: number, touchedAt: number) => ({
		at: [lng, lat] as const,
		touchedAt,
	});

	it("keeps the most recently touched ground when over the cap", () => {
		const anchors = fireAnchors([
			at(-123.1, 49.28, 1000),
			at(-99.6, 52.4, 5000), // newest
			at(-113.5, 53.5, 4000),
			at(-106.6, 52.1, 3000),
			at(-97.1, 49.9, 2000),
		]);
		expect(anchors).toHaveLength(MAX_FIRE_ANCHORS);
		expect(anchors[0]).toEqual([-99.6, 52.4]);
	});

	it("collapses anchors whose discs would overlap anyway", () => {
		const anchors = fireAnchors([
			at(-123.1, 49.28, 3000),
			at(-123.2, 49.3, 2000), // ~11 km away
			at(-123.0, 49.2, 1000), // ~11 km away
		]);
		expect(anchors).toHaveLength(1);
	});

	it("keeps genuinely separate ground", () => {
		const anchors = fireAnchors([
			at(-123.1, 49.28, 2000),
			at(-99.6, 52.4, 1000),
		]);
		expect(anchors).toHaveLength(2);
	});

	it("returns nothing for no candidates", () => {
		expect(fireAnchors([])).toHaveLength(0);
	});

	it("ignores candidates with unusable coordinates", () => {
		// A NaN anchor makes every distance NaN and quietly empties the layer.
		const anchors = fireAnchors([
			at(Number.NaN, 49.28, 3000),
			at(-99.6, 52.4, 1000),
		]);
		expect(anchors).toEqual([[-99.6, 52.4]]);
	});
});

describe("nearestAnchorKm", () => {
	it("measures from the closest stake, not the first", () => {
		const BLOCK: [number, number] = [-99.6, 52.4];
		const km = nearestAnchorKm([-99.6, 52.67], [USER, BLOCK]);
		expect(km).toBeLessThan(50);
	});

	it("is Infinity with no anchors", () => {
		expect(nearestAnchorKm([-99.6, 52.67], [])).toBe(Number.POSITIVE_INFINITY);
	});
});

describe("scale — the real cache that produced the screenshot", () => {
	it("cuts a two-disc 42k-hotspot union to only what is near the user", () => {
		const washington = Array.from({ length: 2000 }, (_, i) =>
			spot(-120.7 + (i % 50) * 0.05, 48.0 + Math.floor(i / 50) * 0.05, 50),
		);
		const ottawa = Array.from({ length: 200 }, (_, i) =>
			spot(-76.2 + (i % 20) * 0.05, 45.0 + Math.floor(i / 20) * 0.05, 50),
		);
		const kept = relevantHotspots([...washington, ...ottawa], AT_USER);
		expect(kept.every((h) => h.coordinates[0] < -100)).toBe(true);
		expect(kept.every((h) => h.km < HARD_CUTOFF_KM)).toBe(true);
	});
});

describe("fireFeatureCollection — both maps get identical features", () => {
	const NOW = 1_786_003_600_000; // 1 h after `spot`'s default t

	const toGeoJSON = (
		hs: readonly RelevantHotspot[],
	): GeoJSON.FeatureCollection => ({
		type: "FeatureCollection",
		features: hs.map((h) => ({
			type: "Feature" as const,
			geometry: { type: "Point" as const, coordinates: [...h.coordinates] },
			properties: { t: h.t, frp: h.frp },
		})),
	});
	const never = () => false;

	const build = (
		over: Partial<Parameters<typeof fireFeatureCollection>[0]> = {},
	) =>
		fireFeatureCollection({
			hotspots: [SQUAMISH, KAMLOOPS],
			origin: AT_USER,
			now: NOW,
			staticMask: new Set<string>(),
			toGeoJSON,
			isStatic: never,
			...over,
		});

	it("stamps ageH AND ind on every feature — and NO prom", () => {
		const { fc } = build();
		expect(fc.features.length).toBeGreaterThan(0);
		for (const f of fc.features) {
			const p = f.properties as Record<string, unknown>;
			expect(p.ageH).toBeCloseTo(1, 6);
			expect(p.ind).toBe(0);
			expect(p).not.toHaveProperty("prom");
		}
	});

	it("still enforces the 500 km wall", () => {
		const { fc, shown } = build({ hotspots: [SQUAMISH, WINNIPEG] });
		expect(shown).toHaveLength(1);
		expect(fc.features).toHaveLength(1);
		expect(
			(fc.features[0].geometry as GeoJSON.Point).coordinates[0],
		).toBeCloseTo(-123.15, 2);
	});

	it("FLAGS an industrial source rather than dropping it", () => {
		const { fc } = build({ hotspots: [SQUAMISH], isStatic: () => true });
		expect(fc.features).toHaveLength(1);
		expect((fc.features[0].properties as Record<string, unknown>).ind).toBe(1);
	});

	it("hidden empties the collection without touching the wall logic", () => {
		const { fc, shown } = build({ hidden: true });
		expect(fc.features).toHaveLength(0);
		expect(shown).toHaveLength(0);
		expect(build({ hidden: false }).fc.features.length).toBeGreaterThan(0);
	});

	it("a NEAR and a FAR fire get identical paint properties", () => {
		const { fc } = build({ hotspots: [SQUAMISH, KAMLOOPS] });
		const paintOf = (lng: string) =>
			fc.features
				.filter(
					(f) => (f.geometry as GeoJSON.Point).coordinates[0].toFixed(2) === lng,
				)
				.map((f) => {
					const p = f.properties as Record<string, unknown>;
					return { ageH: p.ageH, ind: p.ind, prom: p.prom };
				})[0];
		const near = paintOf("-123.15");
		const far = paintOf("-120.33");
		expect(near).toEqual(far);
		expect(near.prom).toBeUndefined();
	});
});

// Real VIIRS detections of grass and crop fires sit at 1–10 MW.
describe("a real fire inside the wall RENDERS, however small", () => {
	const SMALL_NEARBY = spot(-73.8, 45.5, 3); // ~175 km
	const BIG_FAR = spot(-80.99, 46.49, 40); // ~380 km
	const OTTAWA: Array<readonly [number, number]> = [[-75.9, 45.35]];

	it("keeps a 3 MW fire 175 km out — small is not the same as irrelevant", () => {
		const kept = relevantHotspots([SMALL_NEARBY], OTTAWA);
		expect(kept).toHaveLength(1);
	});

	it("does not keep only the big distant one", () => {
		const kept = relevantHotspots([SMALL_NEARBY, BIG_FAR], OTTAWA);
		expect(kept).toHaveLength(2);
	});

	it("keeps sub-megawatt detections inside the wall", () => {
		const kept = relevantHotspots([spot(-74.5, 45.6, 0.4)], OTTAWA);
		expect(kept).toHaveLength(1);
	});

	it("the wall is still the ONLY thing that removes a fire", () => {
		const outside = spot(-60, 45.35, 5000);
		expect(relevantHotspots([outside], OTTAWA)).toHaveLength(0);
	});

	it("exports no FRP gate — size must never decide visibility", () => {
		expect(mod).not.toHaveProperty("frpGateAt");
		expect(mod).not.toHaveProperty("MAX_FRP_GATE");
	});
});
