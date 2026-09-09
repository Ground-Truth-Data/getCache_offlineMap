# Offline Map — The Plan (start here)

The single entry point for everything offline. The offline map lets Get Cache
work with **no signal**: a downloaded area shows a satellite photo with roads +
water drawn on it, over a dark **base map**, around the user's own pins/maps —
plus the two **safety layers**, wildfires and hospitals.

**Two kinds of thing live on this map, and they follow different rules:**

| | TERRAIN — roads, water, land, satellite | SAFETY — fires, hospitals |
|---|---|---|
| Changes | glacially; a snapshot is fine forever | fires change **hourly** |
| Stale is | harmless | **dangerous** |
| Governed by | the wall map + the 5 laws | [§ The two SAFETY layers](#the-two-safety-layers--fires-and-hospitals) |

Most of this document is about terrain, because that is where the hard
engineering is. Don't read that as fires being secondary — they are the reason
somebody opens this app on a bad day.

**Engine: MapLibre GL JS**, for THIS ROUTE ONLY. The online map (`/app/map`) stays
on **Mapbox** and must not be converted — it needs Mapbox-only features (globe
projection, `setTerrain`, `setFog`, `mapbox://` styles). Both renderers ship.
Since 6 Sep 2026 the map Get Cache opens is V10 (`OFFLINE_MAP_ROUTE =
/app/offlinev10`, `ReTreever/src/routes/(getcache)/app/offlinev10/`, whole z10
planet tiles, stack doc `../OFFLINE_STACK.md` beside it); the engine this plan
describes stays at `/app/offline`, URL only.

**Why the offline map diverged:** it must hand the renderer tiles read from
local storage. Mapbox's hook for that, `addTileProvider`, is `@experimental
@private` and, for a VECTOR source, runs the provider **inside a Web Worker**
where it cannot read main-thread memory. MapLibre's `addProtocol` is documented,
stable, and runs on the **main thread** — see `lib/onPhone/roads/rawWallProtocol.ts`.

⚠️ **MapLibre is NOT a memory fix.** Both renderers decode a 1536×1536
satellite WebP into the same ~9.44 MB GPU texture. The photo-driven spike is
the number of mounted photos, which no renderer change touches.

`MapDrawControls` and the shared map helpers serve BOTH renderers: each takes a
structural map type, or asks the live instance which library built it
(`lib/shared/rendererOf.ts`). Everything defaults to Mapbox.

## The one-paragraph version

**The offline map is the online map with the network cut.** Same tile format
(MVT), same "load what's on screen, evict what isn't" behaviour. The only
difference is where the tiles come from: online they arrive from Mapbox's
servers; offline they were downloaded earlier, on the user's volition, into
IndexedDB, and the renderer is handed them as it asks. Nothing is held whole in
memory. Every past memory blowup on this route came from breaking that:
something got flattened into one big object and handed across a boundary
instead of staying in tile space. **Tiles or strings across a boundary — never
a parsed object graph.** ([[json-across-worker-boundary-is-the-bug]])

## The Wall Map — the settled technique

A downloaded area renders like **a paper map pinned to a wall**: it is *there*,
constantly, at every zoom — never appears at a threshold, never vanishes, never
blinks. That is what satisfies Law 1 (constant presence). **Call it the "wall
map."** When the user says "the blobs didn't load", they mean the roads + water
drawn over the satellite photo. Same thing.

How a wall map is built (LAW 0 intact — all on the user's volition):

1. **DOWNLOAD.** ONE request to the Worker's `/pack?lng=&lat=` endpoint. The
   Worker reads the area's tiles from the whole-world Protomaps planet
   (`planet.pmtiles`, z0–15) on R2 at `BLOB_DETAIL_LEVEL` (z13), filters each
   tile to the source-layers in `lib/contract/packLayers.ts` (roads · water ·
   places · pois), and merges the 30 km radius around the pin into tiles
   addressed at `BLOB_TILE_Z` (z8) — every cell the radius touches (up to 4,
   `cellsFor`), one request, nothing clipped. The phone writes the raw MVT
   bytes into IndexedDB. This is the *downloader's* network — never the map's.
2. **RENDER, undecoded.** `rawWallProtocol.ts` registers `rtraw://` and hands
   MapLibre the stored bytes untouched. The source declares
   `minzoom = maxzoom = BLOB_TILE_Z`, so MapLibre overzooms the stored tile at
   every deeper level; an address that was never downloaded 404s, which is what draws
   the jagged frontier for free.

**The phone decodes NOTHING.** A decode → GeoJSON → re-cut pipeline once
existed (~2,700 lines, measured 705 MB); deleting it took the route to ~94 MB
at zero extra download. Do NOT re-implement a decode step
([[wall-map-no-decode-raw-tiles]]).

**Single zoom, not a pyramid.** `BLOB_ZOOMS = [BLOB_TILE_Z]` — the archive
holds major roads only at z9/z10, adds minor at z12, thins again by z15, so a
list of levels deletes roads when zooming out. One tile has nothing to disagree
with itself. Changing anything about the pack = bump `PACK_FORMAT_VERSION` in
`packDownload.ts` so devices re-download (the Worker edge-caches by full URL and
that cache survives redeploys).

**The key is the pin.** Roads are stored as
`pin/<lng.5>,<lat.5>/<z>/<x>/<y>` (`grid.ts` `pinTileKey`). A bare `z/x/y`
key let two pins share one square and serve each other's roads. The satellite
never had that bug because it was keyed `${lng},${lat}` from day one —
**key to the thing, not to the grid it happens to sit on.** The contract
(`lib/contract/{grid,blob,geo,roadBlob,packLayers}.ts`) is byte-identical to
`workers/worker-local-dev/src/`; `grid.lockstep.test.ts` fails if they drift. **Change the tile
scheme = change both copies.**

⚠️ **Below `BLOB_TILE_Z` the map is silently blank** — MapLibre overzooms up,
never down. The render floor `RAW_MIN_Z` equals `BLOB_MIN_Z` (direction2 killed the
below-z8 stretch). The disc's floor is covered by the shallow z6 tier
(`SHALLOW_Z` in `grid.ts`, `v4-roads-shallow` in `wallStyle.ts`, its own
`rtraw://shallow` store) — highways, major roads and water only, z6 to z8.
Don't fix it by lowering the constant, and never with a road *picture* at the vector zooms — the deleted road
raster cost ~70 MB/device and drew lines 8× a real road's width
(`purgeRoadRasters.ts` still drops its orphaned databases on boot).

**Reconcile invariant (keep it):** the unmount sweep runs before any
mounting, and every mount is per-area try/caught (`mountSatellite.ts`). One
throwing mount must never abort the pass.

**Features are NOT the viewer's business.** Pins, plots, clusters, draw tools
come from the SAME shared machinery as the online map and must render
identically in offline mode — the offline page does nothing to features except
float draw layers/labels above freshly-mounted photos (`raiseDrawLayers`).

---

## The two SAFETY layers — fires and hospitals

| | wall map (roads, water, land) | fires | hospitals |
|---|---|---|---|
| Changes | glacially — a snapshot is fine forever | **hourly** | glacially |
| If stale | harmless | **dangerous** | harmless |
| Source | Protomaps planet, via R2 | NASA FIRMS, via the fire cache | the `pois` source-layer |
| Refresh | only when the area is re-downloaded | **its own clock** | with the wall map |

**Fires are PERISHABLE.** The bake service's "download once, forever" logic is
correct for a basemap and catastrophic for a hazard layer — so `refreshFires` in
`bakeService.svelte.ts` runs on its own schedule with its own cooldown,
deliberately separate from the photo/tile bake. A NASA outage must not stall
photo bakes, and a slow photo bake must not suppress a fire refresh. Two
tripwire tests pin this; don't merge the passes.

An **honest age stamp beats an empty map** — a map showing nothing reads as "no
fires near you," the one wrong answer that gets somebody hurt. When the user
opens the app *specifically* to check a fire (`takeFireArrival`), a 59-minute-old
cached record is not good enough, so that path forces a fetch.

### Fires are NEVER opt-in — settled, don't re-litigate

Fire shipped behind a toggle once; hotspots downloaded correctly for hours and
were never once seen. The user's ruling: *"you can't turn them off if there's
fires they need to know."* `OPT_IN_LAYERS` is deliberately **empty**. Restraint
comes from *how they are styled* — small, muted, clustered, below the user's own
pins — never from hiding them.

### Fires do not obey LAW 0 the way the basemap does — and that is correct

A stale fire is a lie, so fires are fetched whenever there IS signal, cached
per-area, and rendered from cache when there isn't. The **map** still renders
only on-device bytes; the fetch is the same user-driven downloader path on a
much shorter clock.

⚠️ **The viewer never fetches.** The map renders only on-device bytes and the
`bakeService` owns every download, so the fire layer (`attachFireLayer` in
`lib/onPhone/render/fireLayer.ts`, its ids in `wallLegend.ts`) never fetches —
it paints what the bake stored. A second downloader would double-fetch and
fight over the same cache entries.

`FIRE_REFRESH_ENABLED` (`lib/shared/bakeFlags.ts`) gates `refreshFires`. Fire has
TWO halves (render + fetch/store); a bisect must disable both or it measures
nothing. Every memory number in these docs was taken with fires OFF.

**Fire v2 is written and tested but NOT wired in**, and its Worker route does
not exist yet: [`FIRES.md`](../routes/fires/docs/FIRES.md).
Same lesson as the wall map: v1 held every raw detection on the phone; v2
computes in the Worker and ships something already reduced.

### Hospitals — quiet, and a naming trap

Hospitals are POIs in the wall map's `pois` source-layer, drawn as an icon-only
symbol layer sized to match the online map's marker. No separate source, no
download, no clock — if the area is downloaded, its hospitals came with it.

⚠️ If a hospital doesn't appear, the question is whether the `pois` layer
made it into the pack (`packLayers.ts`), not the online map's hospital
machinery, which this route does not use. Campsites in the same layer
(`v4-poi-camp`, `wallLabels.ts`) are gated to z10+ as decluttering — the one
sanctioned exception to Law 1's no-zoom-band rule.

---

## ⛔ THE LAWS — obey before you touch anything

**If a change breaks one, the change is wrong — not the law.** The user has
explained these hundreds of times; never make them repeat it.

**LAW 0 — THE MAP NEVER STREAMS.** The map renders **only** from on-device
storage. It NEVER pulls a tile, a style, or any byte from the internet *into the
map*. The flow is one-directional and **user-driven**: when the user imports a
file or draws a feature, the app streams that area's data DOWN into IndexedDB,
and the map reads that **local copy**. The map's sources are always local URLs,
never remote. **Even if the rendering tech changes** and it would be trivially
easy to hand the map a remote URL: **DON'T.** ([[offline-map-laws]])

**Tier 1 — what makes it worthwhile (the 5 laws):**
1. **Constant presence** — a downloaded AREA is visible at EVERY zoom; it never appears/disappears at a zoom threshold, and the DATA on disk is never thinned. **Rendering holds back detail at low zoom** — minor roads draw only from `MINOR_ROAD_Z` (z11, `wallStyle.ts`) and only from disc tiles; the shallow wall (z6–8) carries highways, major roads and water, never small roads. Chris set this on 5 Sep 2026 after measuring the tile worker at 1.4 GB with a state's small roads on screen at z6, then 2.3 GB with a carpet of merged discs at z9: a disc tile carries every driveway at full detail whatever its zoom, so with small roads on, RAM scales with the ground on screen. The old reading ("every road at every zoom", and its z7 successor) is retired; do not restore it. Serving the *planet's* pyramid still fails, because its low-zoom tiles DROP the data, not just the drawing.
2. **Jagged frontier** — render the real stair-stepped tile-edge shape; never smooth/mask it to a circle. The imperfection is the trust signal.
3. **No blink on refine** — stays continuously visible through any representation change; no one-frame gap, no vector↔raster swap.
4. **Colours are the user's** — never invent/tune a hex; ask. ([[dont-change-colours-without-permission]])
5. **RAM scales with the SCREEN, not the download.** Held by viewport cull + disk LRU + the low-zoom detail gate in law 1. Parsed vector tiles cost ~10× their on-disk bytes, so a screen full of full-detail cells IS the download in RAM — that was the 800 MB–2 GB defect. The shallow z6 wall is thinned at the SOURCE (highways + major roads + water, `SHALLOW_LAYER_RULES`), so the phone never receives or decodes a province of small roads. The disc is ONE z8 tile overzoomed to every level, so it cannot be thinned per zoom at the source without a second disc tier; below z11 the phone's minzoom gate is the lever.
   **How to measure it — the panel is not enough.** `performance.memory` is **main-thread only**, and on this route the Workers hold more than the page — that is why the 800 MB defect hid for weeks. Use **DevTools → Memory → "Total JS heap size"**, or the VM-instances list per worker. For a growth bug, use **Allocation sampling sorted by Self size** — never a snapshot Summary ([[profile-allocation-not-snapshot-summary]]).
   **Run-to-run variance is ±100–200 MB with no code change.** Repeat the unchanged config at least once before believing an A/B.

**LAW 8 — PACK SIZE IS A PRODUCT DECISION, AND IT IS FIXED.** Offline is an
INSURANCE POLICY, not the daily-driver map. A planter downloads it once and
mostly never opens it, so a fatter pack is a real cost paid by every user on
every download to fix a memory spike only some of them ever see. **Do not trade
download size for runtime memory.** If a change makes the pack meaningfully
bigger, it is the wrong change — go find another one.

**Overzoom is ACCEPTED, and it is what makes law 8 affordable.** The wall map
does not need a tile at every zoom; MapLibre stretching a z13 tile across
z14–z16 is fine and looks fine. Jumping between layers is allowed.

**Tier 2 — process laws:**
6. **Reuse the tool chrome — NEVER rebuild it.** A new offline version = duplicate the route + keep the same component imports + swap ONLY the base/data layer. ([[offline-reuse-tool-chrome-never-rebuild]])
7. **Verify with TESTS, never eyeballs.** A law that matters gets a test that fails the build when it's violated.

---

## The three layers

"Layer" here means a **sourcing tier** (where bytes come from), not a map layer.
The safety layers cut across all three tiers and are governed above.

| # | Layer | What it is | Status |
|---|-------|-----------|--------|
| **1** | **On-phone baked satellite + registry** | One masked satellite photo per area, baked on the phone (EOX), stored in IndexedDB, tracked by a coverage registry that drives dedup / budget / reconcile. `lib/onPhone/satellite/`, `lib/onPhone/store/coverageRegistry.ts`. | **Shipping** |
| **2** | **Cloud globe basemap (wall map)** | The planet's OSM vector tiles as one Protomaps `.pmtiles` on R2; the Worker packs the area's slice; the phone stores it and serves it locally (LAW 0). The roads/water you see. | **Shipping — THE offline map** |
| **3** | **Cloud bake + supplement** | Bake each area once in the cloud, a central registry so nothing is built/sent twice, better-than-default data per area. | **Vision — design only** |

Layers 1 and 2 ship as ONE route, `/app/offline`. The blob debug panel
(`OfflineBlobPanel`) inspects on-device storage.

---

## Layer 1 — on-phone baked satellite + registry

### The satellite = ONE masked photo — non-negotiable

- A downloaded region is shown at a **fixed level of detail — the SAME picture
  at every zoom.** We do NOT swap in sharper tiles as you zoom.
- **Bake ONCE from the FINE tiles** → composite into ONE image. The transparent
  gaps where tiles don't exist **ARE** the jagged mask; the photo's own alpha is
  the mask.
- Render as a **single `image` source** (NOT a raster tile source). An image
  source has no min/max zoom → present and identical at every zoom, only
  changing size; it goes soft past bake resolution (ACCEPTED).
- ❌ NEVER a raster tile pyramid for the satellite — swaps tiles + vanishes
  below its min zoom.

### Reconcile — the self-healing guarantee

**The reconcile lives in `lib/onPhone/bake/bakeService.svelte.ts`.** Until
6 Sep 2026 the Get Cache layout started it app-wide; since then the layout
starts V10's `blobService` instead, and `OfflineMapPage.svelte` starts this
service on mount, so it runs only while `/app/offline` is open. The map itself
still renders only what is on disk; the service tells the panels
(`subscribeOfflineBake`) when new blobs land.

The registry dedups overlapping pins to one area, enforces the storage budget
(LRU-evict over budget), and **reconciles** — re-checks on load, on pin changes,
on tab focus, and on a 20 s timer, re-baking anything missing. Bakes are
idempotent, so a cache wipe or flaky network self-heals.

**🔒 ENSHRINED — newest-last-touched bakes FIRST.** A backlog is processed
most-recently-touched-first (the active map's freshest features, then other maps
by `lastTouched` desc). A freshly-dropped pin must never wait behind hundreds of
old areas. Eviction is the mirror image — **least**-recently-touched first.

**🔒 ENSHRINED — a blob is ONE indivisible unit (satellite + roads together).**
One `areaKey`, ONE `lastTouched`. They download together and **evict together**
— `pruneArea` drops the photo, the tiles, AND the registry record in one call.
If you ever see a photo with no roads (or vice versa), it is NOT eviction
splitting a blob — it's a DOWNLOAD bug; fix the download path, never
special-case eviction. (Tripwires in `bakeService.test.ts`.)

**🔒 ENSHRINED — TWO SIMPLE LISTS (the whole brain, every 20 s).** `bakeAll` is
two independent passes over ONE list ranked by last-touched. If either grows
extra branches, you've taken a wrong turn.

```
First: a guard. Any maps loaded?  ──NO──▶ do NOTHING this pass.
  (On a cold reload the in-memory map list is briefly empty; evicting then would make
   every pin look unowned and wipe everything — the 1 GB → 70 MB crash. Wait for it.)

Rank EVERY feature's blob by LAST-TOUCHED, newest on top. There is no demo blob
(the permanent one at the map home was deleted 5 Sep 2026 — it was the "Ontario
carpet" nobody asked for).

LIST A — KEEP-OR-EVICT
  first: a blob WE baked (has a coverage record) that NO feature references any
  more is evicted now — a deleted pin takes its blob with it. A photo with no
  record is the online map's shared cache; it only ever falls off by LRU below.
  then: add up blob sizes from the top; the moment the total passes 1 GB, draw the line.
    • above the line → KEEP
    • below the line → EVICT the WHOLE blob (image + roads together — never half)

LIST B — DOWNLOAD-WHAT'S-MISSING  (separate pass over the same kept list)
  for each KEPT feature: does it have its blob?
    • yes → leave it
    • no  → download it: image (bakeSatelliteImage) + roads (downloadV4Area)
            └ image came back mostly EMPTY (source throttled)? → FAIL, retry next pass;
              NEVER store the ~30 KB transparent dud.
```

**Last-touched is the ONLY clock.** Size (`OFFLINE_BUDGET_BYTES`) only
decides WHERE the 1 GB line falls. Being briefly over 1 GB is fine.

---

## Layer 2 — the cloud globe basemap

- **Source:** the whole-world Protomaps `planet.pmtiles` (z0–15, ~120 GB) on
  **Cloudflare R2** in the `offline-tiles` bucket. The phone never reads it
  directly — it calls the Worker's `/pack` endpoint, which reads edge-side via
  its R2 binding. Worker source, deploy and the three tiers
  (prod/dev/local): [`../workers/worker-local-dev/README.md`](../workers/worker-local-dev/README.md); client half:
  [`../lib/worker/README.md`](../lib/worker/README.md).
- **Freshness = a snapshot.** Each build is frozen at its date — fine for a
  basemap. No per-user sync, no cache invalidation.

### How tiles reach the renderer

`maplibregl.addProtocol(scheme, handler)` is documented and stable (it is what
Protomaps/PMTiles ships on), and the handler runs on the **main thread**:
vector tiles are loaded by MapLibre's worker, which finds the scheme absent from
its own registry and posts the request back. Registering a protocol *in* the
worker (`importScriptInWorkers`) is experimental; we do not use it.

**Three contracts that fail SILENTLY if you get them wrong:**

| # | Contract | Why |
|---|---|---|
| 1 | A miss must **throw with `status === 404`** | The area is deliberately sparse, so misses are the common path. A 404 is silent *and* preserves parent-tile fallback; a non-404 fires an `ErrorEvent`. **Do NOT** return `{data: null}` or a zero-byte buffer: it yields a *loaded-blank* tile that BLOCKS the parent fallback and punches holes in the map. |
| 2 | Return `buf.slice(0)`, never the cached buffer | The returned ArrayBuffer is **transferred** to the worker. Hand back the same buffer twice (pan away and back) and the second return is a detached 0-byte buffer. Symptom: tiles blank out at random. |
| 3 | The air-gap guard must pass `rtraw://` through | MapLibre runs `transformRequest` **first**, then dispatches to the protocol handler. Without the scheme in `LOCAL_PREFIXES`, `v4TransformRequest` answers every wall tile with `BLANK_PNG` — PNG bytes into a protobuf parser, "Unimplemented type: 4". LAW 0 still holds: the scheme resolves to on-device bytes and cannot reach the network. |

The MVT bytes must be **uncompressed** — MapLibre throws "please make sure the
data is not gzipped" if not.

**Considered and rejected:** the `map-gl-offline` and `maplibre-offline-pmtiles`
plugins. Both snapshot tiles *from a remote tile server* into IndexedDB — LAW 0
means there is no remote to snapshot. `addProtocol` **is** the offline story.
(MapLibre *Native* has `MLNOfflinePack` — different product.)

### The air-gap guard — obeying LAW 0

`v4TransformRequest` in `packDownload.ts` is the backstop: every tile the map
asks for resolves to on-device bytes, and the guard blocks any stray
glyph/sprite/style fetch that isn't local, so a future change can't accidentally
start streaming into the map.

> **⚠️ The blob-worker URL trap.** The renderer's worker is constructed from a
> **Blob**, so its `self.location` is a `blob:` URL and a root-relative URL like
> `/worldBase/base/tiles/6/18/22.pbf` **cannot resolve there** — the failure
> surfaces as a confusing world-base error far from its cause.
> `v4TransformRequest` therefore ABSOLUTISES root-relative URLs. Do not
> "simplify" that to returning `{url}` unchanged.

---

## Layer 3 — cloud bake + supplement (the vision)

Three moves, each independent, all on Cloudflare, all leaving Layers 1–2
working as the fallback:

- **3a. Bake once in the cloud.** A Worker bakes an area once, stores the
  finished pieces in R2, every phone downloads the result. The on-device bake
  stays as fallback.
- **3b. Central registry — "don't build or send it twice".** A cross-user
  index of which areas are baked and at what quality. Already baked → download;
  new → one cloud bake, register, download. The next user gets it for free.
- **3c. Supplement per area** — owned high-res imagery in place of the default
  photo where we have it; sharper edges where OSM is coarse.
  **Licensing is the only constraint, and it's hard:** Esri/Mapbox/Google
  satellite ToS **forbid** caching/storing tiles for offline use — contractual,
  enforced by key revocation + account termination (Mapbox allows offline only
  via its own SDK). OSM/Protomaps (ODbL) + EOX Sentinel-2 (open) **explicitly
  permit** offline storage + redistribution with attribution. Owned or
  openly-licensed imagery only.

Rollout rule: **a cloud layer never deletes or rewrites the device path** until
it has fully replaced it in production behind a flag. If the cloud is
unreachable, the phone still bakes and the map still works.

---

## Data sources — kept deliberately small

| Layer | Provider | Licence | Format |
|-------|----------|---------|--------|
| Satellite photo | EOX (Sentinel-2 cloudless) | open | raster `image` |
| Roads, water, places, pois | Protomaps planet (OSM), via the pack | ODbL | MVT, `packLayers.ts` |
| World base below the area | bundled Natural Earth (`static/mobileAssets/worldBase/`) | public domain | GeoJSON |

A layer earns its place only if it's **small AND shows something the satellite
photo can't.** Rejected: **forest / landcover** (the photo already shows the
forest; as a raster it's big), **terrain / contours** (not needed). Owned
high-res imagery is a *replacement* for the satellite, not a new layer (§3c).

---

## Do-nots (settled)

- **Don't convert the ONLINE map to MapLibre, and don't convert this route back
  to Mapbox.** The online map needs globe / `setTerrain` / `setFog` / `mapbox://`
  styles; this route needs `addProtocol`. `typeof mapboxgl.addProtocol ===
  "undefined"` — calling it on Mapbox fails as a **silent no-op** (the map
  renders nothing, no error).
- **Don't put a Mapbox `Marker`/`Popup`/control on the MapLibre map, or vice
  versa.** `new mapboxgl.Marker().addTo(maplibreMap)` throws
  `TypeError: e2._addMarker is not a function` and the map renders **black**.
  Worse when it does NOT throw — a Popup from the wrong library gets the other
  namespace's DOM classes, so its close button and CSS silently fail. Ask the
  live instance which library built it: `lib/shared/rendererOf.ts`.
- **Don't add a `mapboxgl-*` CSS selector without its `maplibregl-*` twin.**
  MapLibre emits zero `mapboxgl-` classes; the map still renders, so a smoke
  test passes — only the controls are unstyled and in the wrong corner.
- **No serving the PLANET `.pmtiles` pyramid to the map** — its low-zoom tiles
  DROP minor features from the data. Our own low-zoom gate keeps the data and
  only delays drawing it (law 1). The rule is about *lossy* pyramids, not
  about tiles. ([[offline-map-laws]])
- **No `geojson` source for the wall map, ever again.** It re-parses and
  re-indexes the whole dataset on every `setData` and retains the index for the
  source's lifetime, inside the renderer's worker where `performance.memory`
  cannot see it. This cost 800–1200 MB. The remaining `geojson` sources on the
  route (selection highlight, coverage overlay) hold a handful of features.
- **No tile pyramid for the satellite** — it swaps tiles + vanishes below its
  min zoom.
- **Jagged frontier stays raw** ([[offline-map-no-smoothing-jagged-boundary]]).
- **Colours are the user's** ([[dont-change-colours-without-permission]]).
- **No caching provider satellite** (Esri/Mapbox/Google) for offline — see §3c.

## Getting the pin in the middle — settled, read twice

**Do NOT centre the DATA on the pin. Centre the CAMERA (`map.setCenter(pin)`)
and make the data a SUPERSET that fully contains the pin's box.** Assert
CONTAINMENT, never centring (test A3). A shipped box of ~46 km reach a few
hundred metres off-centre is the correct answer: the offset is the tile grid,
and every road sits on its true coordinates. **Kilometres = a bug. Metres =
working.** Four attempts that failed: ship the tile the pin falls in (45 km
off); send the cell centre to the server (blob built 63 km west — a cache key
may be derived from the request, never replace it); rasterise to a pin-centred
PNG (centred, but no restyling and blurs); clip vectors to the box (cuts every
boundary road into an arc). Roads tens of km away AFTER all this is the
shared-key collision below, not centring.

## Storage rules (phone)

- **The key is the pin:** `pin/<lng.5>,<lat.5>/<z>/<x>/<y>` (`grid.ts`
  `pinTileKey`). A bare `z/x/y` is a world grid square that two pins share.
- **One address can have several owners — return them all and merge** by byte
  concatenation (a vector tile is a repeated `layers` message). Returning the
  nearest owner alone drew half a map.
- **Never persist a 0-byte tile** — MapLibre's worker throws `Unimplemented
  type: 4` on every render pass, forever. Reject at the write boundary.
- **Never parse a key with `key.split("/")`** — a pin key yields `NaN`
  geometry without throwing. One `parseTileAddress()` that returns `null`.
- **Never let a read latch** into a permanent miss.

## Renderer rules (phone)

- A tile source has one URL template and three integers — **there is nowhere
  to put a pin**; the protocol handler resolves `z/x/y` back to owners itself.
  Two tiers, two templates: `rtraw://disc/{z}/{x}/{y}` (z8+) and
  `rtraw://shallow/{z}/{x}/{y}` (the z6 tier, its own store).
- **MapLibre caches 404s — a tile that misses once is never re-asked.** After
  tiles land, call the source's `setTiles([url])` on a retry ladder (400 ms /
  1.5 s / 4 s), and make the "asked N, found 0" detector trigger it. This is
  the "worked for months and then didn't" pattern.
