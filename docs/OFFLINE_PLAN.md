# Offline Map — Laws, Rules, Stack and History

> ⚠️ **NOT the start here.** The map Get Cache opens is **V10** — start at the
> [Stack section](#the-stack--v10) below. Most of this document (Laws, Layers
> 1–3, do-nots) was written for the retired `/app/offline` engine (URL only)
> and describes that engine's route-level detail, not the live one. It is kept
> for the parts that outlive it: the **5 laws**, **LAW 8**, the **acceptance
> tests** and the **engineering rules**, which V10 inherits.

The reference for everything offline. The offline map lets Get Cache
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
planet tiles); the engine this plan describes stays at `/app/offline`, URL only.

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
(`v4-poi-camp`, `lib/onPhone/render/wallLegend.ts`) are gated to z10+ as decluttering — the one
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
| **2** | **Cloud globe basemap (wall map)** | The planet's OSM vector tiles as one Protomaps `.pmtiles` on R2; the Worker packs the area's slice; the phone stores it and serves it locally (LAW 0). The roads/water you see. | **Shipping — legacy `/app/offline` engine; V10 is the live map, see [The Stack — V10](#the-stack--v10)** |
| **3** | **Cloud bake + supplement** | Bake each area once in the cloud, a central registry so nothing is built/sent twice, better-than-default data per area. | **Vision — design only** |

Layers 1 and 2 shipped as ONE route, `/app/offline` (superseded by V10 below,
same laws). The blob debug panel (`OfflineBlobPanel`) inspects on-device storage
for that route; V10 has its own docks (see the Stack section).

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
starts V10's `blobService` instead, and V10's own page
(`routes/offlinev10/+page.svelte`) starts this service on mount, so it runs only
while the offline map is open. (`OfflineMapPage.svelte` was the V8/V9 shell and
was deleted with them on 6 Sep 2026.) The map itself
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

# The Stack — V10

One section for "what is this built from". Written 6 Sep 2026; V8 and V9
were deleted the same day (git history has them) and the comparison table
below is kept as the record of what changed. `offlinev10/README.md`, once
referenced here as the place blob-cutting mechanics lived, was deleted at
some point after that cleanup and never replaced — nothing below depends on
it, and no page should link to it until a replacement exists.

V10 is the live map (`OFFLINE_MAP_ROUTE = /app/offlinev10`,
`ReTreever/src/routes/(getcache)/app/offlinev10/`). It inherits every law
above; everything in this section is what changed underneath them.

## The three instruments — protected, not optional

`SessionDock`, `ConfigDock` (left) and `BlobsDock` (right) are how this map is
debugged: what is on disk, which Worker served it, which pyramid layers
actually painted. **They are never deleted.** Since 11 Sep 2026 they mount only
at **`/app/offlinev10/debug`** — the plain route is the map a user sees, and the
docks are one URL segment away rather than a switch to remember. `dev` still
walls them out of every build. An audit finding them unmounted on the plain
route has found them working, not dead.

## The three pieces

```
  the tiles BUCKET            the tiles WORKER                    the PHONE
  ───────────────             ────────────────                    ─────────
  R2 bucket "offline-tiles"   Cloudflare Worker "offline-tiles"    MapLibre GL 5
  one object:                 pmtiles 4.4 + fflate                @protomaps/basemaps 5.7 DARK style
  planet.pmtiles              GET /{z}/{x}/{y}.pbf                IndexedDB, one store keyed "z/x/y"
  (Protomaps v4 planet build) 200 = tile · 204 = empty ocean       custom protocol vN://planet/{z}/{x}/{y}
                              ranged reads, no whole-file fetch    bundled Natural Earth z0–6 under the blobs
```

Say "the tiles bucket" for the data and "the tiles Worker" for the code. There is
ONE bucket and three deployments of the same Worker:

| tier | URL | what it is |
|---|---|---|
| `worker-cloud-prod` | https://tiles-prod.getcache.org | the Worker on Cloudflare, prod route |
| `worker-cloud-dev` | https://tiles-dev.getcache.org | same Worker, dev route (the default) |
| `worker-local-dev` | http://localhost:8787 | `wrangler dev` on your Mac, real bucket behind it |

Worker source: `~/DEV/fetch/getCache_OfflineMap/workers/worker-cloud-dev/src/index.ts`
(the prod and local folders are its twins — never delete one). Bucket binding and
routes: `wrangler.toml` in the same folder.

## What the phone does with a tile

1. `download.ts` lists the tiles a pin needs (`tiles.ts`) and fetches them from
   the tiles-host seam's chosen target (the CONFIG card switches it), 32 at a time, writing to IndexedDB in batches.
2. `style.ts` builds the Protomaps DARK style over a vector source whose URL
   scheme is `v10://`.
3. `protocol.ts` answers that scheme from IndexedDB. Miss = 404 (blank), or a
   live fetch when "read-through" is on. V10 clips a tile above the cut to its
   blobs' borders here (`clip.ts`), so the gold line is the data's edge at z0
   as much as at z13.
4. MapLibre parses only the zoom on screen because the planet archive is already
   a pyramid: z8 has highways, z13 has driveways. That is the whole reason it is
   fast and light (45–50 MB heap) where the old build was not.

Fonts: one bundled face, `Noto Sans Regular`; bold and italic map onto it.
Sprites: `static/offlineV10/sprites/dark*`, copied from protomaps/basemaps-assets.
Not used: Martin, Mapbox GL for the offline tiles, per-region PMTiles files, a tile Worker on the phone.

## Where the versions differed (V8 and V9 are gone; V10 is the map)

| | V8 | V9 | V10 |
|---|---|---|---|
| blob footprint | the pin's 60 km box | whole z8 tiles the box touches (1–4) | whole z10 tiles the box touches (9–16) |
| tile size at lat 49 | — | ~104 km | ~26 km |
| tiles / bytes per blob | ~560 / ~5 MB | 1365 per z8 tile / ~5–19 MB | 85 per z10 tile + ~15 parents (z0–9) / ~5 MB |
| gold border | the box | the real tile edge | the outline of the saved tiles (no seams between touching blobs), gone by z9 |
| below the grid | Natural Earth | Natural Earth | the pyramid's top (z0–9 parents, clipped to the border on read) from z7; the world base shows through below z6; Natural Earth outside |
| tool chrome | none | none | the online map's drawer, eye/crow, scale bar; shared camera |
| who earns a blob | a long-press | a long-press | a pin dropped or moved anywhere in the app, online map included (blobService.ts, app-wide); the blue dot when under 10 km of map is left ahead (follow.ts) |
| the old engine | — | — | `startOfflineBakeService` no longer starts from the layout (6 Sep 2026); the old databases are deleted once per device on boot (`retireOldOffline.ts`); `/app/offline` restarts it only while that URL is open |
| fires | the bake's fire pass per disc | — | the child's `routes/fires/fireService.ts`, started by the `(getcache)` layout with every blob centre: one 500 km disc per blob into the same `rt-fire-cache`, fetched when the blob lands and re-fetched every TTL while the app is open; painted by the same `attachFireLayer` as the old map, relevant to the pins, never the screen |
| satellite photo | the bake's 2 km photo per disc | — | `satellite.ts` in offlinev10: the same `bakeSatelliteImage` into the same `gc-offlineSatellite`, one photo per blob centre, baked when the blob lands or on coming back online; mounted by the same `createSatelliteMount` cull, under the planet's `water` layer so roads and water draw over it |

The folder is standalone: own store name (`gc-offlineV10`),
own sprites. The retired `gc-offlineV8` / `gc-offlineV9`
databases are dropped on boot by `retireOldOffline.ts`.

## The online map, for contrast

`/app/map` is `getCache_mapTools/MobMapPage.svelte` on Mapbox GL 3, streaming
Mapbox tiles. It reads `?at=lat,lng&z=` at boot (the `#z/lat/lng` hash wins if
both are present) and writes both on every move. V10's crow jumps to it with the
same view, and the online crow jumps to V10 with `?at&z` — `OFFLINE_MAP_ROUTE` is
`/app/offlinev10` since 6 Sep 2026, so the MAP tab and the "See on map" eyes land
there too.

## Libraries, pinned in `fetch/node_modules` on 6 Sep 2026

Every one is an npm package; the GitHub link is the one its own `package.json` declares.

| package | version | GitHub | where | what it is |
|---|---|---|---|---|
| maplibre-gl | 5.24.0 | https://github.com/maplibre/maplibre-gl-js | phone, offline map | the renderer: WebGL, gestures, styles |
| @protomaps/basemaps | 5.7.2 | https://github.com/protomaps/basemaps | phone | the DARK style (a JSON recipe) and the tile schema the planet file uses |
| pmtiles | 4.4.1 | https://github.com/protomaps/pmtiles | Worker | reads one tile out of `planet.pmtiles` by ranged read |
| fflate | 0.8.2 | https://github.com/101arrowz/fflate | Worker | gunzip, faster than the built-in stream for tiny tiles |
| mapbox-gl | 3.24.0 | https://github.com/mapbox/mapbox-gl-js | phone, online map only | the online renderer; MapLibre is its open fork |

PMTiles is two things with one name. The **format** is a single file holding a whole
tile pyramid plus an index, so a reader can pull one tile with a byte-range request.
The **library** (`pmtiles`, above) is the reader; the format spec and the `pmtiles`
CLI live in the same repo. Our `planet.pmtiles` in the bucket is a Protomaps build,
downloaded from https://maps.protomaps.com/builds/ .

Not a library, but where the tiles come from: the Protomaps planet builds are made
from OpenStreetMap by https://github.com/protomaps/basemaps (the `tiles/` folder).
The world base under the blobs is Natural Earth, https://www.naturalearthdata.com/ .

---

# History — dead ends (the footnote)

The record of approaches tried and **removed**, kept so nobody re-walks a dead
end. Nothing here is on disk. The 5 laws carried through every version; only
the machinery changed.

## V2 — the baked 2-level image pyramid — DELETED

Two baked PNG `image` sources per area: a sharp satellite **core** (~10 km) + a
wide transparent **line image** (roads/water to ~30 km), with one HARD SWAP at
z13 to live satellite tiles + a vector mound. One file survived the cull and
still ships: `lib/onPhone/render/offlineColors.ts`.

**Memory was the whole V2 saga.** The fix that mattered: mound geometry (~97k
features) read from IndexedDB lazily on mount and dropped on unmount — never
hoarded. ~65 MB retained after heavy panning (was 596 MB). The cull was always
working; the HOARD was the bug.

> **`static/mobileAssets/worldBase/`** (once `static/offlineV2/`) was never V2 machinery
> and is **live**: the bundled Natural Earth world base + gazetteer + Noto Sans
> glyphs. Deleting it black-screens the offline map and strips every label.

## V3 — one masked photo per area + on-phone Overpass vector bake — DELETED

Kept V2's wins (single `image` source, the laws, the user's colours) and
dropped the two-tier swap for one masked photo. Its satellite + registry live
on as the current engine; its Overpass road/water/coastline bake
(`bakeVectorLines`, three mirrors, the `-vN` vectors DB) is gone —
`store/tombstones/legacyVectorCleanup.ts` drops the databases.

