// MapTiler's 429 reaches the phone as a 429 with its Retry-After, never a 502 it would retry into.
import { afterEach, describe, expect, it, vi } from "vitest";
// Wrangler bundles the hospital list as Data; vitest cannot parse it.
vi.mock("./hospitalsWorld.v1.bin", () => ({ default: new ArrayBuffer(0) }));

import worker from "./index";

const env = { GC_mapTiler_key: "k" } as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as never;
const ask = () => worker.fetch(new Request("https://tiles.test/satellite/5/27/15.jpg"), env, ctx);

afterEach(() => vi.unstubAllGlobals());

describe("/satellite when MapTiler refuses", () => {
  it("passes a 429 through with MapTiler's Retry-After, readable cross-origin", async () => {
    vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => {} } });
    vi.stubGlobal("fetch", async () => new Response("slow down", { status: 429, headers: { "Retry-After": "30" } }));
    const res = await ask();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
  });

  it("says 60 s when MapTiler names no wait, and any other refusal stays a 502", async () => {
    vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => {} } });
    vi.stubGlobal("fetch", async () => new Response("", { status: 429 }));
    expect((await ask()).headers.get("Retry-After")).toBe("60");
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    expect((await ask()).status).toBe(502);
  });
});