- MapLibre overzooms up, never down: a source with `minzoom: 8` is silently
  blank below z8.

## Worker traps

- **The build ID must be in the edge cache key** — entries are `immutable`;
  without it a deploy replays old bytes and looks like a no-op.
- **Gzip the body yourself, but do NOT set `Content-Encoding: gzip`** — the
  edge compresses on top and the browser inflates one layer into garbage.
- A cold build takes ~56–66 s; a client timeout under ~150 s is a coin flip.
- Emit build ID, cache HIT/MISS and timing headers, listed in
  `Access-Control-Expose-Headers` or JS never sees them.

## Bake service rules

- **Budget the thing the USER does (bake an area), never what the code does
  (issue a request).** A tripped breaker is terminal for the session; twice a
  request-counting cap tripped in ordinary use. Test that the cap fits ~300
  pins re-baking.
- **A spinner needs a watchdog the watched process cannot skip or reset:** on
  the same ticker that draws the number, one-way, capped (~30 s); work
  continues silently after.

## Acceptance tests — the ONLY definition of done

Bytes downloaded, tiles on disk, layers added, features counted and manifest
boxes are all PROXIES. Prove every test red-on-bug.

- **A1 — Roads are visible.** Drop a pin, wait, count road-coloured canvas pixels.
- **A2 — At every zoom.** A1 at z6, z8, z12 and z16 on the same pin.
- **A3 — Around the pin.** The pin's box is CONTAINED in what shipped, all four sides.
- **A4 — Two adjacent pins both draw fully** (~30 km apart, shared addresses).
- **A5 — Airplane mode.** Bake, go offline, hard-reload, roads still draw.
- **A6 — Late arrival.** Drop a pin, don't touch the map; roads appear on
  their own — the cached-404 regression, the most valuable test here.
