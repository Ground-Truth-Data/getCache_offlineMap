// Anchors for the shapes the line tests don't reach: a geometry-less feature
// with no overlay, a thinned MultiPoint, every MultiPolygon piece at its
// centroid, a degenerate ring, and a collection at its bounding-box centre.
import { describe, expect, it } from "vitest";
import { anchorsOf, isBlobAnchor, MAX_ANCHORS_PER_FEATURE } from "./anchors";

const f = (geometry: unknown) => ({ geometry: { type: "Feature", properties: {}, geometry } as GeoJSON.Feature, overlayBounds: null });

describe("anchorsOf", () => {
	it("is nothing for a feature with no geometry and no overlay", () => {
		expect(anchorsOf({ geometry: null, overlayBounds: null })).toEqual([]);
		expect(isBlobAnchor({ geometry: null })).toBe(true);
	});

	it("thins a MultiPoint to the cap, ends kept", () => {
		const pts = Array.from({ length: 25 }, (_, i) => [i, 0]);
		const got = anchorsOf(f({ type: "MultiPoint", coordinates: pts }));
		expect(got).toHaveLength(MAX_ANCHORS_PER_FEATURE);
		expect(got[0]).toEqual([0, 0]);
		expect(got.at(-1)).toEqual([24, 0]);
		expect(anchorsOf(f({ type: "MultiPoint", coordinates: [[1, 2]] }))).toEqual([[1, 2]]);
	});

	it("puts one anchor per MultiPolygon piece at its area centroid", () => {
		const square = (x: number) => [[[x, 0], [x + 2, 0], [x + 2, 2], [x, 2], [x, 0]]];
		expect(anchorsOf(f({ type: "MultiPolygon", coordinates: [square(0), square(10)] }))).toEqual([[1, 1], [11, 1]]);
	});

	it("falls back to the vertex mean for a flat ring and the box centre for a short one", () => {
		expect(anchorsOf(f({ type: "Polygon", coordinates: [[[0, 0], [2, 0], [4, 0], [0, 0]]] }))).toEqual([[1.5, 0]]);
		expect(anchorsOf(f({ type: "Polygon", coordinates: [[[0, 0], [4, 2]]] }))).toEqual([[2, 1]]);
		expect(anchorsOf(f({ type: "Polygon", coordinates: [] }))).toEqual([]);
	});

	it("drops non-finite line points and anchors a collection at its box centre", () => {
		expect(anchorsOf(f({ type: "LineString", coordinates: [[Number.NaN, 0]] }))).toEqual([]);
		expect(anchorsOf(f({ type: "GeometryCollection", coordinates: [[0, 0], [[4, 8]]] }))).toEqual([[2, 4]]);
		expect(anchorsOf(f({ type: "GeometryCollection", geometries: [] }))).toEqual([]);
	});
});
