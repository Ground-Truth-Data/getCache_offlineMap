// The offline style writes `origin + "/mobileAssets/..."`: a same-origin
// absolute URL is still our bundled glyphs, not a hosted style.

import { describe, expect, it } from "vitest";
// The ONE copy that ships is the online map's, so that is the one tested.
import {
	glyphStack,
	usesBundledGlyphs,
} from "$parent/siblings/getCache_OnlineMap/lib/draw/glyphStack";

const mapWithGlyphs = (glyphs: unknown) =>
    ({ getStyle: () => ({ glyphs }) }) as never;

const BUNDLED = "/mobileAssets/worldBase/glyphs/{fontstack}/{range}.pbf";

describe("usesBundledGlyphs", () => {
    it("recognises the bundled glyphs behind an absolute same-origin URL", () => {
        expect(
            usesBundledGlyphs(
                mapWithGlyphs(`http://getcache.localhost:5173${BUNDLED}`),
            ),
        ).toBe(true);
    });

    it("still recognises them as a bare path", () => {
        expect(usesBundledGlyphs(mapWithGlyphs(BUNDLED))).toBe(true);
    });

    it("does not claim a hosted Mapbox style", () => {
        expect(
            usesBundledGlyphs(
                mapWithGlyphs("mapbox://fonts/mapbox/{fontstack}/{range}.pbf"),
            ),
        ).toBe(false);
    });

    it("treats an unreadable style as online — a font fallback, never a crash", () => {
        expect(usesBundledGlyphs(mapWithGlyphs(undefined))).toBe(false);
        expect(
            usesBundledGlyphs({
                getStyle: () => {
                    throw new Error("style not loaded");
                },
            } as never),
        ).toBe(false);
    });
});

describe("glyphStack", () => {
    it("gives the offline map only the family it actually bundles", () => {
        const m = mapWithGlyphs(`http://getcache.localhost:5173${BUNDLED}`);
        expect(glyphStack(m)).toEqual(["Noto Sans Regular"]);
        // Bold has no bundled variant — asking for one is what 404s.
        expect(glyphStack(m, "bold")).toEqual(["Noto Sans Regular"]);
    });
});
