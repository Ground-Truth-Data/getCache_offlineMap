// The ancestor (z5) cases exercise the lookup's depth only: RAW_MIN_Z === BLOB_MIN_Z
// means the protocol is never asked a shallower address.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { keysForAddress } from "./pinTileLookup";
import {
	RAW_MAX_Z,
	RAW_MIN_Z,
	RAW_TILE_URL,
	RAW_SOURCE,
	rawSourceSpec,
	SHALLOW_SOURCE,
	SHALLOW_TILE_URL,
	shallowSourceSpec,
} from "./rawWallProtocol";
import { BLOB_MIN_Z } from "../../contract/roadBlob";
import { SHALLOW_Z } from "../../contract/grid";
import { wallLayers } from "../render/wallStyle";

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

	it("declares a render floor EQUAL to the stored level — no stretched tier below it", () => {
		expect(RAW_MIN_Z).toBe(RAW_MAX_Z);
		expect(RAW_MIN_Z).toBe(BLOB_MIN_Z);
	});
});

describe("the SHALLOW tier is wired to its OWN source — never the disc", () => {
	it("serves rtraw://shallow at EXACTLY SHALLOW_Z — overzoom covers z7, silence below", () => {
		const spec = shallowSourceSpec();
		expect(spec.type).toBe("vector");
		expect(spec.tiles).toEqual([SHALLOW_TILE_URL]);
		expect(spec.minzoom).toBe(SHALLOW_Z);
		expect(spec.maxzoom).toBe(SHALLOW_Z);
	});

	it("the DISC spec is unchanged — still its own URL, still floored at z8", () => {
		const spec = rawSourceSpec();
		expect(spec.tiles).toEqual([RAW_TILE_URL]);
		expect(spec.minzoom).toBe(BLOB_MIN_Z);
		expect(spec.maxzoom).toBe(RAW_MAX_Z);
	});

	it("the two tiers never share a namespace", () => {
		expect(SHALLOW_TILE_URL).not.toBe(RAW_TILE_URL);
		expect(SHALLOW_SOURCE).not.toBe(RAW_SOURCE);
		expect(SHALLOW_Z).toBeLessThan(BLOB_MIN_Z);
	});

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
