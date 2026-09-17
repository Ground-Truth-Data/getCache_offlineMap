/**
 * fireDials.test.ts — the dials are tunable, but not into a broken layer.
 *
 * These read the REAL modules, not a fixture string: fireOutline.test.ts's
 * zoom-ordering check runs against `const src = ""` and so proves nothing
 * about either map.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	FIRE_CLUSTER_MAX_ZOOM,
	FIRE_CLUSTER_RADIUS,
} from "./fireDials";

const read = (rel: string): string =>
	readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const OFFLINE_LAYER = read("../../lib/onPhone/render/fireLayer.ts");

describe("the dials stay inside what the layer can render", () => {
	it("clumping hands over BELOW the zoom the outline appears at", () => {
		// a counted blob plus a fire's outline on screen together reads as a disaster app
		const outlineMin = Number(
			OFFLINE_LAYER.match(/const OUTLINE_MIN_ZOOM = (\d+);/)?.[1],
		);
		expect(outlineMin).toBeGreaterThan(0);
		expect(FIRE_CLUSTER_MAX_ZOOM).toBeLessThan(outlineMin);
	});

	it("the radius is a usable pixel distance", () => {
		expect(FIRE_CLUSTER_RADIUS).toBeGreaterThan(0);
		expect(FIRE_CLUSTER_RADIUS).toBeLessThanOrEqual(400);
	});

	it("clumping is reachable — a max zoom past the map's own ceiling disables it", () => {
		expect(FIRE_CLUSTER_MAX_ZOOM).toBeGreaterThanOrEqual(0);
		expect(FIRE_CLUSTER_MAX_ZOOM).toBeLessThanOrEqual(22);
	});
});

describe("ONE copy of the dials — the two maps cannot drift", () => {
	it("neither fire layer hardcodes a cluster number", () => {
		const online = read(
			"../../../getCache_OnlineMap/lib/fire/fireLayer.ts",
		);
		for (const [name, src] of [
			["offline", OFFLINE_LAYER],
			["online", online],
		] as const) {
			expect(src, name).toMatch(/clusterRadius: FIRE_CLUSTER_RADIUS/);
			expect(src, name).toMatch(
				/clusterMaxZoom: FIRE_CLUSTER_MAX_ZOOM/,
			);
		}
	});
});
