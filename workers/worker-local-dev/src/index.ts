import { gunzipSync } from "fflate";
import {
  Compression,
  PMTiles,
  type RangeResponse,
  ResolvedValueCache,
  type Source,
} from "pmtiles";
import {
  DEFAULT_RADIUS_KM,
  fetchFires,
  MAX_RADIUS_KM,
} from "../../../lib/worker/firesWorker";
import { coverOf, DEFAULT_SOURCE, SATELLITE_SOURCES, type SatelliteSource, sourceOf } from "../../../lib/contract/satelliteSources";
import {
  cellKeysForDisc,
  HOSPITAL_MAX_KM,
  HOSPITAL_RADIUS_KM,
  type HospitalEntry,
  hospitalsCollection,
  parseHospitalsPack,
  readCellEntries,
} from "./hospitals";
// The whole world's hospitals ship in the bundle (3.4 MB gzipped); R2 holds roads only.
import hospitalsPack from "./hospitalsWorld.v1.bin";

/** Edge-cache key for /hospitals; bump on every re-bake (bakeHospitals.mjs prints it). */
const HOSPITALS_BUILD = "v1-209173-20260907-cap250";

const SATELLITE_PATH = /^\/satellite\/([a-z0-9-]+)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.jpg$/;

interface Env {
  TILES: R2Bucket;
  /** Satellite tiles every phone shares as `source/z/x/y.jpg`, Squirrel's counts and its source switch; bound on tiles-dev only. */
  SAT_CACHE?: R2Bucket;
  PMTILES_KEY: string;
  /** Worker SECRETs (`wrangler secret put`), never [vars] — they must not reach the app bundle. */
  GC_firms_map_key: string;
  GC_mapTiler_key: string;
  GC_esri_key: string;
}

class R2Source implements Source {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string,
  ) {}

  getKey(): string {
    return this.key;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const object = await this.bucket.get(this.key, {
      range: { offset, length },
    });
    if (object === null) {
      throw new Error(`PMTiles archive not found in R2: ${this.key}`);
    }
    return { data: await object.arrayBuffer(), etag: object.etag };
  }
}

function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const out = gunzipSync(new Uint8Array(buf));
  return Promise.resolve(out.buffer as ArrayBuffer);
}

const decompress = (buf: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> => {
  if (compression === Compression.None || compression === Compression.Unknown) {
    return Promise.resolve(buf);
  }
  if (compression === Compression.Gzip) return gunzip(buf);
  throw new Error(`unsupported PMTiles compression: ${compression}`);
};

// ResolvedValueCache (values, not promises): Workers cannot share promises across
// requests. 64 entries: the planet's leaf directories are huge and more than this
// blows the 128 MB Worker limit (error 1102).
const cache = new ResolvedValueCache(64, undefined, decompress);

const TILE_PATH = /^\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.pbf$/;

// Parsed once per isolate; parsing 11 MB per request is not cheap.
let hospitalsParsed: ReturnType<typeof parseHospitalsPack> | null = null;
function hospitalsIndex(): ReturnType<typeof parseHospitalsPack> {
  hospitalsParsed ??= parseHospitalsPack(hospitalsPack);
  return hospitalsParsed;
}

/** Edge-cache key for /fires; bump whenever a change alters what a correct response
 *  looks like — a TTL expires stale data, never incomplete data. */
const FIRE_ANSWER_VERSION = 3;

// Every X-* response header must be listed here: cross-origin JS reads an
// unexposed header as null, silently. Add new ones at the same time.
const EXPOSED_HEADERS = [
  "X-Fetched-At",
  "X-Sources-Ok",
  "X-Radius-Km",
  "X-Tile-Source",
  "X-Cache",
  "Server-Timing",
  "Retry-After",
].join(", ");

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": EXPOSED_HEADERS,
  "Access-Control-Max-Age": "86400",
};

const SAT_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  "Content-Type": "image/jpeg",
  "Cache-Control": "public, max-age=31536000, immutable",
};

/** The source said no; its status and Retry-After travel on to the phone. */
class UpstreamRefused extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null, message: string) {
    super(message);
  }
}

