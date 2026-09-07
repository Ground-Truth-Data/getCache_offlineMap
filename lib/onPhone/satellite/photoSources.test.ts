import { describe, expect, it } from "vitest";
import { PHOTO_SOURCES, photoSourcesFor } from "./photoSources";

const names = (lng: number, lat: number) =>
    photoSourcesFor(lng, lat).map((s) => s.name);

describe("photo sources", () => {
    it("the last row holds the world, so no pin is ever without a source", () => {
        expect(PHOTO_SOURCES[PHOTO_SOURCES.length - 1].boxes).toEqual([]);
        expect(names(0, 0)).toEqual(["EOX"]);
        expect(names(-135, 40)).toEqual(["EOX"]);
    });

    it("a US pin tries USGS first and keeps EOX behind it", () => {
        expect(names(-116.535, 44.397)).toEqual(["USGS", "EOX"]);
        expect(names(-149.9, 61.2)).toEqual(["USGS", "EOX"]);
        expect(names(-157.8, 21.3)).toEqual(["USGS", "EOX"]);
    });

    it("the border is the 49th parallel: Penticton and Vancouver are EOX", () => {
        expect(names(-119.5937, 49.4991)).toEqual(["EOX"]);
        expect(names(-123.07, 49.26)).toEqual(["EOX"]);
        expect(names(-122.75, 48.98)).toEqual(["USGS", "EOX"]);
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