## V4 rings, decode and re-cut — DELETED

- **Six `geojson` sources** for the wall map — 800–1200 MB on interaction
  (a `geojson` source re-parses and re-indexes its whole dataset on every
  `setData`, inside the renderer's worker). Receipts:
  [`MEMORY_FINDINGS.md`](../../ReTreever/src/lib/mobile/offline/MEMORY_FINDINGS.md).
- **Decode → GeoJSON → re-cut z6–z14 pyramid** in a worker (`wallTiles`,
  `wallFinish`, `v4Decode*`, ~2,700 lines) — 705 MB. Replaced by raw tiles
  served undecoded.
- **Concentric rings** (5 km z15 + 40 km z12, later z9/z12/z13/z15, one source
  per ring) — tiles fell between declared bands and rendered nothing; the
  archive's per-zoom content differs so roads vanished on zoom-out. Replaced by
  one stored zoom.
- **Road RASTER below the vector floor** (`v4RoadRasters`, `rasterDecode`) —
  ~70 MB of PNGs per device, lines 8× a real road's width. Deleted 2026-08-17;
  `purgeRoadRasters.ts` drops the orphaned databases.
- **Bare `z/x/y` road keys** — two pins in one z8 square served each other's
  roads (a Yellowstone pin drew a box 36.6 km south of itself). Keys are now
  pin-prefixed (`grid.ts` `pinTileKey`).
- **`pinFrame`** — wrote pin-box coords into a tile-addressed blob; MapLibre
  stretched the roads 1.86× anchored top-left. Centring belongs to `radiusBox`.

## Dead ends — do NOT reintroduce

- **Un-gated vector mound** — live 30 km OSM GeoJSON on EVERY pin, always in
  memory (~137 MB *per pin*). Fix was *gating*, not banning vectors.
- **World base GeoJSON with global roads** — 16 MB roads + 4.2 MB urban →
  ~450 MB heap. Trimmed to land/water/rivers.
- **`addProtocol` on Mapbox** — a MapLibre API; `undefined` on mapbox-gl
  (verified 3.24.0) and fails as a silent no-op, so the map renders nothing.
  Mapbox's equivalent is `addTileProvider`. The route is on MapLibre now.
- **PMTiles on Mapbox** — never worked end-to-end. PMTiles needs HTTP range
  requests, and `capacitor://` / `file://` don't reliably honour `Range` — an
  ENVIRONMENT reason, not a version one. Don't re-litigate.
  ([[mapbox-pmtiles-not-supported]])
- **Raster tile pyramid for the satellite** — swaps tiles + vanishes below its
  min zoom.
- **Smooth-circle mask of the boundary** — the jagged tile edge is the trust
  signal ([[offline-map-no-smoothing-jagged-boundary]]).
- **Serving the planet's own pyramid** — low-zoom tiles omit minor roads, so
  zooming pops them in and out ("unnerving").
- **A second radius / a second shape** — tried three times; always reads as a
  confusing second shape appearing and vanishing across zooms.

## Parked: the zoom-banded tiered-tile download design

Bucketed offline tiles by **zoom band** — a world floor (z0–7), linework
(z8–11), big tiles (z9–10), small tiles (z15) — each with its own byte budget
and LRU eviction, planned via `@turf/union` + `@mapbox/tile-cover` into a
manifest. **Parked because banding by zoom is a direct violation of law 1
(constant presence).** The planner code (`offlinePlan.ts` / `offlineBudget.ts`)
is deleted — git history if ever needed. Revive only if a flat per-feature
buffer proves insufficient, and strip the zoom bands first.

## Worker side — the pack builder's dead ends

- **2026-08-20 — the 50 km bug.** `cellTileKey` was a grid address two pins can
  share; a Yellowstone pin's roads box sat 36.6 km south, north edge
  byte-identical to the previous pin's. Tiles are keyed by the PIN
  (`pinTileKey`); the cell is only the drawing frame.
- **31 Aug 2026 — pv 15/33 compat era ended.** App Store 1.0.93 looked tiles
  up by bare `z/x/y`, so the Worker served each fleet its own key shape until
  that fleet was declared dead. It now always pin-keys and ignores `pv`.
- **31 Aug 2026 — roads budget deleted.** "Decoded > 2 MB → drop paths, shrink
  to 25 km" (MVT bytes × 9) read 0 by construction: `countsTowardBudget` tested
  `BLOB_DETAIL_Z` (15) while the build read `BLOB_DETAIL_LEVEL` (13).
- **Ring pyramid deleted** (z15 core / z13 mid / z12 outer). The phone papered
  over the z13–z14 hole by decoding to GeoJSON and re-cutting (453 MB, +113
  MB/s). Replaced by the square grid: one read at `BLOB_DETAIL_LEVEL`, one blob
  per cell. A disc saved at one zoom draws nothing below it.
- **`minor_road` is never dropped.** It looked like dead weight on city byte
  counts, but 46 of 193 z13 tiles in a real pack had ZERO roads without it —
  in rural country `minor_road` IS the network. The `z < BLOB_DETAIL_Z` kind
  filter also inverted silently (15 vs a read level of 13) and hit every tile.
- **Disc clip born, rebuilt, deleted.** A z9 tile kept by a grazing corner
  dragged roads 78 km past the rim (`1/0/0` once shipped); a byte-level clip,
  then a clip to the pin's 30 km box (2026-08-20) cut every boundary road into
  an arc. Rule: whole tiles, always a superset, centring is the camera's job.
- **PNG detour reverted 2026-08-20.** `roads-as-image` centred perfectly and
  was worse: no restyling, blurs, one flat picture instead of a map.
- **Zero-byte tiles.** 7k of them in every device's `rt-tiles-v3`; MapLibre's
  worker threw `Unimplemented type: 4` per render pass forever. `readDisc`
  drops 0-byte results; `serializePack` builds manifest and body from ONE list.
- **`PACK_POOL = 32`.** 8-wide measured a 56 s cold loop (client timed out);
  100 in flight hit the 128 MB Worker limit (error 1102).
- **2026-09-02 — the shallow vocabulary miss (pv 48).** The z6 keep-set said
  `["highway","major","medium","minor"]`; the archive speaks `major_road` /
  `minor_road` and `mvtFilter` matches exactly, so the tier shipped highways
  alone while a test built on the same fictional kinds stayed green. Fixed in
  `lib/contract/packLayers.ts`; the v34→v35 content change had also shipped
  without its own pv bump, so baked pins never re-downloaded.
- **The meta-lesson:** every silent failure was two constants that must agree,
  living apart, drifting. Put the invariant in the contract or a test, never a
  comment.

## direction2.x — 30 Aug to 2 Sep 2026 (merged to main 3 Sep, `e27258c`)

- **2 / 2.1** — `RAW_MIN_Z = BLOB_MIN_Z`: the below-z8 stretch tier killed;
  foreign zooms quarantined in the tile lookup.
- **2.2** — memoized merged reads, O(n) merge, in-memory key set: zoom no
  longer freezes. Layer merge proven VERBATIM by an e2e refutation test.
- **2.3** — the shallow z6 tier: one z6 tile per pin, own store, source and
  protocol (`rtraw://shallow`), a z6–z7 relay layer.
- **2.4** — the z6 tile BUILT from the z13 disc reads via `SHALLOW_LAYER_RULES`
  (zero extra R2 reads); real `major_road`/`minor_road` vocabulary; pv 47→48.
- **2.5** — the ghost grid: one faint square per pin = the real bounding box
  of its tileset (`radiusBox`, 60×60 km), `v4-blob-grid-fill` at 0.01 below z6
  fading to 0 by z8 (`blobGrid.test.ts` asserts the value);
  `addSource(BLOB_GRID_SOURCE)` must precede the `wallLayers()` loop or
  MapLibre silently drops the layer.
- Deploy order: **Worker first, then app** — the phone speaks the new
  protocol only after the Worker.

---

## Cross-links

- **The fire layer:** [`FIRES.md`](../routes/fires/docs/FIRES.md)
- Measured memory receipts: [`MEMORY_FINDINGS.md`](../../ReTreever/src/lib/mobile/offline/MEMORY_FINDINGS.md)
- Forward work: [`TODO.md`](../../ReTreever/src/lib/mobile/docs/TODO.md)
- Memories: `offline-blob-naming-and-model`, `offline-download-guard`,
  `offline-map-constant-presence-no-zoom-culling`,
  `offline-map-no-smoothing-jagged-boundary`, `mapbox-pmtiles-not-supported`,
  `big-map-storage-split`, `vector-source-layer-name-must-match`,
  `no-silent-fallbacks`.