- **A7 — Imported pins.** Import a file with pins never visited; all get data.

## Engineering rules

1. **DevTools first** — read live state, never predict it.
2. **Never verify one layer and declare the chain fixed.**
3. **Fail loud. No silent fallbacks** — a read returning null, a swallowing
   catch, a NaN into geometry, a "retry next pass" on a latched guard.
4. **Instrument WHERE, not just HOW MUCH.** Every offline bug was correct
   bytes in the wrong box; report per pin the blob's corners, reach in km and
   offset from the pin, and never another pin's data as this pin's.
5. **Keep the import graph small.** The old `/offline` route pulled 175 files
   / 53,675 lines for ~8,600 of map. The map imports no app UI, stores or
   utilities; a file-budget test enforces it.
6. **One definition of shared constants** — radius and key format are shared
   byte-for-byte between Worker and phone, with a drift test.

## Testing — wipe the store first

Old blobs from every previous session make every reading meaningless (a real
session showed Juticalpa, Honduras under an Ontario anchor; the ruler read
40 km). **WIPE THE STORE. BAKE ONE BLOB. LOOK AT IT** — everything: tiles,
satellite, coverage records. Never plug new code into a dirty map, never trust
`querySourceFeatures` as proof (it cannot see shape, position or leftovers),
never report "verified" until the user has looked.

