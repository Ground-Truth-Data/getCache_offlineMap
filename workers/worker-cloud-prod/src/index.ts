// Keep ./packBuilder.ts + lib/contract/grid.ts in sync with the phone's probe (v4CloudflareTiles.ts `areaTilesPresent`).

import { gunzipSync, gzipSync } from "fflate";
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
import { buildPack } from "./packBuilder";
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
const HOSPITALS_BUILD = "v1-209173-20260907";

/** Edge-cache key; bump whenever the pack contents change or the immutable edge entry masks the deploy. */
const PACK_BUILD = "v35-shallow-z6-built";

/** Edge-cache key for /satellite; bump when the upstream tileset id changes. */
const SATELLITE_BUILD = "satellite-v2";

/** MapTiler's pyramid thins out past this outside cities; the client overzooms instead. */
const SATELLITE_MAX_Z = 20;

const SATELLITE_PATH = /^\/satellite\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.jpg$/;

/** satellite-v2 is already 512px, so @2x 404s — the client declares tileSize 512. */
function satelliteUrl(key: string, z: number, x: number, y: number): string {
  return `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}.jpg?key=${key}`;
}

interface Env {
  TILES: R2Bucket;
  PMTILES_KEY: string;
  PACK_PMTILES_KEY: string;
  /** Worker SECRETs (`wrangler secret put`), never [vars] — they must not reach the app bundle. */
  FIRMS_MAP_KEY: string;
  MAPTILER_KEY: string;
}

interface ReadStats {
  reads: number;
  bytes: number;
}
class R2Source implements Source {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string,
    private readonly stats?: ReadStats,
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
    const data = await object.arrayBuffer();
    if (this.stats) {
      this.stats.reads++;
      this.stats.bytes += data.byteLength;
    }
    return {
      data,
      etag: object.etag,
    };
  }
}

// fflate's sync calls, not DecompressionStream: /pack gunzips ~1000 tiles per
// request and per-tile stream setup took the cold build from ~1 s to ~7 s.
function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const out = gunzipSync(new Uint8Array(buf));
  return Promise.resolve(out.buffer as ArrayBuffer);
}

