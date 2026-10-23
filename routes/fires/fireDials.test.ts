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
		expect(OFFLINE_LAYER).not.toMatch(/const\s+\w*OUTLINE_MIN_ZOOM\s*=/);
		expect(OFFLINE_LAYER).toMatch(/minzoom: FIRE_OUTLINE_MIN_ZOOM/);
	});

	it("the outline may sit below the cluster hand-over — the hull is not clustered", () => {
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

describe("ONE copy of the dials — the online map's fireLayer.test.ts checks its half", () => {
	it("the offline fire layer hardcodes no cluster number", () => {
		expect(OFFLINE_LAYER).toMatch(/clusterRadius: FIRE_CLUSTER_RADIUS/);
		expect(OFFLINE_LAYER).toMatch(/clusterMaxZoom: FIRE_CLUSTER_MAX_ZOOM/);
	});
});
