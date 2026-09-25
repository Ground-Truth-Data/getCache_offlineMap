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
