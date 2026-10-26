// /satellite: the shared R2 copy before the source, only a 200 kept, and the source's 429 passed on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Wrangler bundles the hospital list as Data; vitest cannot parse it.
vi.mock("./hospitalsWorld.v1.bin", () => ({ default: new ArrayBuffer(0) }));

import worker from "./index";

let kept: Map<string, ArrayBuffer>;
let waits: Promise<unknown>[];
const bucket = {
  get: async (k: string) => (kept.has(k) ? { arrayBuffer: async () => kept.get(k) } : null),
  put: async (k: string, v: ArrayBuffer) => void kept.set(k, v),
};
const env = (more = {}) => ({ GC_mapTiler_key: "k", SATELLITE_SOURCE: "maptiler", SAT_CACHE: bucket, ...more }) as never;
const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException() {} } as never;
const ask = async (e = env()) => {
  const res = await worker.fetch(new Request("https://tiles.test/satellite/17/37965/46928.jpg"), e, ctx);
  await Promise.all(waits);
  return res;
};

beforeEach(() => {
  kept = new Map();
  waits = [];
  // No edge cache: every ask after the first must come from R2.
  vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => {} } });
});
afterEach(() => vi.unstubAllGlobals());

describe("/satellite through the shared R2 cache", () => {
  it("fetches a miss from the source, keeps it under source/z/x/y, and serves the next ask from R2", async () => {
    const source = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", source);
    const first = await ask();
    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect([...kept.keys()]).toEqual(["maptiler/17/37965/46928.jpg"]);
    const second = await ask();
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(second.headers.get("X-Tile-Source")).toBe("maptiler");
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(source).toHaveBeenCalledTimes(1);
    expect(first.headers.get("Access-Control-Expose-Headers")).toContain("X-Cache");
  });

  it("passes a 429 through with the source's Retry-After and keeps nothing", async () => {
    vi.stubGlobal("fetch", async () => new Response("slow down", { status: 429, headers: { "Retry-After": "30" } }));
    const res = await ask();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
    expect(kept.size).toBe(0);
  });

  it("says 60 s when the source names no wait, and any other refusal is a 502 kept nowhere", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 429 }));
    expect((await ask()).headers.get("Retry-After")).toBe("60");
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    expect((await ask()).status).toBe(502);
    expect(kept.size).toBe(0);
  });

  it("refuses loudly when SATELLITE_SOURCE names no source", async () => {
    const res = await ask(env({ SATELLITE_SOURCE: "sentinel" }));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("maptiler");
  });
});
