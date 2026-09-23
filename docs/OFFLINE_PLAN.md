# Offline Map — Laws, Rules and Stack

> The rules the offline map (V10, `/app/offlinev10`) must obey, and what it is
> built from. How the route works file by file: [`routes/offlinev10/README.md`](../routes/offlinev10/README.md).

The offline map lets Get Cache work with **no signal**: a downloaded area (a
blob) shows its roads, water and satellite photo over a dark world base,
around the user's own pins — plus the two **safety layers**, fires and
hospitals. It runs on **MapLibre GL**; the online map (`/app/map`) stays on
**Mapbox** (it needs globe, `setTerrain`, `setFog`, `mapbox://` styles). Both
renderers ship.

## ⛔ THE LAWS — obey before you touch anything

**If a change breaks one, the change is wrong — not the law.** The user has
explained these hundreds of times; never make them repeat it.

**LAW 0 — THE MAP NEVER STREAMS.** The map renders **only** from on-device
storage. It never pulls a tile, style or byte from the internet *into the
map*. The flow is one-directional and user-driven: a pin lands, the app
downloads that area into IndexedDB, and the map reads the local copy. Map
sources are always local URLs (`v10://`), never remote — even when handing it
a remote URL would be trivially easy. The dev-only read-through switch is the
one exception, off by default, so airplane mode is what you are testing.

**Tier 1 — what makes it worthwhile (the 5 laws):**
1. **Constant presence** — a blob is visible at every zoom from
   `PLANET_FULL_Z` (z7) to `MAX_Z` and past it by overzoom, inside the same
   outline; it never appears or vanishes at a threshold in that range. Detail
   may thin as you zoom out; the area may not.
2. **Jagged frontier** — the border is the real stair-stepped outline of the
   tiles on disk; never smooth or mask it to a circle. The imperfection is the
   trust signal.
3. **No blink on refine** — the map stays continuously visible through any
   representation change; no one-frame gap, no vector↔raster swap.
4. **Colours are the user's** — never invent or tune a hex; ask.
5. **RAM scales with the SCREEN, not the download.** MapLibre parses only the
   zoom on screen from the stored pyramid; a change that makes RAM grow with
   the number or size of blobs is wrong. Parsed vector tiles cost ~10× their
   on-disk bytes.
   **How to measure it — the panel is not enough.** `performance.memory` is
   main-thread only, and the renderer's Workers hold more than the page. Use
   DevTools → Memory → "Total JS heap size", or the VM-instances list per
   worker. For a growth bug, use Allocation sampling sorted by Self size —
   never a snapshot Summary. Run-to-run variance is ±100–200 MB with no code
   change; repeat the unchanged config before believing an A/B.

**LAW 8 — PACK SIZE IS A PRODUCT DECISION, AND IT IS FIXED.** Offline is an
insurance policy, not the daily-driver map. A planter downloads it once and
mostly never opens it, so a fatter blob is a cost paid by every user on every
download to fix a spike only some of them see. **Do not trade download size
for runtime memory.** If a change makes a blob meaningfully bigger, it is the
wrong change. Overzoom past `MAX_Z` is accepted — it is what makes this law
affordable.

**Tier 2 — process laws:**
6. **Reuse the tool chrome — never rebuild it.** The offline map mounts the
   online map's drawer, eye/crow and scale bar; a new version swaps only the
   base/data layer.
7. **Verify with TESTS, never eyeballs.** A law that matters gets a test that
   fails the build when it's violated.

## The two SAFETY layers — fires and hospitals

| | terrain (roads, water, land, photo) | fires | hospitals |
|---|---|---|---|
| Changes | glacially — a snapshot is fine forever | **hourly** | glacially |
| If stale | harmless | **dangerous** | harmless |
| Refresh | only when the blob is re-downloaded | **its own clock** | its own pass |

**Fires are perishable.** The fire pass (`routes/fires/fireService.ts`) runs
separately from the blob download: a dead fire feed must not stall blobs, and
a slow blob must not suppress a fire refresh. Don't merge the passes.

An **honest age stamp beats an empty map** — a map showing nothing reads as
"no fires near you", the one wrong answer that gets somebody hurt. When the
user opens the app *specifically* to check a fire (`takeFireArrival`), a
cached record is not good enough and the pass forces a fetch.

**Fires are never opt-in** — settled, don't re-litigate. *"You can't turn
them off if there's fires they need to know."* The fires layer starts on;
restraint comes from styling (small, muted, clustered, below the user's
pins), never from hiding them.

**Fires fetch whenever there is signal; the map still never streams.** The
pass caches per blob and the page paints the cache (`attachFireLayer`,
`lib/onPhone/render/fireLayer.ts`). The viewer never fetches — a second
downloader would double-fetch and fight over the same cache entries.

Hospitals live in `routes/hospitals/` on the same pattern: their own pass and
cache, painted by the page, never fetched by it.

## The Stack

```
  the tiles BUCKET            the tiles WORKER                    the PHONE
  ───────────────             ────────────────                    ─────────
  R2 bucket "offline-tiles"   Cloudflare Worker "offline-tiles"    MapLibre GL 5
  one object:                 pmtiles 4.4 + fflate                @protomaps/basemaps 5.7 DARK style
  planet.pmtiles              GET /{z}/{x}/{y}.pbf                IndexedDB, one store keyed "z/x/y"
  (Protomaps v4 planet build) 200 = tile · 204 = empty ocean       custom protocol v10://planet/{z}/{x}/{y}
                              ranged reads, no whole-file fetch    bundled Natural Earth under the blobs
```

