// The snake ruler grows ONLY by dragging a hand; any tap off its corners
// dismisses it. Tap-to-add has been rebuilt several times by readers who
// took it for the design — this law fails the day it comes back.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./SnakeRuler.svelte", import.meta.url), "utf8");
const handsBranch = src.slice(src.indexOf("// Hands mode grows ONLY by dragging"), src.indexOf('m.on("click", onClick)'));
const hands = handsBranch.slice(handsBranch.lastIndexOf("} else {"));

describe("the snake ruler is drag-only", () => {
    it("finds the hands-mode tap branch", () => {
        expect(hands).toMatch(/discard\(\)/);
    });

    it("never appends a tapped point", () => {
        expect(hands).not.toMatch(/verts\s*=\s*\[\s*\.\.\.verts/);
    });

    it("dismisses on any tap off a corner", () => {
        expect(hands).toMatch(/if \(nearIdx === -1\) discard\(\);/);
    });
});
