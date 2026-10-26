// /satellite: the shared R2 copy before the source, only a 200 kept, the source's 429 passed on; /squirrel counts it all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Wrangler bundles the hospital list as Data; vitest cannot parse it.
vi.mock("./hospitalsWorld.v1.bin", () => ({ default: new ArrayBuffer(0) }));

import worker from "./index";

let kept: Map<string, ArrayBuffer | string>;
let waits: Promise<unknown>[];
const bucket = {
  get: async (k: string) => {
    const v = kept.get(k);
    return v === undefined ? null : { arrayBuffer: async () => v, text: async () => String(v), json: async () => JSON.parse(String(v)) };
  },
  put: async (k: string, v: ArrayBuffer | string) => void kept.set(k, v),
  list: async ({ prefix }: { prefix: string }) => ({ objects: [...kept.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
};
const env = (more = {}) => ({ GC_mapTiler_key: "k", SAT_CACHE: bucket, ...more }) as never;
const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException() {} } as never;
const call = async (path: string, e = env(), init?: RequestInit) => {
  const res = await worker.fetch(new Request(`https://tiles.test${path}`, init), e, ctx);
  await Promise.all(waits);
  return res;
};
const ask = (source = "maptiler", e = env()) => call(`/satellite/${source}/14/2627/5718.jpg`, e);
const tiles = () => [...kept.keys()].filter((k) => !k.startsWith("_squirrel/"));

beforeEach(async () => {
  kept = new Map();
  waits = [];
  // No edge cache: every ask after the first must come from R2.
  vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => {} } });
  // Counts wait in the isolate; the last test's go out here.
  await call("/squirrel");
  kept = new Map();
});
afterEach(() => vi.unstubAllGlobals());

describe("/satellite through the shared R2 cache", () => {
  it("fetches a miss from the source, keeps it under source/z/x/y, and serves the next ask from R2", async () => {
    const source = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", source);
    const first = await ask();
    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect(tiles()).toEqual(["maptiler/14/2627/5718.jpg"]);
    const second = await ask();
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(second.headers.get("X-Tile-Source")).toBe("maptiler");
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(source).toHaveBeenCalledTimes(1);
    expect(first.headers.get("Access-Control-Expose-Headers")).toContain("X-Cache");
  });

  it("keeps nothing for a source whose cacheToR2 is off, and asks EOX by row then column", async () => {
    const source = vi.fn(async (_u: string) => new Response(new Uint8Array([9]), { status: 200 }));
    vi.stubGlobal("fetch", source);
    expect((await ask("sentinel")).headers.get("X-Cache")).toBe("MISS");
    expect((await ask("sentinel")).headers.get("X-Cache")).toBe("MISS");
    expect(tiles()).toEqual([]);
    expect(source.mock.calls[0][0]).toBe("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/14/5718/2627.jpg");
  });

  it("passes a 429 through with the source's Retry-After and keeps nothing", async () => {
    vi.stubGlobal("fetch", async () => new Response("slow down", { status: 429, headers: { "Retry-After": "30" } }));
    const res = await ask();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
    expect(tiles()).toEqual([]);
  });

  it("says 60 s when the source names no wait, and any other refusal is a 502 kept nowhere", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 429 }));
    expect((await ask()).headers.get("Retry-After")).toBe("60");
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    expect((await ask()).status).toBe(502);
    expect(tiles()).toEqual([]);
  });

  it("refuses a source it does not know, naming the ones it does", async () => {
    const res = await ask("bing");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("maptiler, sentinel");
  });
});

describe("/squirrel", () => {
  it("counts each tile by source, zoom and where it came from, and what R2 holds", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(1000), { status: 200 }));
    await ask();
    await ask();
    await ask("sentinel");
    const { active, counts } = (await (await call("/squirrel")).json()) as { active: string; counts: Record<string, Record<string, number>> };
    expect(active).toBe("maptiler");
    expect(counts.today).toEqual({
      "maptiler|14|upstream": 1,
      "maptiler|14|r2": 1,
      "maptiler|served": 2,
      "maptiler|stored|tiles": 1,
      "maptiler|stored|bytes": 1000,
      "sentinel|14|upstream": 1,
      "sentinel|served": 1,
    });
    expect(counts.month).toEqual(counts.today);
  });

  it("switches the active source, refusing one it does not know", async () => {
    expect((await call("/squirrel/active", env(), { method: "POST", body: "bing" })).status).toBe(400);
    expect((await call("/squirrel/active", env(), { method: "POST", body: "sentinel" })).status).toBe(200);
    expect(await (await call("/squirrel/active")).json()).toEqual({ active: "sentinel" });
  });

  it("serves the default source and no counts on a Worker without the bucket", async () => {
    expect(await (await call("/squirrel", env({ SAT_CACHE: undefined }))).json()).toEqual({ active: "maptiler", counts: null });
  });
});
