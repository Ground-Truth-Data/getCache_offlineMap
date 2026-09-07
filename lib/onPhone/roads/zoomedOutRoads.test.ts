// ⚠️ Roads must draw when the camera is above the stored zoom — keysForAddress must match by real geometric containment, not exact z/x/y string equality, or a zoomed-out camera reads zero roads.
// NOTE: the ANCESTOR (z5) cases below exercise the lookup's depth only — since RAW_MIN_Z === BLOB_MIN_Z the protocol can no longer be asked a shallower address; the branch stays as defense-in-depth.
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

/** A pin near Spokane. */
const PIN = "pin/-117.10620,47.34330";

/** z8 tile containing that pin. */
const Z8 = { z: 8, x: 41, y: 90 };

/** The same ground at z5 — x and y halve once per level climbed. */
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
		// ⛔ this used to assert the OPPOSITE (expected [] on deeper addresses) — that was the bug that left z13-z14 cameras reading nothing from disk.
		expect(keysForAddress(stored, 12, Z8.x * 16, Z8.y * 16)).toEqual(stored);
	});

	it("still refuses a deeper address OUTSIDE the stored tile", () => {
		expect(keysForAddress(stored, 12, (Z8.x + 1) * 16, Z8.y * 16)).toEqual([]);
	});

	it("never answers from a stored zoom OUTSIDE the pyramid (foreign/stale data)", () => {
		// direction1/pv46 left real z6/z7 roads-only tiles in the SAME IndexedDB; containment alone matched them
		// for z8 requests and the merge painted sparse interstates mis-framed and mis-scaled. A foreign zoom answers NOTHING, at any request zoom.
		const stale = `${PIN}/6/${Math.floor(Z8.x / 4)}/${Math.floor(Z8.y / 4)}`;
		expect(keysForAddress([stale], Z8.z, Z8.x, Z8.y)).toEqual([]);
		expect(keysForAddress([stale], 6, Math.floor(Z8.x / 4), Math.floor(Z8.y / 4))).toEqual([]);
	});

	it("declares a render floor EQUAL to the stored level — no stretched tier below it", () => {
		// The zoom<8 distortion is gone BY CONTRACT: the blob never serves a shallower address than it stores; below the floor the world-base (offlineBaseStyle.ts) draws instead.
		expect(RAW_MIN_Z).toBe(RAW_MAX_Z);
		expect(RAW_MIN_Z).toBe(BLOB_MIN_Z);
	});
});

describe("the SHALLOW tier is wired to its OWN source — never the disc", () => {
	// direction2.3: the worker bakes z6 into pv47 and the phone stores it, but
	// until the renderer MOUNTS a second source asking rtraw://shallow, the band
	// z6–z7 stays blank — the wiring gap of 2026-09-02. These tests pin every
	// half of that wiring so it cannot silently regress.
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
		// ⛔ no layer = the 2026-09-02 gap: tiles downloaded, nothing asks for them.
		expect(layer).toBeDefined();
		expect(layer!.source).toBe(SHALLOW_SOURCE);
		expect(layer!.minzoom).toBe(SHALLOW_Z);
		// the handover is exact: this layer ends where the disc's floor begins,
		// so the shallow source is never queried above the band.
		expect(layer!.maxzoom).toBe(BLOB_MIN_Z);
	});

	it("the shallow tier draws NO water — water is the disc's, from WATER_Z only", () => {
		// Chris, 5 Sep 2026: "water only past z10". The z6 tile still CARRIES
		// water (the pack rule rides along unchanged) but nothing paints it any
		// more: v4-water-fill/line-shallow were deleted with "always on". Below
		// WATER_Z the map is highways, major roads and photos. ⛔ READ THE
		// CONSTANT FROM THE SOURCE — a hard-coded 10 stops testing anything the
		// day the dial moves.
		const src = readFileSync(
			fileURLToPath(new URL("../render/wallStyle.ts", import.meta.url)),
			"utf8",
		);
		const m = /const WATER_Z = (\d+);/.exec(src);
		if (!m) throw new Error("WATER_Z not found in wallStyle.ts — did it get renamed?");
		const WATER_Z = Number(m[1]);
		// water lives INSIDE the disc's span, never in the shallow window
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

		// ⛔ no water layer may read the shallow source, under any id — the
		// retired v4-water-*-shallow pair must not creep back in.
		const shallowWater = wallLayers().filter(
			(l) =>
				l.source === SHALLOW_SOURCE &&
				(l as { "source-layer"?: string })["source-layer"] === "water",
		);
		expect(shallowWater.map((l) => l.id)).toEqual([]);
		expect(wallLayers().some((l) => /water.*shallow/.test(l.id))).toBe(false);
	});
});
