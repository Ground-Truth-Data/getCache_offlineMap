// /satellite: the shared R2 copy before the source, only a 200 kept, the source's 429 passed on; /squirrel counts it all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Wrangler bundles the hospital list as Data; vitest cannot parse it.
vi.mock("./hospitalsWorld.v1.bin", () => ({ default: new ArrayBuffer(0) }));

import worker from "./index";

let kept: Map<string, ArrayBuffer | string>;
let waits: Promise<unknown>[];
// The etag is the value itself: a put that names a stale one is refused, as R2 refuses it.
const bucket = {
  get: async (k: string) => {
    const v = kept.get(k);
    return v === undefined ? null : { etag: String(v), arrayBuffer: async () => v, text: async () => String(v), json: async () => JSON.parse(String(v)) };
  },
  put: async (k: string, v: ArrayBuffer | string, o?: { onlyIf?: { etagMatches?: string } | Headers }) => {
    if (o?.onlyIf instanceof Headers) {
      if (o.onlyIf.get("If-None-Match") === "*" && kept.has(k)) return null;
    } else if (o?.onlyIf?.etagMatches !== undefined && String(kept.get(k)) !== o.onlyIf.etagMatches) return null;
    kept.set(k, v);
    return {};
  },
  list: async ({ prefix }: { prefix: string }) => ({ objects: [...kept.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
};
const env = (more = {}) => ({ GC_mapTiler_key: "k", GC_esri_key: "e", PUBLIC_GC_RT_mapbox_token: "m", SAT_CACHE: bucket, METER: bucket, ...more }) as never;
const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException() {} } as never;

// A Supabase access token is header.payload.signature; the Worker reads only `iss`, then asks that project who it is.
const DEV_AUTH = "https://cjqvdoaeymnfoalxforc.supabase.co/auth/v1";
const tokenFrom = (iss: string, who: string) => `h.${btoa(JSON.stringify({ iss })).replace(/=+$/, "")}.${who}`;
const signedIn = (token: string) => ({ Authorization: `Bearer ${token}`, apikey: "anon" });
const CHRIS = signedIn(tokenFrom(DEV_AUTH, "chris"));
const STRANGER = signedIn(tokenFrom(DEV_AUTH, "stranger"));
const USERS: Record<string, { email: string; email_confirmed_at: string }> = {
  chris: { email: "chris@groundtruth.app", email_confirmed_at: "2026-01-01" },
  stranger: { email: "someone@example.com", email_confirmed_at: "2026-01-01" },
};
/** Stubs the sources' fetch; Supabase's /user answers for the token's last segment. */
const stubFetch = (impl: (u: string, i?: RequestInit) => Promise<Response>) =>
  vi.stubGlobal("fetch", async (u: string, i?: RequestInit) => {
    if (!String(u).startsWith(`${DEV_AUTH}/user`)) return impl(u, i);
    const who = new Headers(i?.headers).get("Authorization")?.split(".").pop() ?? "";
    return USERS[who] ? Response.json(USERS[who]) : new Response("invalid JWT", { status: 401 });
  });

/** A POST signs in as Chris unless `init` names its own headers. */
const call = async (path: string, e = env(), init?: RequestInit) => {
  const signed = init?.method === "POST" && !init.headers ? { ...init, headers: CHRIS } : init;
  const res = await worker.fetch(new Request(`https://tiles.test${path}`, signed), e, ctx);
  await Promise.all(waits);
  return res;
};
const ask = (source = "maptiler", e = env()) => call(`/satellite/${source}/14/2627/5718.jpg`, e);
const tiles = () => [...kept.keys()].filter((k) => !k.startsWith("_squirrel/"));
// The free-tier meter re-reads every 5 min and ignores a clock that goes back; every metered test moves this one on.
let clock = Date.now();

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
    stubFetch(source);
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

  it("keeps Sentinel too, asking EOX by row then column", async () => {
    const source = vi.fn(async (_u: string) => new Response(new Uint8Array([9]), { status: 200 }));
    stubFetch(source);
    expect((await ask("sentinel")).headers.get("X-Cache")).toBe("MISS");
    expect((await ask("sentinel")).headers.get("X-Cache")).toBe("HIT");
    expect(tiles()).toEqual(["sentinel/14/2627/5718.jpg"]);
    expect(source.mock.calls[0][0]).toBe("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/14/5718/2627.jpg");
  });

  it("passes a 429 through with the source's Retry-After and keeps nothing", async () => {
    stubFetch(async () => new Response("slow down", { status: 429, headers: { "Retry-After": "30" } }));
    const res = await ask();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
    expect(tiles()).toEqual([]);
  });

  it("says 60 s when the source names no wait, and any other refusal is a 502 kept nowhere", async () => {
    stubFetch(async () => new Response("", { status: 429 }));
    expect((await ask()).headers.get("Retry-After")).toBe("60");
    stubFetch(async () => new Response("", { status: 500 }));
    expect((await ask()).status).toBe(502);
    expect(tiles()).toEqual([]);
  });

  it("refuses a source it does not know, naming the ones it does", async () => {
    const res = await ask("bing");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("maptiler, sentinel");
  });
});

