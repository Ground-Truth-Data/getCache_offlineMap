// /imports: an import too big to draw as GeoJSON is tiled once on Fly, kept in R2 under its content hash, and fetched whole.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Wrangler bundles the hospital list as Data; vitest cannot parse it.
vi.mock("./hospitalsWorld.v1.bin", () => ({ default: new ArrayBuffer(0) }));

import worker from "./index";

let kept: Map<string, Uint8Array>;
const bucket = {
  head: async (k: string) => (kept.has(k) ? { size: kept.get(k)!.byteLength } : null),
  get: async (k: string) => {
    const v = kept.get(k);
    return v === undefined ? null : { body: v, size: v.byteLength, httpEtag: '"e"' };
  },
  put: async (k: string, v: ArrayBuffer) => void kept.set(k, new Uint8Array(v)),
};
const env = (more = {}) => ({ TILES: bucket, GC_importTiler_url: "https://tiler.test", GC_importTiler_key: "s3cret", ...more }) as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as never;
const call = (path: string, init?: RequestInit, e = env()) => worker.fetch(new Request(`https://tiles.test${path}`, init), e, ctx);
const geojson = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [136.7, -13.97] } }] });
const post = (body = geojson, e = env()) => call("/imports", { method: "POST", body, headers: { "Content-Type": "text/plain" } }, e);
const PMTILES = new Uint8Array([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 3]);

let tiler: ReturnType<typeof vi.fn>;
beforeEach(() => {
  kept = new Map();
  tiler = vi.fn(async () => new Response(PMTILES, { status: 200 }));
  vi.stubGlobal("fetch", tiler);
});
afterEach(() => vi.unstubAllGlobals());

describe("/imports", () => {
  it("tiles a new import on Fly with the key, keeps it under its hash, and names it", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const { name } = (await res.json()) as { name: string };
    expect(name).toMatch(/^imports\/[0-9a-f]{64}\.pmtiles$/);
    expect(tiler).toHaveBeenCalledTimes(1);
    const [url, init] = tiler.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://tiler.test/tile");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer s3cret");
    expect([...kept.keys()]).toEqual([name]);
  });

  it("the same import twice is tiled once", async () => {
    const a = (await (await post()).json()) as { name: string };
    const b = (await (await post()).json()) as { name: string };
    expect(b.name).toBe(a.name);
    expect(tiler).toHaveBeenCalledTimes(1);
  });

  it("serves the kept file whole, immutable, like the highways", async () => {
    const { name } = (await (await post()).json()) as { name: string };
    const res = await call(`/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.pmtiles");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PMTILES);
  });

  it("a tiler failure is a 502 and keeps nothing", async () => {
    tiler.mockResolvedValueOnce(new Response("tippecanoe: bad geometry", { status: 400 }));
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("bad geometry");
    expect(kept.size).toBe(0);
  });

  it("refuses an import over the cap without calling Fly", async () => {
    const res = await post("x".repeat(64 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(tiler).not.toHaveBeenCalled();
  });

  it("without the tiler key it fails loud, never an empty 200", async () => {
    const res = await post(geojson, env({ GC_importTiler_key: "" }));
    expect(res.status).toBe(500);
    expect(tiler).not.toHaveBeenCalled();
  });
});
