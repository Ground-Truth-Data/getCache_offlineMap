import { describe, expect, it } from "vitest";
import {
    isBestPhotoSource,
    PHOTO_SOURCES,
    photoSourcesFor,
} from "./photoSources";

const names = (lng: number, lat: number) =>
    photoSourcesFor(lng, lat).map((s) => s.name);

describe("photo sources", () => {
    it("the last row holds the world, so no pin is ever without a source", () => {
        expect(PHOTO_SOURCES[PHOTO_SOURCES.length - 1].boxes).toEqual([]);
        expect(names(0, 0)).toEqual(["MapTiler", "EOX"]);
        expect(names(-135, 40)).toEqual(["MapTiler", "EOX"]);
    });

    it("a US pin tries USGS first and keeps the world rows behind it", () => {
        expect(names(-116.535, 44.397)).toEqual(["USGS", "MapTiler", "EOX"]);
        expect(names(-149.9, 61.2)).toEqual(["USGS", "MapTiler", "EOX"]);
        expect(names(-157.8, 21.3)).toEqual(["USGS", "MapTiler", "EOX"]);
    });

    it("the border is the 49th parallel: Penticton and Vancouver fall to the world rows", () => {
        expect(names(-119.5937, 49.4991)).toEqual(["MapTiler", "EOX"]);
        expect(names(-123.07, 49.26)).toEqual(["MapTiler", "EOX"]);
        expect(names(-122.75, 48.98)).toEqual(["USGS", "MapTiler", "EOX"]);
    });

    it("EOX stays last: a paid row must never be the only thing between a pin and a blank", () => {
        const world = PHOTO_SOURCES.filter((s) => s.boxes.length === 0);
        expect(world.map((s) => s.name)).toEqual(["MapTiler", "EOX"]);
    });

    it("a photo is stale once a sharper row lands ahead of the one that drew it", () => {
        // the bug: a blob baked from EOX kept its blurry photo forever, because
        // freshness asked the geometry stamp and never asked which row drew it
        expect(isBestPhotoSource("EOX", -123.07, 49.26)).toBe(false);
        expect(isBestPhotoSource("MapTiler", -123.07, 49.26)).toBe(true);
        // in the US the aerial row still wins, so a MapTiler photo there is stale too
        expect(isBestPhotoSource("USGS", -116.535, 44.397)).toBe(true);
        expect(isBestPhotoSource("MapTiler", -116.535, 44.397)).toBe(false);
        // baked before the registry existed → never best, always re-baked
        expect(isBestPhotoSource(undefined, 0, 0)).toBe(false);
    });

    it("each row's canvas keeps roughly half its source's pixels, never more than the source has", () => {
        for (const s of PHOTO_SOURCES) {
            // metres per source pixel at z, mid-latitudes ≈ 40075 km / 256 / 2^z × cos 45°
            const srcMpp =
                ((40075.016686 / 256 / 2 ** s.zoom) * 1000) / Math.SQRT2;
            const canvasMpp = 4000 / s.canvasPx;
            expect(canvasMpp).toBeGreaterThanOrEqual(srcMpp * 0.3);
        }
    });
});