function gzipBuf(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const out = gzipSync(new Uint8Array(buf));
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
  "X-Pack-Build",
  "X-Pack-Cache",
  "X-Pack-Encoding",
  "X-Diag",
  "X-Fetched-At",
  "X-Sources-Ok",
  "X-Radius-Km",
  "X-Tile-Source",
].join(", ");

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": EXPOSED_HEADERS,
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { ...CORS_HEADERS, Allow: "GET, HEAD, OPTIONS" },
      });
    }

    const url = new URL(request.url);

    // /bench: TEMP diagnostic — does the R2 binding parallelise reads?
    if (url.pathname === "/bench") {
      const n = Math.min(2000, Number(url.searchParams.get("n")) || 500);
      const conc = Math.min(256, Number(url.searchParams.get("conc")) || 100);
      const t0 = Date.now();
      let i = 0;
      let done = 0;
      const run = async (): Promise<void> => {
        while (i < n) {
          const k = i++;
          const obj = await env.TILES.get(env.PACK_PMTILES_KEY, {
            range: { offset: (k * 131072) % 2_000_000_000, length: 32768 },
          });
          if (obj) {
            await obj.arrayBuffer();
            done++;
          }
        }
      };
      await Promise.all(Array.from({ length: conc }, () => run()));
      const ms = Date.now() - t0;
      return new Response(
        `n=${n} conc=${conc} done=${done} totalMs=${ms} perRead=${(ms / n).toFixed(2)}ms`,
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } },
      );
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
      if (!env.FIRMS_MAP_KEY) {
        // Never an empty 200: "no fires near you" is the most dangerous lie this layer can tell.
        return new Response(
          "FIRMS_MAP_KEY is not configured on this Worker (wrangler secret put FIRMS_MAP_KEY)",
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
        const r = await fetchFires(env.FIRMS_MAP_KEY, lng, lat, km);
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

    // /pack: the downloader's one-shot endpoint.
    if (url.pathname === "/pack") {
      const lng = Number(url.searchParams.get("lng"));
      const lat = Number(url.searchParams.get("lat"));
      const corridor = url.searchParams.get("ring") === "corridor";
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return new Response("Bad Request — expected ?lng=<num>&lat=<num>", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      // `*.workers.dev` does not auto-cache, so the Cache API is driven by hand.
      // The build is in the key: entries are immutable for a year, so without it a
      // deploy that changes the pack replays the old bytes and looks like a no-op.
      const keyUrl = new URL(url.toString());
      keyUrl.searchParams.set("build", PACK_BUILD);
      const cacheKey = new Request(keyUrl.toString(), { method: "GET" });
      const edge = caches.default;
      const cached = await edge.match(cacheKey);
      if (cached) {
        const hitHeaders = new Headers(cached.headers);
        hitHeaders.set("X-Pack-Cache", "HIT");
        return new Response(request.method === "HEAD" ? null : cached.body, {
          status: 200,
          headers: hitHeaders,
        });
      }

      const diag: Record<string, number> = {};
      let pack: ArrayBuffer;
      try {
        const stats: ReadStats = { reads: 0, bytes: 0 };
        const tH = Date.now();
        const archive = new PMTiles(
          new R2Source(env.TILES, env.PACK_PMTILES_KEY, stats),
          cache,
          decompress,
        );
        await archive.getHeader();
        const tLoop = Date.now();
        pack = await buildPack(archive, lng, lat, corridor, diag);
        diag.r2Reads = stats.reads;
        diag.r2Bytes = stats.bytes;
        diag.headerMs = tLoop - tH;
        diag.loopMs = Date.now() - tLoop;

        // Gzipped by hand with NO Content-Encoding: advertising it makes Cloudflare's
        // edge compress on top and the browser inflates only one layer.
        pack = await gzipBuf(pack);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(`Pack build failed: ${message}`, {
          status: 502,
          headers: CORS_HEADERS,
        });
      }
      const headers = {
        ...CORS_HEADERS,
        "Content-Type": "application/octet-stream",
        "X-Pack-Encoding": "gzip",
        "X-Pack-Build": PACK_BUILD,
        "X-Diag": `disc=${diag.discTiles} reads=${diag.r2Reads} rbytes=${diag.r2Bytes} headerMs=${diag.headerMs} loopMs=${diag.loopMs} outerKm=${diag.outerKm} cells=${diag.cells} features=${diag.blobFeatures} bytes=${diag.blobBytes} shallowTiles=${diag.shallowTiles} shallowBytes=${diag.shallowBytes}`,
        "X-Pack-Cache": "MISS",
        "Cache-Control": "public, max-age=31536000, immutable",
      };
      ctx.waitUntil(edge.put(cacheKey, new Response(pack, { status: 200, headers })));
      return new Response(request.method === "HEAD" ? null : pack, {
        status: 200,
        headers,
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
      try {
        const { index, dataOrigin } = hospitalsIndex();
        const cellArrays: HospitalEntry[][] = [];
        for (const k of cellKeysForDisc(lng, lat, index.cellDeg, km)) {
          const span = index.cells[k];
          if (!span) continue;
          cellArrays.push(readCellEntries(hospitalsPack, dataOrigin, span));
        }
        hospBody = JSON.stringify(hospitalsCollection(cellArrays, lng, lat, km));
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
        "X-Radius-Km": String(km),
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

    // /satellite/{z}/{x}/{y}.jpg: MapTiler imagery, key held here.
    const sat = SATELLITE_PATH.exec(url.pathname);
    if (sat !== null) {
      const z = Number(sat[1]);
      const x = Number(sat[2]);
      const y = Number(sat[3]);
      if (z > SATELLITE_MAX_Z) {
        return new Response(`Bad Request — z must be 0..${SATELLITE_MAX_Z}`, {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const span = 2 ** z;
      if (x >= span || y >= span) {
        return new Response(`Bad Request — x,y must be 0..${span - 1} at z${z}`, {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      if (!env.MAPTILER_KEY) {
        // Fail loud, like /fires: a blank basemap looks merely "not loaded yet".
        return new Response(
          "MAPTILER_KEY is not configured on this Worker (wrangler secret put MAPTILER_KEY)",
          { status: 500, headers: CORS_HEADERS },
        );
      }

      const satCacheUrl = new URL(url.toString());
      satCacheUrl.search = `?build=${SATELLITE_BUILD}`;
      const satCacheKey = new Request(satCacheUrl.toString(), { method: "GET" });
      const satEdge = caches.default;
      const satHit = await satEdge.match(satCacheKey);
      if (satHit) {
        return request.method === "HEAD"
          ? new Response(null, { status: 200, headers: satHit.headers })
          : satHit;
      }

      let body: ArrayBuffer;
      try {
        const upstream = await fetch(satelliteUrl(env.MAPTILER_KEY, z, x, y));
        if (!upstream.ok) {
          throw new Error(`MapTiler responded ${upstream.status}`);
        }
        body = await upstream.arrayBuffer();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(`Satellite fetch failed: ${message}`, {
          status: 502,
          headers: CORS_HEADERS,
        });
      }

      const satHeaders = {
        ...CORS_HEADERS,
        "Content-Type": "image/jpeg",
        "X-Tile-Source": "maptiler",
        "Cache-Control": "public, max-age=31536000, immutable",
      };
      ctx.waitUntil(
        satEdge.put(satCacheKey, new Response(body, { status: 200, headers: satHeaders })),
      );
      return new Response(request.method === "HEAD" ? null : body, {
        status: 200,
        headers: satHeaders,
      });
    }

    const match = TILE_PATH.exec(url.pathname);
    if (match === null) {
      return new Response("Not Found — expected /{z}/{x}/{y}.pbf, /satellite/{z}/{x}/{y}.jpg, /pack?lng=&lat=, /fires?lng=&lat=, or /hospitals?lng=&lat=&km=", {
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
    try {
      await archive.getHeader();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(
        `Failed to read PMTiles archive ${env.PMTILES_KEY}: ${message}`,
        { status: 502, headers: CORS_HEADERS },
      );
    }

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
      "X-Pack-Cache": "MISS",
        "Cache-Control": "public, max-age=31536000, immutable",
    };

    const body = request.method === "HEAD" ? null : tile.data;
    return new Response(body, { status: 200, headers: responseHeaders });
  },
} satisfies ExportedHandler<Env>;