type Tier = "edge" | "r2" | "upstream";

/** One tile: this colo's edge cache, then the shared R2 copy, then the source. Only a 200 is ever kept. */
async function satelliteTile(env: Env, ctx: ExecutionContext, origin: string, id: string, src: SatelliteSource, z: number, x: number, y: number): Promise<{ body: ArrayBuffer; tier: Tier }> {
  const name = `${id}/${z}/${x}/${y}.jpg`;
  const edge = new Request(`${origin}/satellite/${name}`, { method: "GET" });
  const near = src.live ? undefined : await caches.default.match(edge);
  if (near) return { body: await near.arrayBuffer(), tier: "edge" };
  const bucket = src.cacheToR2 ? env.SAT_CACHE : undefined;
  const kept = await bucket?.get(name);
  if (kept) {
    const body = await kept.arrayBuffer();
    ctx.waitUntil(caches.default.put(edge, new Response(body, { status: 200, headers: SAT_HEADERS })));
    return { body, tier: "r2" };
  }
  const upstream = await fetch(src.tileUrl(src.secret ? env[src.secret] : "", z, x, y));
  if (!upstream.ok) throw new UpstreamRefused(upstream.status, upstream.headers.get("Retry-After"), `${id} responded ${upstream.status} for ${z}/${x}/${y}`);
  const body = await upstream.arrayBuffer();
  if (!src.live) ctx.waitUntil(caches.default.put(edge, new Response(body, { status: 200, headers: SAT_HEADERS })));
  if (bucket) {
    ctx.waitUntil(bucket.put(name, body, { httpMetadata: { contentType: "image/jpeg" } }));
    tally(env, ctx, `${id}|stored|tiles`, 1);
    tally(env, ctx, `${id}|stored|bytes`, body.byteLength);
  }
  return { body, tier: "upstream" };
}

// Squirrel's counts: summed in this isolate, written as one small R2 object per 100 tiles or 30 s,
// so counting costs one write per hundred tiles. A count still in an isolate when it dies is lost.
// Named at first flush: Workers refuse random values at global scope.
let isolate: string | null = null;
let pending: Record<string, number> = {};
let pendingTiles = 0;
let lastFlush = 0;

function tally(env: Env, ctx: ExecutionContext, key: string, n: number): void {
  if (!env.SAT_CACHE) return;
  pending[key] = (pending[key] ?? 0) + n;
  // `served` is a tile's last count; flushing on any earlier one splits a tile across two objects.
  if (!key.endsWith("|served")) return;
  pendingTiles++;
  if (pendingTiles >= 100 || Date.now() - lastFlush > 30_000) ctx.waitUntil(flush(env.SAT_CACHE));
}

async function flush(bucket: R2Bucket): Promise<void> {
  const out = pending;
  pending = {};
  pendingTiles = 0;
  lastFlush = Date.now();
  if (Object.keys(out).length) await bucket.put(`_squirrel/counts/${new Date().toISOString().slice(0, 10)}/${(isolate ??= crypto.randomUUID())}-${lastFlush}.json`, JSON.stringify(out));
}

const ACTIVE_KEY = "_squirrel/active";

async function activeSource(env: Env): Promise<string> {
  const set = await env.SAT_CACHE?.get(ACTIVE_KEY);
  return set ? await set.text() : DEFAULT_SOURCE;
}

/** Every count file under `prefix`, summed into today, this month and all time, per `source|z|tier` key. */
async function squirrelCounts(bucket: R2Bucket, prefix = "_squirrel/counts/"): Promise<Record<"today" | "month" | "all", Record<string, number>>> {
  const today = new Date().toISOString().slice(0, 10);
  const out = { today: {} as Record<string, number>, month: {} as Record<string, number>, all: {} as Record<string, number> };
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    const bodies = await Promise.all(page.objects.map(async (o) => [o.key.split("/")[2], await (await bucket.get(o.key))?.json<Record<string, number>>()] as const));
    for (const [day, counts] of bodies)
      for (const [k, n] of Object.entries(counts ?? {}))
        for (const into of [out.all, ...(day.slice(0, 7) === today.slice(0, 7) ? [out.month] : []), ...(day === today ? [out.today] : [])]) into[k] = (into[k] ?? 0) + n;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

function upstreamOf(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(counts)) if (k.endsWith("|upstream")) out[k.split("|")[0]] = (out[k.split("|")[0]] ?? 0) + n;
  return out;
}

