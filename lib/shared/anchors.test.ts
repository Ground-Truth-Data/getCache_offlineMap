/**
 * anchors.ts is the CANONICAL per-geometry blob rule, read by both the
 * reconcile and the debug array, and it had no test. This pins the parts that
 * are decisions rather than mechanism.
 *
 * The line case is the one that drifted: the step was spaced to the 2 km
 * SATELLITE disc on the one geometry that never bakes a photo, so a real
 * 86 km seismic line took ~28 anchors where 5 cover the same ground.
 */

import { describe, expect, it } from "vitest";
import { anchorsOf, MAX_ANCHORS_PER_FEATURE, type Pt } from "./anchors";
import { GRID_RADIUS_KM } from "../contract/grid";
import { kmBetween } from "./kmGeo";

const feat = (geometry: GeoJSON.Geometry | null) =>
    ({
        geometry: geometry ? ({ geometry } as never) : null,
        overlayBounds: null,
    }) as Parameters<typeof anchorsOf>[0];

const line = (coordinates: Pt[]) =>
    feat({ type: "LineString", coordinates } as GeoJSON.Geometry);

/** The real thing: 86.1 km down the Peace River corridor, 5 vertices. */
const PEACE_RIVER: Pt[] = [
    [-117.24941538588911, 56.90863027895597],
    [-117.18725546792112, 56.730484636590546],
    [-117.17655460903475, 56.51349464599829],
    [-117.21034900149192, 56.32546509490527],
    [-117.3923830619783, 56.168774844499694],
];

describe("a line is sampled along it, spaced to the ROAD disc", () => {
    it("covers 86 km with a handful of anchors, not dozens", () => {
        const got = anchorsOf(line(PEACE_RIVER));
        // 86.1 km at a 48 km step: start, one step, end.
        expect(got.length).toBeLessThanOrEqual(6);
        expect(got.length).toBeGreaterThanOrEqual(3);
    });

    it("keeps consecutive road discs overlapping — a ribbon, never a gap", () => {
        const got = anchorsOf(line(PEACE_RIVER));
        for (let i = 1; i < got.length; i++)
            // 2x the radius is where discs merely TOUCH — a spacing bug passes
            // that. The ribbon rule is 1.6x, so assert what the code claims.
            expect(kmBetween(got[i - 1], got[i])).toBeLessThanOrEqual(
                GRID_RADIUS_KM * 1.6 + 0.001,
            );
    });

    it("always anchors both ends, so neither tip falls outside the ribbon", () => {
        const got = anchorsOf(line(PEACE_RIVER));
        expect(got[0]).toEqual(PEACE_RIVER[0]);
        expect(got[got.length - 1]).toEqual(
            PEACE_RIVER[PEACE_RIVER.length - 1],
        );
    });

    it("gives a short line its two ends and nothing in between", () => {
        // 20 km — well inside one step, so no intermediate anchor is earned.
        expect(anchorsOf(line([PEACE_RIVER[0], PEACE_RIVER[1]]))).toHaveLength(
            2,
        );
    });

    it("samples each part of a MultiLineString at the same step", () => {
        // Guards the flatMap wrapper: passed bare, flatMap hands the INDEX in as
        // the step, and part 1 would be sampled every 1 km.
        const multi = feat({
            type: "MultiLineString",
            coordinates: [PEACE_RIVER, PEACE_RIVER],
        } as GeoJSON.Geometry);
        const one = anchorsOf(line(PEACE_RIVER)).length;
        expect(anchorsOf(multi)).toHaveLength(one * 2);
    });
});

describe("the other geometries keep their own rules", () => {
    it("a point is one blob at the point", () => {
        const p: Pt = [-117.2, 56.5];
        expect(
            anchorsOf(
                feat({ type: "Point", coordinates: p } as GeoJSON.Geometry),
            ),
        ).toEqual([p]);
    });

    it("a polygon is ONE blob at its centroid — a big draw earns no more", () => {
        const big = anchorsOf(
            feat({
                type: "Polygon",
                coordinates: [
                    [
                        [-118, 56],
                        [-116, 56],
                        [-116, 57],
                        [-118, 57],
                        [-118, 56],
                    ],
                ],
            } as GeoJSON.Geometry),
        );
        expect(big).toHaveLength(1);
    });

    it("an overlay is its four corners", () => {
        expect(
            anchorsOf({
                geometry: null,
                overlayBounds: [-118, 56, -116, 57],
            } as Parameters<typeof anchorsOf>[0]),
        ).toHaveLength(4);
    });
});

describe("the ceiling — no import blows the budget", () => {
    /** A degenerate import: a line traced with a vertex every few metres. */
    const dense = (n: number): Pt[] =>
        Array.from({ length: n }, (_, i) => [-117 + i * 0.5, 56] as Pt);

    it("caps a huge line at MAX_ANCHORS_PER_FEATURE", () => {
        expect(anchorsOf(line(dense(4000)))).toHaveLength(
            MAX_ANCHORS_PER_FEATURE,
        );
    });

    it("spreads the cap over the WHOLE line, keeping both ends", () => {
        const pts = dense(4000);
        const got = anchorsOf(line(pts));
        expect(got[0]).toEqual(pts[0]);
        expect(got[got.length - 1]).toEqual(pts[pts.length - 1]);
        // evenly spread, not the first ten: every gap is within a hair of the
        // mean, so no stretch of the line is left with nothing.
        const gaps = got.slice(1).map((p, i) => kmBetween(got[i], p));
        const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        for (const g of gaps) expect(Math.abs(g - mean) / mean).toBeLessThan(0.1);
    });

    it("leaves a line under the ceiling untouched", () => {
        expect(anchorsOf(line(PEACE_RIVER)).length).toBeLessThan(
            MAX_ANCHORS_PER_FEATURE,
        );
    });

    it("caps a MultiPolygon's centroids too — one per part, but never past the ceiling", () => {
        const box = (x: number): Pt[][] => [
            [
                [x, 56],
                [x + 0.1, 56],
                [x + 0.1, 56.1],
                [x, 56.1],
                [x, 56],
            ],
        ];
        const many = Array.from({ length: 40 }, (_, i) => box(-117 + i * 0.3));
        expect(
            anchorsOf(
                feat({
                    type: "MultiPolygon",
                    coordinates: many,
                } as GeoJSON.Geometry),
            ),
        ).toHaveLength(MAX_ANCHORS_PER_FEATURE);
    });
});
