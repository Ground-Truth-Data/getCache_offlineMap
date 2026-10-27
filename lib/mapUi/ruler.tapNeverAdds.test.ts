// A TAP never adds a corner to the snake ruler; a settled hold under the
// loupe does (`add`), and a tap off the shape dismisses it. Tap-to-add has
// been rebuilt several times by readers who took it for the design — this
// law fails the day it comes back.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./SnakeRuler.svelte", import.meta.url), "utf8");
const tapBranch = src.slice(src.indexOf("// Hold mode grows ONLY by a settled hold"), src.indexOf('m.on("click", onClick)'));
const taps = tapBranch.slice(tapBranch.lastIndexOf("} else {"));

describe("a tap never grows the snake ruler", () => {
    it("finds the hold-mode tap branch", () => {
        expect(taps).toMatch(/discard\(\)/);
    });

    it("never appends a tapped point", () => {
        expect(taps).not.toMatch(/verts\s*=\s*\[\s*\.\.\.verts/);
        expect(taps).not.toMatch(/\badd\(/);
    });

    it("a tap on the shape moves its chrome; only a tap off it dismisses", () => {
        expect(taps).toMatch(/if \(tapOnShape\([^)]*\)\) spotBump\+\+;\s*else discard\(\);/);
    });

    it("the settled hold is what grows it", () => {
        expect(src).toMatch(/if \(active\) return add\(ev\.lng, ev\.lat\);/);
    });
});
