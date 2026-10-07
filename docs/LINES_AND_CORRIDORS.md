# Lines and corridors

How a LINE feature earns offline coverage, and why it differs from every other
geometry. The authoritative code is [`lib/shared/anchors.ts`](../lib/shared/anchors.ts) —
one canonical map read by BOTH the reconcile and the debug array, so the two
can never disagree about where a feature's blobs go.

## ⛓️ CONSTRAINTS

🗜️ A line saves roads only — no satellite photo, ever, however long the line is.
🗜️ Anchors along a line must sit close enough that consecutive discs overlap.
🗜️ At most `MAX_ANCHORS_PER_FEATURE` (10) anchors per feature; a longer one is saved in patches.

## Where the blobs go, per geometry

| Geometry | Anchors | Why |
|---|---|---|
| Point | one, at the point | it is its own answer |
| Line | sampled ALONG it, every `LINE_STEP_KM` | one midpoint leaves the ends uncovered |
| Polygon | ONE, at the area-weighted centroid | deters drawing a giant polygon to vacuum a huge area |
| PDF / overlay | four, at the `overlayBounds` corners | blobs from the corners fill the middle in |

Overlap between anchors is expected and free — they dedup downstream by
`satImageKey`, and tile discs share one global deduped pile. Nothing bakes twice.

## The corridor: roads only, no photo

A line (or a plot pin) sets `corridor: true` at the host port boundary
(`retreeverPorts.ts`), and `blobService.ts` queues its blobs with
`photo: !p.corridor`. A corridor carries no photo, so it costs only its tiles
against the 1 GB budget. A spot already on disk or in the queue is not queued
again, so the first feature to claim a spot decides whether it has a photo.

## The step: 1.6× the radius of the disc that must stay continuous

```
LINE_STEP_KM = GRID_RADIUS_KM * 1.6   // 30 km road disc → 48 km
```

The 1.6 factor is the ribbon rule: consecutive discs overlap rather than leaving
a gap between them. **Which radius feeds it must match what the line actually
bakes** — the road disc, never the 2 km satellite disc a line does not fetch
(that spacing puts 28 anchors on an 86 km line where 3 cover the ground).

## Drawing a line

From the `STROKE` dial board in `getCache_OnlineMap/lib/draw/drawStyle.ts` — the weights are a FAMILY, judged
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

- ⛔ Pass `sampleLineAnchors` bare to `flatMap` — it hands the INDEX in as the
  step, and part 1 gets sampled every 1 km.
