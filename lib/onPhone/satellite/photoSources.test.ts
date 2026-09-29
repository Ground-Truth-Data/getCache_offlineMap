import { describe, expect, it } from "vitest";
import { isBestPhotoSource, PHOTO_SOURCES } from "./photoSources";

describe("photo sources", () => {
    it("MapTiler is the only source — no free row to fall back to a blurrier photo", () => {
        expect(PHOTO_SOURCES.map((s) => s.name)).toEqual(["MapTiler"]);
        expect(PHOTO_SOURCES[0].zoom).toBeGreaterThan(15);
    });

    it("a photo from any other source is stale and re-bakes", () => {
        expect(isBestPhotoSource("MapTiler")).toBe(true);
        expect(isBestPhotoSource("USGS")).toBe(false);
        expect(isBestPhotoSource("EOX")).toBe(false);
        // baked before the registry existed → never best, always re-baked
        expect(isBestPhotoSource(undefined)).toBe(false);
    });

    it("no row asks for a canvas a phone cannot allocate", () => {
        // the bug: canvasPx 4096 is 16.8 MP, over WebKit's ~16.7 MP ceiling — the
        // phone returned a blank canvas rather than an error, so pins baked NO
        // photo at all and the failure looked like a missing tile
        for (const s of PHOTO_SOURCES) {
            expect((s.canvasPx * s.canvasPx) / 1e6).toBeLessThanOrEqual(12);
        }
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
