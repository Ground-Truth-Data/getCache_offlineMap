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
	FIRE_OUTLINE_MIN_ZOOM,
} from "./fireDials";

const read = (rel: string): string =>
	readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const OFFLINE_LAYER = read("../../lib/onPhone/render/fireLayer.ts");

describe("the dials stay inside what the layer can render", () => {
	it("the outline zoom is the ONE the layers read — neither declares its own", () => {
		// Two copies of this number is the drift the dials file exists to stop; it
		// was 13 in both maps and would have been changed in one.
		expect(OFFLINE_LAYER).not.toMatch(/const\s+\w*OUTLINE_MIN_ZOOM\s*=/);
		expect(OFFLINE_LAYER).toMatch(/minzoom: FIRE_OUTLINE_MIN_ZOOM/);
	});

	it("the outline may sit below the cluster hand-over — the hull is not clustered", () => {
		// The old rule here demanded outline > clusterMaxZoom, on the belief that a
		// counted bubble inside a hull is a contradiction. It is not: the hull has
		// its own unclustered source and is computed from raw detection
		// coordinates, so it is geography at every zoom. That rule blocked showing
		// the line from regional zoom, which is the only zoom it is useful at.
		expect(OFFLINE_LAYER).toMatch(/outlineSrc, \{ type: "geojson"/);
		expect(OFFLINE_LAYER).not.toMatch(/outlineSrc[\s\S]{0,120}cluster: true/);
	});

	it("the radius is a usable pixel distance", () => {
		expect(FIRE_CLUSTER_RADIUS).toBeGreaterThan(0);
		expect(FIRE_CLUSTER_RADIUS).toBeLessThanOrEqual(400);
	});

	it("the outline zoom is a reachable map zoom", () => {
		expect(FIRE_OUTLINE_MIN_ZOOM).toBeGreaterThanOrEqual(0);
		expect(FIRE_OUTLINE_MIN_ZOOM).toBeLessThanOrEqual(22);
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
