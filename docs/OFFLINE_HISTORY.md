# Offline Map — History (the footnote)

The live plan is [`OFFLINE_PLAN.md`](./OFFLINE_PLAN.md). **Start there.** This
file is the record of approaches tried and **removed**, kept so nobody re-walks
a dead end. Nothing here is on disk. The 5 laws carried through every version;
only the machinery changed.

---

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

---

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

---

## Parked: the zoom-banded tiered-tile download design

Bucketed offline tiles by **zoom band** — a world floor (z0–7), linework
(z8–11), big tiles (z9–10), small tiles (z15) — each with its own byte budget
and LRU eviction, planned via `@turf/union` + `@mapbox/tile-cover` into a
manifest. **Parked because banding by zoom is a direct violation of law 1
(constant presence).** The planner code (`offlinePlan.ts` / `offlineBudget.ts`)
is deleted — git history if ever needed. Revive only if a flat per-feature
buffer proves insufficient, and strip the zoom bands first.

---

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

Memories: `offline-blob-naming-and-model`, `offline-map-laws`,
`offline-map-constant-presence-no-zoom-culling`,
`offline-map-no-smoothing-jagged-boundary`, `mapbox-pmtiles-not-supported`.