// This month's upstream tiles, re-read from the count files every 5 min; the 10% left over the
// stop covers what a refresh hasn't seen yet and counts lost with a dead isolate.
let spent = { month: "", at: 0, tiles: {} as Record<string, number> };

async function freeTierSpent(env: Env, id: string, src: SatelliteSource): Promise<boolean> {
  if (!src.freeTilesPerMonth) return false;
  // No bucket, no meter: a metered source is refused rather than run blind.
  if (!env.SAT_CACHE) return true;
  const month = new Date().toISOString().slice(0, 7);
  if (spent.month !== month || Date.now() - spent.at > 300_000)
    spent = { month, at: Date.now(), tiles: upstreamOf((await squirrelCounts(env.SAT_CACHE, `_squirrel/counts/${month}`)).month) };
  return (spent.tiles[id] ?? 0) + (upstreamOf(pending)[id] ?? 0) >= 0.9 * src.freeTilesPerMonth;
}

const tileLng = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // /squirrel: which source the photos bake from, and what each one served. A POST of a source id switches it;
    // text/plain, so a browser sends it without a preflight. Only a Worker with the bucket keeps either.
    if (url.pathname === "/squirrel" || url.pathname === "/squirrel/active") {
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
      if (request.method === "POST") {
        const id = (await request.text()).trim();
        if (!env.SAT_CACHE) return json({ error: "this Worker has no bucket to keep a switch in" }, 409);
        if (!sourceOf(id)) return json({ error: `no satellite source "${id}"` }, 400);
        if (sourceOf(id)?.live) return json({ error: `${id} may only be streamed, so photos never bake from it` }, 400);
        await env.SAT_CACHE.put(ACTIVE_KEY, id);
        return json({ active: id });
      }
      const active = await activeSource(env);
      if (url.pathname === "/squirrel/active") return json({ active });
      if (env.SAT_CACHE) await flush(env.SAT_CACHE);
      return json({ active, counts: env.SAT_CACHE ? await squirrelCounts(env.SAT_CACHE) : null });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { ...CORS_HEADERS, Allow: "GET, HEAD, OPTIONS" },
      });
    }

    // /fires: NASA FIRMS hotspots, cached 1 h (worthless at ~6 h) with X-Fetched-At.
    if (url.pathname === "/fires") {
      const lng = Number(url.searchParams.get("lng"));
      const lat = Number(url.searchParams.get("lat"));
      const kmRaw = Number(url.searchParams.get("km"));
      const km = Math.min(
        MAX_RADIUS_KM,
        Number.isFinite(kmRaw) && kmRaw > 0 ? kmRaw : DEFAULT_RADIUS_KM,
      );
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return new Response("Bad Request — expected ?lng=<num>&lat=<num>", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      if (!env.GC_firms_map_key) {
        // Never an empty 200: "no fires near you" is the most dangerous lie this layer can tell.
        return new Response(
          "GC_firms_map_key is not configured on this Worker (wrangler secret put GC_firms_map_key)",
          { status: 500, headers: CORS_HEADERS },
        );
      }

      // Snap the centre to 0.25° so a crew on one block shares one cached slice; immaterial against a 500 km disc.
      const snap = (n: number): string => (Math.round(n * 4) / 4).toFixed(2);
      const cacheUrl = new URL(url.toString());
      // The version is in the KEY so a deploy invalidates the edge instantly; a TTL alone leaves wrong answers cached for hours.
      cacheUrl.search = `?v=${FIRE_ANSWER_VERSION}&lng=${snap(lng)}&lat=${snap(lat)}&km=${km}`;
      const fireCacheKey = new Request(cacheUrl.toString(), { method: "GET" });
      const fireEdge = caches.default;
      const fireHit = await fireEdge.match(fireCacheKey);
      if (fireHit) {
        return request.method === "HEAD"
          ? new Response(null, { status: 200, headers: fireHit.headers })
          : fireHit;
      }

      let body: string;
      let sourcesOk: number;
      let fetchedAt: number;
      try {
        const r = await fetchFires(env.GC_firms_map_key, lng, lat, km);
        body = JSON.stringify(r.collection);
        sourcesOk = r.sourcesOk;
        fetchedAt = r.fetchedAt;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // 502, not an empty 200, so the phone keeps its last good cache.
        return new Response(`Fire fetch failed: ${message}`, {
          status: 502,
          headers: CORS_HEADERS,
        });
      }

      const fireHeaders = {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        // FIRMS refreshes hourly.
        "Cache-Control": "public, max-age=3600",
        "X-Fetched-At": String(fetchedAt),
        "X-Sources-Ok": String(sourcesOk),
        "Access-Control-Expose-Headers": "X-Fetched-At, X-Sources-Ok",
      };
      ctx.waitUntil(
        fireEdge.put(fireCacheKey, new Response(body, { status: 200, headers: fireHeaders })),
      );
      return new Response(request.method === "HEAD" ? null : body, {
        status: 200,
        headers: fireHeaders,
      });
    }

    // /hospitals: world hospitals within km (default 200, max 500), filtered here so the phone never downloads the world's.
    if (url.pathname === "/hospitals") {
      const lng = Number(url.searchParams.get("lng"));
      const lat = Number(url.searchParams.get("lat"));
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return new Response("Bad Request — expected ?lng=<num>&lat=<num>", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const kmRaw = url.searchParams.get("km");
      const km = kmRaw === null ? HOSPITAL_RADIUS_KM : Math.round(Number(kmRaw));
      if (!Number.isFinite(km) || km < 1 || km > HOSPITAL_MAX_KM) {
        return new Response(`Bad Request — km must be 1..${HOSPITAL_MAX_KM}`, {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const snap = (v: number): string => (Math.round(v * 4) / 4).toFixed(2);
      const cacheUrl = new URL(url.toString());
      // km is its own token: a 400 km ask must never be served a 200 km answer.
      cacheUrl.search = `?build=${HOSPITALS_BUILD}&lng=${snap(lng)}&lat=${snap(lat)}&km=${km}`;
      const hospCacheKey = new Request(cacheUrl.toString(), { method: "GET" });
      const hospEdge = caches.default;
      const hospHit = await hospEdge.match(hospCacheKey);
      if (hospHit) {
        return request.method === "HEAD"
          ? new Response(null, { status: 200, headers: hospHit.headers })
          : hospHit;
      }

      let hospBody: string;
      let servedKm = km;
      try {
        const { index, dataOrigin } = hospitalsIndex();
        const cellArrays: HospitalEntry[][] = [];
        for (const k of cellKeysForDisc(lng, lat, index.cellDeg, km)) {
          const span = index.cells[k];
          if (!span) continue;
          cellArrays.push(readCellEntries(hospitalsPack, dataOrigin, span));
        }
        const { fc, radiusKm } = hospitalsCollection(cellArrays, lng, lat, km);
        hospBody = JSON.stringify(fc);
        servedKm = radiusKm;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // 502, never an empty 200 — same law as /fires.
        return new Response(`Hospitals fetch failed: ${message}`, {
          status: 502,
          headers: CORS_HEADERS,
        });
      }

      const hospHeaders = {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        // The radius actually served; the phone stores this, never the number it asked for.
        "X-Radius-Km": String(servedKm),
        "Cache-Control": "public, max-age=31536000, immutable",
      };
      ctx.waitUntil(
        hospEdge.put(
          hospCacheKey,
          new Response(hospBody, { status: 200, headers: hospHeaders }),
        ),
      );
      return new Response(request.method === "HEAD" ? null : hospBody, {
        status: 200,
        headers: hospHeaders,
      });
    }

    // /satellite/{source}/{z}/{x}/{y}.jpg: that source's imagery, its key held here.
    const sat = SATELLITE_PATH.exec(url.pathname);
    if (sat !== null) {
      const [id, z, x, y] = [sat[1], Number(sat[2]), Number(sat[3]), Number(sat[4])];
      const src = sourceOf(id);
      // Fail loud, like /fires: a blank basemap looks merely "not loaded yet".
      if (!src)
        return new Response(`Not Found — no satellite source "${id}"; there are: ${Object.keys(SATELLITE_SOURCES).join(", ")}`, { status: 404, headers: CORS_HEADERS });
      if (src.secret && !env[src.secret])
        return new Response(`${src.secret} is not configured on this Worker (wrangler secret put ${src.secret})`, { status: 500, headers: CORS_HEADERS });
      const span = 2 ** z;
      if (z > src.maxZ || x >= span || y >= span)
        return new Response(`Bad Request — ${id} serves z 0..${src.maxZ} and x,y 0..${span - 1} at z${z}`, { status: 400, headers: CORS_HEADERS });
      // A 404 here lets the map draw what lies under this layer.
      const under = src.live ? coverOf(tileLng(x, z), tileLat(y + 1, z), tileLng(x + 1, z), tileLat(y, z)) : undefined;
      if (under) return new Response(`Not Found — ${under} covers this tile, so ${id} is never asked for it`, { status: 404, headers: CORS_HEADERS });
      if (await freeTierSpent(env, id, src))
        return new Response(`Not Found — ${id} has served 90% of its free tier this month; it stops until the month resets`, { status: 404, headers: CORS_HEADERS });
      let tile: { body: ArrayBuffer; tier: Tier };
      const satStart = performance.now();
      try {
        tile = await satelliteTile(env, ctx, url.origin, id, src, z, x, y);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A 429 stays a 429, so the phone waits it out instead of retrying into it.
        if (err instanceof UpstreamRefused && err.status === 429)
          return new Response(`Satellite fetch failed: ${message}`, {
            status: 429,
            headers: { ...CORS_HEADERS, "Retry-After": err.retryAfter ?? "60" },
          });
        return new Response(`Satellite fetch failed: ${message}`, {
          status: 502,
          headers: CORS_HEADERS,
        });
      }
      tally(env, ctx, `${id}|${z}|${tile.tier}`, 1);
      tally(env, ctx, `${id}|served`, 1);
      return new Response(request.method === "HEAD" ? null : tile.body, {
        status: 200,
        headers: {
          ...SAT_HEADERS,
          "X-Tile-Source": id,
          "X-Cache": tile.tier === "upstream" ? "MISS" : "HIT",
          "Server-Timing": `sat;dur=${(performance.now() - satStart).toFixed(1)}`,
        },
      });
    }

    const match = TILE_PATH.exec(url.pathname);
    if (match === null) {
      return new Response("Not Found — expected /{z}/{x}/{y}.pbf, /satellite/{source}/{z}/{x}/{y}.jpg, /squirrel, /fires?lng=&lat=, or /hospitals?lng=&lat=&km=", {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    const z = Number(match[1]);
    const x = Number(match[2]);
    const y = Number(match[3]);

    const archive = new PMTiles(
      new R2Source(env.TILES, env.PMTILES_KEY),
      cache,
      decompress,
    );

    // A bad archive must be a 502, not a 204.
    const t0 = performance.now();
    try {
      await archive.getHeader();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(
        `Failed to read PMTiles archive ${env.PMTILES_KEY}: ${message}`,
        { status: 502, headers: CORS_HEADERS },
      );
    }

    const t1 = performance.now();
    let tile: RangeResponse | undefined;
    try {
      tile = await archive.getZxy(z, x, y);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(`Tile lookup failed: ${message}`, {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    // 204, not 404, so the renderer overzooms without console noise.
    if (tile === undefined) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const responseHeaders: Record<string, string> = {
      ...CORS_HEADERS,
      "Content-Type": "application/x-protobuf",
        "Cache-Control": "public, max-age=31536000, immutable",
      "Server-Timing": `hdr;dur=${(t1 - t0).toFixed(1)}, tile;dur=${(performance.now() - t1).toFixed(1)}`,
    };

    const body = request.method === "HEAD" ? null : tile.data;
    return new Response(body, { status: 200, headers: responseHeaders });
  },
} satisfies ExportedHandler<Env>;

