import { describe, expect, it } from "vitest";
import type { HostPlace } from "../../shared/hostPorts";
import { anchorKey, pointPlacesToDraw } from "./placePins";

const point = (lng: number, lat: number, name = "p"): HostPlace => ({
    anchors: [[lng, lat]],
    lastTouched: "2026-01-01T00:00:00Z",
    corridor: false,
    featureKey: `${name}:${lng},${lat}`,
    featureName: name,
    featureType: "Point",
});

describe("pointPlacesToDraw", () => {
    it("draws points only — a corridor or multi-anchor place is a blob footprint, not a pin", () => {
        const line: HostPlace = {
            anchors: [
                [-76.1, 45.0],
                [-76.2, 45.1],
            ],
            lastTouched: "2026-01-01T00:00:00Z",
            corridor: true,
        };
        const polygon: HostPlace = { ...line, corridor: false };
        expect(
            pointPlacesToDraw([line, polygon, point(-76.168, 45.061)]),
        ).toHaveLength(1);
    });
    it("skips a place the page already drew itself, so a session drop is never doubled", () => {
        const skip = new Set([anchorKey(-76.168, 45.061)]);
        expect(
            pointPlacesToDraw(
                [point(-76.168, 45.061), point(-123.1207, 49.2827)],
                skip,
            ),
        ).toEqual([
            {
                lng: -123.1207,
                lat: 49.2827,
                name: "p",
                key: "p:-123.1207,49.2827",
            },
        ]);
    });
    it("draws two places on the same spot once", () => {
        const a = point(-76.168, 45.061, "a");
        const b = point(-76.1680000004, 45.061, "b");
        expect(pointPlacesToDraw([a, b])).toHaveLength(1);
    });
    it("drops a non-finite anchor instead of throwing", () => {
        expect(pointPlacesToDraw([point(Number.NaN, 45)])).toEqual([]);
    });
});
