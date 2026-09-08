# Lines and corridors

How a LINE feature earns offline coverage, and why it differs from every other
geometry. Established in ReTreever on 17 June 2026; recovered and written down
8 September 2026, after it took a full-workspace search to answer "what did we
do with lines before?"

The authoritative code is [`lib/shared/anchors.ts`](../lib/shared/anchors.ts) —
one canonical map read by BOTH the reconcile and the debug array, so the two
can never disagree about where a feature's blobs go.

## ⛓️ CONSTRAINTS

🗜️ A line saves roads only — no satellite photo, ever, however long the line is.
🗜️ Anchors along a line must sit close enough that consecutive discs overlap.
🗜️ One point anywhere in a feature set cancels the corridor and restores photos.

## Where the blobs go, per geometry

| Geometry | Anchors | Why |
|---|---|---|
| Point | one, at the point | it is its own answer |
| Line | sampled ALONG it, every `LINE_STEP_KM` | one midpoint leaves the ends uncovered |
| Polygon | ONE, at the area-weighted centroid | deters drawing a giant polygon to vacuum a huge area |
| PDF / overlay | four, at the `overlayBounds` corners | 30 km discs from the corners fill the middle in |

Overlap between anchors is expected and free — they dedup downstream by
`satImageKey`, and tile discs share one global deduped pile. Nothing bakes twice.

## The corridor: roads only, no photo

A line sets `corridor: true` purely from its geometry type, at the host port
boundary (`retreeverPorts.ts`). That flag does three things:

- **No satellite.** `bakeService` returns before the photo task: `if (corridor) return`.
- **Roads-only pack.** The request carries `&ring=corridor`; the Worker filters
  the pack to the `roads` layer alone — no water, no labels, no POIs
  (`packBuilder.ts`, `keepSet`). `&ring=corridor` is also a distinct edge-cache
  key, so it needs no format-version bump.
- **Free against the photo budget.** A corridor carries no photo, so it costs 0,
  and counts complete with tiles alone.

**One point wins.** If several features reference the same area, `corridor` stays
true only while EVERY one of them is a line — a single point forces the full
photo pack. The live-GPS anchor is always `corridor: false`: a point earns its photo.

A corridor draws as a blob-grid footprint, never a pin marker.

## The step: 1.6× the radius of the disc that must stay continuous

```
LINE_STEP_KM = GRID_RADIUS_KM * 1.6   // 30 km road disc → 48 km
```

The 1.6 factor is the ribbon rule: consecutive discs overlap rather than leaving
a gap between them. **Which radius feeds it is the part that must match what the
line actually bakes.**

This was `BAKE_RADIUS_KM * 1.6` = 3.2 km — the spacing that keeps 2 km
*satellite* discs touching — on the one geometry that never fetches a satellite
photo. An 86 km line took **28 anchors where 3 cover the same ground**. The
surplus deduped downstream, so it cost passes through reconcile rather than
bytes on disk, but the work was real and the ribbon no tighter for it.

If a line ever earns photos, the step becomes a per-disc choice again. The
ribbon rule survives either way.

## Drawing a line

From the `STROKE` dial board in `mapDraw.ts` — the weights are a FAMILY, judged
by ratio, not absolute value:

| | line | casing |
|---|---|---|
| block | 5 | 9 |
| **line** | **2** | **4** |
| polygon | 1.5 | 3.5 |
| track | 1.5 (dashed) | 3 |

A drawn line wears the accent, `--color-draw` / `#b36940` — **terracotta, because
a drawn line is context, not commit.** Gold (`#ffd700`) is the BLOCK signature and
is shared only with GPS tracks; an ordinary line must never wear it.

Lengths go through `formatMeasureDist`: under 1 km in metres, under 20 km to one
decimal, else rounded — comma-grouped. The Snake Ruler owns measurement state and
receives `measureEvent {lng, lat, n}`, where `n` is a counter so a repeat still fires.

## Import

Foreign KML/KMZ is never parsed on-device — it is parked for the GDAL handoff.
Once it is GeoJSON, `LineString`/`MultiLineString` → `featureType: "line"`, unless
`ExtendedData` carries `featureType=track`, which upgrades it to `"track"`. A track
changes the glyph and the styling but **not** the corridor rule: it is still line
geometry, so it still bakes a corridor. For naming, a line anchors at its FIRST
vertex — where the walk began.

## Do not

- ⛔ Ask `rt-vectors` for line tiles. Lines live in the v4 tile pile (`rt-tiles-v3`);
  using the legacy store caused the "downloading the same blobs over and over"
  regression.
- ⛔ Pass `sampleLineAnchors` bare to `flatMap` — it hands the INDEX in as the
  step, and part 1 gets sampled every 1 km.
