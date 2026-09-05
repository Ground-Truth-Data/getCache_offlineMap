import { describe, expect, it } from "vitest";
import { TileByteCache } from "./tileByteCache";

const buf = (n: number): ArrayBuffer => new ArrayBuffer(n);

describe("TileByteCache — merged tile bytes are capped by BYTES, not entries", () => {
    it("evicts the least-recently-used entries once the byte budget is passed", () => {
        const c = new TileByteCache(100);
        c.set("8/1/1", ["a"], buf(40));
        c.set("8/1/2", ["b"], buf(40));
        c.set("8/1/3", ["c"], buf(40)); // 120 > 100 → oldest goes
        expect(c.get("8/1/1")).toBeUndefined();
        expect(c.get("8/1/2")).toBeDefined();
        expect(c.get("8/1/3")).toBeDefined();
        expect(c.bytes).toBe(80);
    });

    it("a hit refreshes recency, so the touched entry survives the next eviction", () => {
        const c = new TileByteCache(100);
        c.set("a", ["a"], buf(40));
        c.set("b", ["b"], buf(40));
        c.get("a");
        c.set("c", ["c"], buf(40));
        expect(c.get("b")).toBeUndefined();
        expect(c.get("a")).toBeDefined();
    });

    it("one entry larger than the whole budget is still kept — the tile on screen must draw", () => {
        const c = new TileByteCache(10);
        c.set("big", ["x"], buf(50));
        expect(c.get("big")).toBeDefined();
        expect(c.size).toBe(1);
    });

    it("re-setting an address replaces its bytes in the tally instead of double counting", () => {
        const c = new TileByteCache(1000);
        c.set("a", ["a"], buf(40));
        c.set("a", ["a", "b"], buf(60));
        expect(c.bytes).toBe(60);
        expect(c.size).toBe(1);
    });

    it("delete and clear give the bytes back", () => {
        const c = new TileByteCache(1000);
        c.set("a", ["a"], buf(40));
        c.set("b", ["b"], buf(40));
        c.delete("a");
        expect(c.bytes).toBe(40);
        c.clear();
        expect(c.bytes).toBe(0);
        expect(c.size).toBe(0);
    });

    it("512 z8 merges of 25 MB never sit on the main thread — the old count cap did that", () => {
        const c = new TileByteCache(48 * 1024 * 1024);
        for (let i = 0; i < 512; i++)
            c.set(`8/${i}/0`, [`p${i}`], buf(25 * 1024 * 1024));
        expect(c.bytes).toBeLessThanOrEqual(48 * 1024 * 1024);
        expect(c.size).toBe(1);
    });
});
