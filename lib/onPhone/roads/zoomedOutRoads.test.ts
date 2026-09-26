import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { keysForAddress } from "./pinTileLookup";
import { BLOB_MIN_Z } from "../../contract/roadBlob";
import { SHALLOW_Z } from "../../contract/grid";
import { RAW_SOURCE, SHALLOW_SOURCE, wallLayers } from "../render/wallStyle";

const PIN = "pin/-117.10620,47.34330";
const Z8 = { z: 8, x: 41, y: 90 };
const Z5 = { z: 5, x: Math.floor(41 / 8), y: Math.floor(90 / 8) };

const stored = [`${PIN}/${Z8.z}/${Z8.x}/${Z8.y}`];

describe("a zoomed-out camera still finds the stored roads", () => {
	it("resolves the EXACT stored address", () => {
		expect(keysForAddress(stored, Z8.z, Z8.x, Z8.y)).toEqual(stored);
	});

	it("resolves an ANCESTOR address — the z5 tile that contains it", () => {
		expect(keysForAddress(stored, Z5.z, Z5.x, Z5.y)).toEqual(stored);
	});

	it("does NOT match a different tile at the same shallow zoom", () => {
		expect(keysForAddress(stored, Z5.z, Z5.x + 1, Z5.y)).toEqual([]);
		expect(keysForAddress(stored, Z5.z, Z5.x, Z5.y + 1)).toEqual([]);
	});

	it("ANSWERS a deeper address with the tile that contains it", () => {
		expect(keysForAddress(stored, 12, Z8.x * 16, Z8.y * 16)).toEqual(stored);
	});

	it("still refuses a deeper address OUTSIDE the stored tile", () => {
		expect(keysForAddress(stored, 12, (Z8.x + 1) * 16, Z8.y * 16)).toEqual([]);
	});

	it("never answers from a stored zoom OUTSIDE the pyramid (foreign/stale data)", () => {
		const stale = `${PIN}/6/${Math.floor(Z8.x / 4)}/${Math.floor(Z8.y / 4)}`;
		expect(keysForAddress([stale], Z8.z, Z8.x, Z8.y)).toEqual([]);
		expect(keysForAddress([stale], 6, Math.floor(Z8.x / 4), Math.floor(Z8.y / 4))).toEqual([]);
	});
});

describe("the SHALLOW tier is painted from its OWN source — never the disc", () => {
	it("wallLayers paints the shallow tier ONLY under the disc's floor", () => {
		const layer = wallLayers().find((l) => l.id === "v4-roads-shallow");
		expect(layer).toBeDefined();
		expect(layer!.source).toBe(SHALLOW_SOURCE);
		expect(layer!.minzoom).toBe(SHALLOW_Z);
		expect(layer!.maxzoom).toBe(BLOB_MIN_Z);
	});

	it("the shallow tier draws NO water — water is the disc's, from WATER_Z only", () => {
		// Read from source: a hard-coded 10 stops testing anything the day the dial moves.
		const src = readFileSync(
			fileURLToPath(new URL("../render/wallStyle.ts", import.meta.url)),
			"utf8",
		);
		const m = /const WATER_Z = (\d+);/.exec(src);
		if (!m) throw new Error("WATER_Z not found in wallStyle.ts — did it get renamed?");
		const WATER_Z = Number(m[1]);
		expect(WATER_Z).toBeGreaterThanOrEqual(BLOB_MIN_Z);

		for (const id of ["v4-water-fill", "v4-water-line"]) {
			const layer = wallLayers().find((l) => l.id === id);
			expect(layer, id).toBeDefined();
			expect(layer!.source, id).toBe(RAW_SOURCE);
			expect(layer!["source-layer"], id).toBe("water");
			expect(layer!.minzoom, id).toBe(WATER_Z);
		}
		const fill = wallLayers().find((l) => l.id === "v4-water-fill")!;
		expect(fill.filter).toEqual(["==", ["geometry-type"], "Polygon"]);
		const line = wallLayers().find((l) => l.id === "v4-water-line")!;
		expect(line.filter).toEqual(["==", ["geometry-type"], "LineString"]);

		const shallowWater = wallLayers().filter(
			(l) =>
				l.source === SHALLOW_SOURCE &&
				(l as { "source-layer"?: string })["source-layer"] === "water",
		);
		expect(shallowWater.map((l) => l.id)).toEqual([]);
		expect(wallLayers().some((l) => /water.*shallow/.test(l.id))).toBe(false);
	});
});
