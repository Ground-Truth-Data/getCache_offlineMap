// A Streets tile served once from R2 is served again from the edge, so an R2 outage only reaches tiles no one near has
// asked for. A new planet under the same key must never be mixed with the old one's cached tiles.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./hospitalsWorld.v1.bin", () => ({ default: new ArrayBuffer(0) }));

const archive = vi.hoisted(() => ({ etag: "v1", reads: 0, empty: false }));
vi.mock("pmtiles", async (real) => ({
  ...(await real<typeof import("pmtiles")>()),
  PMTiles: class {
    getHeader = async () => ({ etag: archive.etag });
    getZxy = async () => {
      archive.reads++;
      return archive.empty ? undefined : { data: new TextEncoder().encode(`tile@${archive.etag}`).buffer };
    };
  },
}));

import worker from "./index";

const edge = new Map<string, Response>();
vi.stubGlobal("caches", {
  default: {
    match: async (r: Request) => edge.get(r.url)?.clone(),
    put: async (r: Request, res: Response) => void edge.set(r.url, res),
  },
});
const env = { TILES: {}, PMTILES_KEY: "planet.pmtiles" } as never;
const ctx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException() {} } as never;
const get = async (path = "/14/4725/5869.pbf") => {
  const res = await worker.fetch(new Request(`https://tiles.test${path}`), env, ctx);
  return { status: res.status, body: await res.text(), acao: res.headers.get("Access-Control-Allow-Origin") };
};

beforeEach(() => {
  edge.clear();
  Object.assign(archive, { etag: "v1", reads: 0, empty: false });
});

describe("Streets tiles at the edge", () => {
  it("reads R2 once for a tile asked twice", async () => {
    expect(await get()).toEqual({ status: 200, body: "tile@v1", acao: "*" });
    expect(await get()).toEqual({ status: 200, body: "tile@v1", acao: "*" });
    expect(archive.reads).toBe(1);
  });

  it("never serves a cached tile from an older planet", async () => {
    await get();
    archive.etag = "v2";
    expect((await get()).body).toBe("tile@v2");
  });

  it("does not keep an empty answer", async () => {
    archive.empty = true;
    expect((await get()).status).toBe(204);
    archive.empty = false;
    expect(await get()).toMatchObject({ status: 200, body: "tile@v1" });
  });
});