## Two measured facts (2026-08-18)

- **The archive thins roads as you zoom out:** at z9 and z10 only
  `major_road`/`highway` exist; z12 and z15 have minor roads. No filter can add
  back a road never stored at that level — hence ONE stored level, overzoomed.
- **Tiles are squares, discs are round:** a z9 tile (55 km) kept by a grazing
  corner dragged roads 78 km past the rim; a z1 tile once shipped half the
  planet. Whole tiles ship as a superset by design; the grid must be fine
  enough that the square-vs-circle error stays small.

## Open items

- `debugReport.ts` still emits five timestamps per layer (`askedAt`,
  `arrivedAt`, `drawnAt`, `transitMs`, `paintLagMs`). Chris's ask (30 Aug
  2026): ONE number, `toScreenMs = drawnAt − askedAt`, `null` when never
  painted (never 0, never green by default), keep `reason` for the null case.
  Fires load for both the person's location and the last-touched pin — two
  rows, `fires@me` and `fires@pin`.

---

## Cross-links

- Dead ends already walked: [`OFFLINE_HISTORY.md`](./OFFLINE_HISTORY.md)
- **The fire layer:** [`FIRES.md`](../routes/fires/docs/FIRES.md)
- Measured memory receipts: [`MEMORY_FINDINGS.md`](../../ReTreever/src/lib/mobile/offline/MEMORY_FINDINGS.md)
- Forward work: [`TODO.md`](../../ReTreever/src/lib/mobile/docs/TODO.md)
- Memories: `offline-blob-naming-and-model`, `offline-download-guard`,
  `offline-map-constant-presence-no-zoom-culling`,
  `offline-map-no-smoothing-jagged-boundary`, `mapbox-pmtiles-not-supported`,
  `big-map-storage-split`, `vector-source-layer-name-must-match`,
  `no-silent-fallbacks`.
