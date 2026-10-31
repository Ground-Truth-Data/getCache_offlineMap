// A Worker that throws answers with Cloudflare's own 500, which has no CORS header: the browser can't read it, and the
// app sees "AJAXError: Failed to fetch (0)" with no reason. Every answer, a thrown one too, must be readable.
import { describe, expect, it, vi } from "vitest";
// Wrangler bundles the hospital list as Data; vitest cannot parse it.
vi.mock("./hospitalsWorld.v1.bin", () => ({ default: new ArrayBuffer(0) }));

import worker from "./index";

/** R2 refusing every read, as it did with 10043 on tiles-dev. */
const blip = {
  get: async () => {
    throw new Error("get: We encountered an internal error. Please try again. (10043)");
  },
  put: async () => ({}),
  list: async () => ({ objects: [], truncated: false }),
};
const env = { GC_mapTiler_key: "k", SAT_CACHE: blip, METER: blip } as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as never;

describe("a thrown Worker", () => {
  it("still answers a satellite tile with CORS and a status the app can read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await worker.fetch(new Request("https://tiles.test/satellite/maptiler/14/2627/5718.jpg"), env, ctx);
    expect(res.status).toBe(502);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.text()).toContain("10043");
  });
});