describe("esri: streamed only, and stopped at 90% of its free tier", () => {
  // Ethiopia: nothing covers it but Sentinel.
  const outside = "/satellite/esri/14/9874/7811.jpg";
  let asked: number;
  beforeEach(() => {
    asked = 0;
    stubFetch(async () => (asked++, new Response(new Uint8Array(1000), { status: 200 })));
    // The meter re-reads the counts every 5 min; each test starts past that.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((clock += 6 * 60_000));
  });
  afterEach(() => vi.useRealTimers());
  const month = () => `_squirrel/total/month/${new Date().toISOString().slice(0, 7)}.json`;
  const spentThisMonth = (n: number) => kept.set(month(), JSON.stringify({ "esri|17|upstream": n }));
  const total = (key: string) => JSON.parse(String(kept.get(key)));

  it("reads the month's running total and never lists the bucket, however many tiles it counted", async () => {
    spentThisMonth(1_800_000);
    const list = vi.spyOn(bucket, "list");
    expect((await call(outside)).status).toBe(404);
    expect((await call("/squirrel")).status).toBe(200);
    expect(list).not.toHaveBeenCalled();
    list.mockRestore();
  });

  it("starts a new day's, month's and all-time total at zero and adds each flush to all three", async () => {
    kept.set("_squirrel/total/all.json", JSON.stringify({ "esri|17|upstream": 40 }));
    expect((await call(outside)).status).toBe(200);
    expect(total(month())).toEqual({ "esri|14|upstream": 1, "esri|served": 1 });
    expect(total(`_squirrel/total/day/${new Date().toISOString().slice(0, 10)}.json`)).toEqual(total(month()));
    expect(total("_squirrel/total/all.json")).toEqual({ "esri|17|upstream": 40, "esri|14|upstream": 1, "esri|served": 1 });
  });

  it("adds again when another Worker wrote the total between its read and its write", async () => {
    spentThisMonth(10);
    const put = bucket.put;
    let raced = false;
    vi.spyOn(bucket, "put").mockImplementation(async (k, v, o) => {
      if (k === month() && !raced) (raced = true), kept.set(k, JSON.stringify({ "esri|17|upstream": 20 }));
      return put(k, v, o);
    });
    expect((await call(outside)).status).toBe(200);
    expect(total(month())).toEqual({ "esri|17|upstream": 20, "esri|14|upstream": 1, "esri|served": 1 });
    vi.mocked(bucket.put).mockRestore();
  });

  it("never overwrites a total another Worker created first", async () => {
    const put = bucket.put;
    let raced = false;
    vi.spyOn(bucket, "put").mockImplementation(async (k, v, o) => {
      if (k === month() && !raced) (raced = true), kept.set(k, JSON.stringify({ "esri|17|upstream": 7 }));
      return put(k, v, o);
    });
    expect((await call(outside)).status).toBe(200);
    expect(total(month())).toEqual({ "esri|17|upstream": 7, "esri|14|upstream": 1, "esri|served": 1 });
    vi.mocked(bucket.put).mockRestore();
  });

  it("serves one tile short of the stop, then refuses at 1.8 of its 2 million without asking Esri", async () => {
    spentThisMonth(1_799_999);
    expect((await call(outside)).status).toBe(200);
    expect(asked).toBe(1);
    vi.setSystemTime((clock += 6 * 60_000));
    spentThisMonth(1_800_000);
    const res = await call(outside);
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/90% of its free tier/);
    expect(asked).toBe(1);
  });

  it("is refused outright on a Worker with no bucket to meter it", async () => {
    expect((await call(outside, env({ METER: undefined }))).status).toBe(404);
    expect(asked).toBe(0);
  });

  it("stops prod on what dev spent too: one key, one meter, whatever each Worker caches", async () => {
    const prodTiles = { ...bucket, get: async () => null, put: async () => {}, list: async () => ({ objects: [], truncated: false }) };
    vi.setSystemTime((clock += 6 * 60_000));
    spentThisMonth(1_800_000);
    const res = await call(outside, env({ SAT_CACHE: prodTiles }));
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/90% of its free tier/);
    expect(asked).toBe(0);
  });

  it("is never kept, in R2 or at the edge", async () => {
    const put = vi.fn(async () => {});
    vi.stubGlobal("caches", { default: { match: async () => undefined, put } });
    expect((await call(outside)).status).toBe(200);
    expect(tiles()).toEqual([]);
    expect(put).not.toHaveBeenCalled();
  });

  it("lets the browser hold it a day at most, while a keepable source's tile is held a year", async () => {
    expect((await call(outside)).headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect((await ask("sentinel")).headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect((await ask("usgs")).headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("is never asked for a tile USGS covers", async () => {
    // Seattle.
    expect((await call("/satellite/esri/14/2627/5718.jpg")).status).toBe(404);
    expect(asked).toBe(0);
  });

  it("can never be the source photos bake from", async () => {
    expect((await call("/squirrel/active", env(), { method: "POST", body: "esri" })).status).toBe(400);
  });
});

describe("the cache switch: Squirrel decides what R2 keeps", () => {
  // The switches are re-read each minute; each test starts past that, with none written.
  beforeEach(() => {
    stubFetch(async () => new Response(new Uint8Array([7]), { status: 200 }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((clock += 6 * 60_000));
  });
  afterEach(() => vi.useRealTimers());
  const setCache = (id: string, to: string) => call(`/squirrel/cache/${id}`, env(), { method: "POST", body: to });

  it("follows cacheToR2 until switched, then keeps what the switch says", async () => {
    expect(await (await call("/squirrel/active")).json()).toMatchObject({ cache: { maptiler: true, sentinel: true, usgs: true, esri: false, mapbox: false } });
    expect(await (await setCache("sentinel", "off")).json()).toMatchObject({ cache: { sentinel: false } });
    await ask("sentinel");
    expect(tiles()).toEqual([]);
    await setCache("sentinel", "on");
    await ask("sentinel");
    expect(tiles()).toEqual(["sentinel/14/2627/5718.jpg"]);
    await setCache("maptiler", "off");
    await ask("maptiler");
    expect(tiles()).toEqual(["sentinel/14/2627/5718.jpg"]);
  });

  it("stores what the toggle says, flip by flip, and nothing overrides it", async () => {
    const at = (x: number) => call(`/satellite/maptiler/14/${x}/5718.jpg`);
    expect((await at(1)).headers.get("X-Cache")).toBe("MISS");
    expect((await at(1)).headers.get("X-Cache")).toBe("HIT");
    await setCache("maptiler", "off");
    expect((await at(2)).headers.get("X-Cache")).toBe("MISS");
    expect((await at(2)).headers.get("X-Cache")).toBe("MISS");
    await setCache("maptiler", "on");
    expect((await at(3)).headers.get("X-Cache")).toBe("MISS");
    expect((await at(3)).headers.get("X-Cache")).toBe("HIT");
    expect(tiles()).toEqual(["maptiler/14/1/5718.jpg", "maptiler/14/3/5718.jpg"]);
    expect(await (await call("/squirrel/active")).json()).toMatchObject({ overrides: {} });
  });

  it("has no switch for a source whose licence forbids keeping it", async () => {
    expect((await setCache("esri", "on")).status).toBe(400);
    expect((await setCache("mapbox", "on")).status).toBe(400);
    expect((await setCache("bing", "on")).status).toBe(400);
  });

  it("is refused on a Worker with no bucket", async () => {
    expect((await call("/squirrel/cache/sentinel", env({ SAT_CACHE: undefined }), { method: "POST", body: "on" })).status).toBe(409);
  });
});

describe("mapbox: a standby source, off until Squirrel switches it on", () => {
  // Ethiopia: nothing covers it but Sentinel.
  const outside = "/satellite/mapbox/14/9874/7811.jpg";
  let asked: string[];
  const flip = (to: string) => call("/squirrel/standby/mapbox", env(), { method: "POST", body: to });
  beforeEach(() => {
    asked = [];
    stubFetch(async (u: string) => (asked.push(u), new Response(new Uint8Array(1000), { status: 200 })));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((clock += 6 * 60_000));
  });
  // The switch is remembered in the isolate; leave it off for the tests after.
  afterEach(async () => {
    await flip("off");
    vi.useRealTimers();
  });

  it("is refused while off, without asking Mapbox", async () => {
    const res = await call(outside);
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/standby/);
    expect(asked).toEqual([]);
  });

  it("streams once switched on, kept nowhere, and stops again when switched off", async () => {
    expect(await (await flip("on")).json()).toMatchObject({ standby: ["mapbox"] });
    expect(await (await call("/squirrel/active")).json()).toMatchObject({ standby: ["mapbox"] });
    expect((await call(outside)).status).toBe(200);
    expect(asked[0]).toMatch(/^https:\/\/api\.mapbox\.com\/v4\/mapbox\.satellite\/14\/9874\/7811\.jpg90\?access_token=/);
    expect(tiles()).toEqual([]);
    await flip("off");
    expect((await call(outside)).status).toBe(404);
    expect(asked).toHaveLength(1);
  });

  it("stops at 90% of its 750k free tiles", async () => {
    await flip("on");
    kept.set(`_squirrel/total/month/${new Date().toISOString().slice(0, 7)}.json`, JSON.stringify({ "mapbox|17|upstream": 675_000 }));
    const res = await call(outside);
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/90% of its free tier/);
    expect(asked).toEqual([]);
  });

  it("switches only standby sources, only to on or off", async () => {
    expect((await call("/squirrel/standby/esri", env(), { method: "POST", body: "on" })).status).toBe(400);
    expect((await flip("yes")).status).toBe(400);
    expect((await call("/squirrel/active", env(), { method: "POST", body: "mapbox" })).status).toBe(400);
  });
});

describe("/squirrel", () => {
  it("counts each tile by source, zoom and where it came from, and what R2 holds", async () => {
    stubFetch(async () => new Response(new Uint8Array(1000), { status: 200 }));
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
      "sentinel|stored|tiles": 1,
      "sentinel|stored|bytes": 1000,
    });
    expect(counts.month).toEqual(counts.today);
    expect(counts.all).toEqual(counts.today);
  });

  it("switches the active source, refusing one it does not know", async () => {
    stubFetch(async () => new Response(null, { status: 500 }));
    expect((await call("/squirrel/active", env(), { method: "POST", body: "bing" })).status).toBe(400);
    expect((await call("/squirrel/active", env(), { method: "POST", body: "sentinel" })).status).toBe(200);
    expect(await (await call("/squirrel/active")).json()).toMatchObject({ active: "sentinel", standby: [] });
  });

  it("refuses every switch to anyone but Chris, so nobody else can flip tiles-prod", async () => {
    stubFetch(async () => new Response(null, { status: 500 }));
    const elsewhere = signedIn(tokenFrom("https://evil.supabase.co/auth/v1", "chris"));
    for (const headers of [{}, STRANGER, elsewhere, signedIn("not-a-jwt")]) {
      expect((await call("/squirrel/active", env(), { method: "POST", body: "sentinel", headers })).status).toBe(401);
      expect((await call("/squirrel/cache/sentinel", env(), { method: "POST", body: "on", headers })).status).toBe(401);
      expect((await call("/squirrel/standby/mapbox", env(), { method: "POST", body: "on", headers })).status).toBe(401);
    }
    expect([...kept.keys()].filter((k) => !k.startsWith("_squirrel/total/"))).toEqual([]);
  });

  it("serves the default source and no counts on a Worker without the bucket", async () => {
    expect(await (await call("/squirrel", env({ SAT_CACHE: undefined, METER: undefined }))).json()).toEqual({ active: "maptiler", standby: [], cache: { maptiler: false, sentinel: false, usgs: false, esri: false, mapbox: false },
      overrides: { maptiler: "this Worker has no R2 bucket, so it keeps nothing", sentinel: "this Worker has no R2 bucket, so it keeps nothing", usgs: "this Worker has no R2 bucket, so it keeps nothing" },
      counts: null,
    });
  });
});
