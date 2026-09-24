import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	CELL_DEG,
	INDUSTRIAL_LABEL,
	PERSIST_DAYS,
	buildMask,
	cellKey,
	isStaticSource,
	partitionStatic,
} from "./staticHeatSources";

// A Richmond BC cell detected on 14 distinct days in one season; genuine fires nearby showed 1–4.
const TANK_FARM: [number, number] = [-123.015, 49.0987];
const WILDFIRE: [number, number] = [-121.5, 50.3];

const day = (n: number) => `2026-0${1 + Math.floor(n / 28)}-${String((n % 28) + 1).padStart(2, "0")}`;

describe("buildMask — persistence is what separates a flare from a fire", () => {
	it("flags a cell seen on many distinct days", () => {
		const detections = Array.from({ length: PERSIST_DAYS }, (_, i) => ({
			lng: TANK_FARM[0],
			lat: TANK_FARM[1],
			day: day(i),
		}));
		const mask = buildMask(detections);
		expect(mask.has(cellKey(...TANK_FARM))).toBe(true);
	});

	it("does NOT flag a real fire that burned hard for a few days", () => {
		const detections = Array.from({ length: PERSIST_DAYS - 1 }, (_, i) => ({
			lng: WILDFIRE[0],
			lat: WILDFIRE[1],
			day: day(i),
		}));
		expect(buildMask(detections).size).toBe(0);
	});

	it("counts DISTINCT DAYS, not detections", () => {
		const detections = Array.from({ length: 200 }, () => ({
			lng: WILDFIRE[0],
			lat: WILDFIRE[1],
			day: "2026-07-04",
		}));
		expect(buildMask(detections).size).toBe(0);
	});

	it("keeps unrelated cells independent", () => {
		const detections = [
			...Array.from({ length: PERSIST_DAYS }, (_, i) => ({
				lng: TANK_FARM[0], lat: TANK_FARM[1], day: day(i),
			})),
			...Array.from({ length: 3 }, (_, i) => ({
				lng: WILDFIRE[0], lat: WILDFIRE[1], day: day(i),
			})),
		];
		const mask = buildMask(detections);
		expect(mask.has(cellKey(...TANK_FARM))).toBe(true);
		expect(mask.has(cellKey(...WILDFIRE))).toBe(false);
	});

	it("handles an empty archive without flagging the world", () => {
		expect(buildMask([]).size).toBe(0);
	});
});

describe("isStaticSource — a pixel wanders between passes", () => {
	const mask = new Set([cellKey(...TANK_FARM)]);

	it("matches the exact cell", () => {
		expect(isStaticSource(TANK_FARM[0], TANK_FARM[1], mask)).toBe(true);
	});

	it("matches a NEIGHBOURING cell — the same flare, seen slightly off", () => {
		expect(
			isStaticSource(TANK_FARM[0] + CELL_DEG, TANK_FARM[1] + CELL_DEG, mask),
		).toBe(true);
	});

	it("does NOT match two cells away", () => {
		expect(
			isStaticSource(TANK_FARM[0] + CELL_DEG * 4, TANK_FARM[1], mask),
		).toBe(false);
	});

	it("does not match a genuine fire elsewhere", () => {
		expect(isStaticSource(WILDFIRE[0], WILDFIRE[1], mask)).toBe(false);
	});

	it("flags NOTHING when the mask failed to load", () => {
		expect(isStaticSource(TANK_FARM[0], TANK_FARM[1], new Set())).toBe(false);
	});
});

describe("partitionStatic — FLAG, never DELETE", () => {
	const mask = new Set([cellKey(...TANK_FARM)]);
	const detections = [
		{ coordinates: TANK_FARM },
		{ coordinates: WILDFIRE },
		{ coordinates: [-120.0, 51.0] as [number, number] },
	];

	it("separates industrial from wildfire", () => {
		const { wildfire, industrial } = partitionStatic(detections, mask);
		expect(industrial).toHaveLength(1);
		expect(wildfire).toHaveLength(2);
	});

	it("KEEPS the flagged detection — a refinery can genuinely catch fire", () => {
		const { wildfire, industrial } = partitionStatic(detections, mask);
		expect(wildfire.length + industrial.length).toBe(detections.length);
		expect(industrial[0].coordinates).toEqual(TANK_FARM);
	});

	it("treats everything as wildfire when the mask is empty", () => {
		const { wildfire, industrial } = partitionStatic(detections, new Set());
		expect(wildfire).toHaveLength(3);
		expect(industrial).toHaveLength(0);
	});
});

describe("the label states a fact, it does not apologise", () => {
	it("names what the source IS", () => {
		expect(INDUSTRIAL_LABEL).toBe("Industrial heat source");
		expect(INDUSTRIAL_LABEL.toLowerCase()).not.toContain("maybe");
		expect(INDUSTRIAL_LABEL.toLowerCase()).not.toContain("not a");
	});
});

// TODO: re-point `layer` and `offline` at the fire render layer and the offline route, then unskip.
describe.skip("ONE fire layer, ONE feature builder — no second implementation", () => {
	const layer = "";
	const offline = "";

	it("the shared layer builds features through fireFeatureCollection", () => {
		expect(layer).toContain("fireFeatureCollection(");
	});

	it("the shared layer applies BOTH the industrial flag and the city rule", () => {
		expect(layer).toContain("isStatic:");
		expect(layer).toContain("isUrban:");
	});

	it.skip("the offline route DELEGATES the painting rather than re-implementing it", () => {
		expect(offline).toContain("attachFireLayer");
		expect(offline).not.toMatch(/properties\s*as[^;]*\)\.ageH\s*=/);
		expect(offline).not.toContain("props.ageH =");
	});

	it("the offline route has NO hotspot-count stamp of its own", () => {
		expect(offline).not.toContain("fire-stamp");
		expect(offline).not.toContain("hotspot{");
		expect(offline).not.toContain("fireAgeLabel");
		expect(offline).not.toContain("relevantHotspots(");
		expect(offline).not.toContain("fireFeatureCollection(");
	});

	it("nothing repaints without waiting for the exclusion assets", () => {
		expect(layer).toContain("loadUrban()");
	});
});