Say "the tiles bucket" for the data and "the tiles Worker" for the code.
There is ONE bucket and three deployments of the same Worker:

| tier | URL | what it is |
|---|---|---|
| `worker-cloud-prod` | https://tiles-prod.getcache.org | the Worker on Cloudflare, prod route |
| `worker-cloud-dev` | https://tiles-dev.getcache.org | same Worker, dev route (the default) |
| `worker-local-dev` | http://localhost:8787 | `wrangler dev` on your Mac, real bucket behind it |

Worker source: `workers/worker-cloud-dev/src/index.ts` (the prod and local
folders are its twins — never delete one); bucket binding and routes in
`wrangler.toml` beside it.

| package | version | where | what it is |
|---|---|---|---|
| [maplibre-gl](https://github.com/maplibre/maplibre-gl-js) | 5.24.0 | phone, offline map | the renderer |
| [@protomaps/basemaps](https://github.com/protomaps/basemaps) | 5.7.2 | phone | the DARK style and the planet's tile schema |
| [pmtiles](https://github.com/protomaps/pmtiles) | 4.4.1 | Worker | reads one tile out of `planet.pmtiles` by ranged read |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.2 | Worker | gunzip for tiny tiles |
| [mapbox-gl](https://github.com/mapbox/mapbox-gl-js) | 3.24.0 | phone, online map only | the online renderer |

`planet.pmtiles` is a Protomaps build from https://maps.protomaps.com/builds/,
made from OpenStreetMap. The world base under the blobs is Natural Earth.

## Renderer rules

- **`addProtocol` has three silent contracts.** A miss must throw with
  `status === 404` — a `{data: null}` or zero-byte answer yields a
  loaded-blank tile that blocks parent fallback. Hand back a fresh buffer
  (`slice(0)`), never a cached one — the returned buffer is transferred and
  detached. The MVT bytes must be uncompressed.
- **MapLibre caches 404s** — a tile that missed once is never re-asked. After
  tiles land, call the source's `setTiles([url])`.
- **MapLibre overzooms up, never down:** a source is silently blank below its
  `minzoom`.
- **Don't convert the online map to MapLibre, or this one to Mapbox.**
  `mapboxgl.addProtocol` is `undefined`; calling it is a silent no-op and the
  map renders nothing.
- **Don't put a Mapbox `Marker`/`Popup`/control on the MapLibre map, or vice
  versa** — it throws `_addMarker is not a function` and the map renders
  black, or worse, silently gets the wrong DOM classes. Ask the live instance
  which library built it: `lib/shared/rendererOf.ts`.
- **Every `mapboxgl-*` CSS selector needs its `maplibregl-*` twin** —
  MapLibre emits no `mapboxgl-` classes, so a smoke test passes with the
  controls unstyled.
- **No `geojson` source for tile data** — it re-parses and re-indexes the
  whole dataset on every `setData`, inside the renderer's worker where
  `performance.memory` cannot see it (800–1200 MB once). A handful of
  features (the outline, a highlight) is fine.
- **The satellite is ONE image per blob, never a raster tile pyramid** — a
  pyramid swaps tiles and vanishes below its min zoom.
- **No provider satellite cached for offline.** Esri/Mapbox/Google ToS forbid
  it. Only owned or openly-licensed imagery (USGS, EOX Sentinel-2, OSM).

## Worker rules

- **The build ID is in every edge cache key** — entries are `immutable`, so
  without it a deploy replays old bytes and looks like a no-op.
- Diagnostic headers (build ID, cache HIT/MISS, timing) must be listed in
  `Access-Control-Expose-Headers` or JS never sees them.

## Acceptance tests — the ONLY definition of done

Bytes downloaded, tiles on disk, layers added and features counted are all
proxies. Prove every test red-on-bug.

- **A1 — Roads are visible.** Drop a pin, wait, count road-coloured canvas pixels.
- **A2 — At every zoom.** A1 at z7, z10, z13 and z16 on the same pin.
- **A3 — Around the pin.** The pin's `RADIUS_KM` box is CONTAINED in what
  shipped, all four sides. Centre the camera on the pin, never the data;
  assert containment, never centring. Metres off-centre is the tile grid;
  kilometres is a bug.
- **A4 — Two adjacent pins both draw fully** (overlapping blobs, shared tiles).
- **A5 — Airplane mode.** Download, go offline, hard-reload, roads still draw.
- **A6 — Late arrival.** Drop a pin, don't touch the map; roads appear on
  their own — the cached-404 regression, the most valuable test here.

## Engineering rules

1. **DevTools first** — read live state, never predict it.
2. **Never verify one layer and declare the chain fixed.**
3. **Fail loud. No silent fallbacks** — a read returning null, a swallowing
   catch, a NaN into geometry, a "retry next pass" on a latched guard.
4. **Instrument WHERE, not just HOW MUCH.** Every offline bug was correct
   bytes in the wrong box; report per blob its corners, reach and offset from
   the pin.
5. **A constant the Worker and the phone both depend on lives in one place,
   or a drift test pins the copies together.** Every silent failure here was
   two constants that had to agree, living apart.
6. **Budget the thing the USER does (download a blob), never what the code
   does (issue a request).** A request-counting cap trips in ordinary use.
7. **A spinner needs a watchdog the watched process cannot skip or reset** —
   one-way, capped (~30 s), on the ticker that draws it.
8. **Test on a wiped store.** Old blobs make every reading meaningless. WIPE
   (the blobs dock), download ONE blob, look at everything — tiles, photo,
   rows. Never trust `querySourceFeatures` as proof (it cannot see shape,
   position or leftovers), and never report "verified" until the user has
   looked.
