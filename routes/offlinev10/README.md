# /app/offlinev10 — the offline map, cut on the z10 grid

The map lives HERE, in the child. A host tier mounts it with a one-file route
that hands in the two port bundles plus `MapDrawControls` and `fireOrigins`,
which live in a repo this one may not import.

The blob is cut on z10 tiles (~26 km at lat 49). Its own files, its own
store, its own sprites, its own tier setting; nothing is shared with the
retired V8 and V9 (deleted 6 Sep 2026 — V8 cut on the pin's 60 km box, V9
on whole z8 tiles ~104 km across; both are in git history).

What it stands on (bucket, Worker, phone, libraries): `OFFLINE_STACK.md`,
kept by the host tier beside its own app routes.

## ⛓️ CONSTRAINTS

🗜️ **`RADIUS_KM` radius blobs (42 km).** Still the product rule — a blob is a superset of that box.
🗜️ **The gold border is the real border.** It is the edge of the tiles on disk, identical at every zoom.
🗜️ Airplane mode changes nothing above z8 inside a blob.
🗜️ Stock parts only: MapLibre, the Protomaps dark style, IndexedDB keyed by tile address.
🗜️ A phone holds at most 1 GB of offline map data, tiles and photos together (`budget.ts`).
🗜️ Green means every tile of the blob is on disk, never "the download finished".

## What a blob is

The z`ANCHOR_Z` tiles the pin's `RADIUS_KM` box touches, and under each the
whole pyramid down to `MAX_Z`. Below the anchor the bundled world base shows;
the pyramid is silent there, which is the price of a small square. Every zoom
therefore covers the same rectangle, so the gold border drawn from the anchor
tile edges is where the data ends at every zoom. It fades out by
`BORDER_GONE_Z`, once the blob's own roads are on screen, the way the old
ghost grid did.

Tiles are stored once, keyed `z/x/y`; a second blob over the same ground
fetches only what is missing; deleting a blob drops only tiles under no
surviving blob's anchor tiles. A blob is its pin's SPOT, not its ground: a
pin dropped inside an older blob's tiles still earns its own row (0 fetched,
all shared) and its own photo. Only a pin at the very same spot is skipped.
A deleted pin takes its blob and photo with it (the engine diffs the pin
spots it has seen while the host was ready). Blobs with no pin — map centre,
follow-me — only the dock deletes.
A follow-me blob is stored `photo: false` and never gets a photo: no pin,
nothing to look at.

## Keeping the data: the budget, the whole-blob check, the kept light

Three things decide whether the map is still there out of coverage.

**The budget** (`budget.ts`, 1 GB) is enforced at the store's write boundary:
`putTiles` refuses the batch that would cross it, tiles and photos together
(the photo store reports its total through `notePhotoBytes`). The download
stops fetching as soon as its own bytes pass the room it had, and a download
that fails for ANY reason — budget, network, Worker — deletes every tile it
wrote, so no tile is ever on disk without a blob. The failure is a red line on
the blobs dock until the next download starts. In dev the CONFIG card cycles
the budget through 1024 / 256 / 64 / 16 MB (sessionStorage) so the wall can be
hit in minutes; a shipped build never reads the override.

**The whole-blob check** (`checkRegions` in `store.ts`): every tile of a blob
is a row, an empty tile (204 from the Worker) as a 0-byte row, so "whole" is a
set difference against the keys on disk and never a guess about what the
Worker had. Each row carries a dot — green whole, red with "N missing ·
repair" — and the head counts the blobs that are not whole, with "repair all".
Repair (`repairBlob`) is the ordinary download for that spot: it fetches only
what is missing and keeps the row's birth time. Blobs downloaded before
7 Sep 2026 have no rows for their empty tiles and show as not whole once;
repair fetches those empties (no bytes) and they stay green after.

**The kept light**: at boot the engine asks `navigator.storage.persist()`
(`keepStorage` in `store.ts`) and the blobs dock shows the answer — green
"kept", red "NOT kept — the browser may evict this store". Chrome grants on
engagement (bookmark, install, notifications) and Safari on install, both
without a prompt; Safari otherwise clears the store after seven days
unvisited. A red light on a phone is the thing to fix before leaving coverage;
the native shell keeps its own sandbox.

**Names**: a blob is labelled with the nearest town in its own z10 tiles
(`places.ts`, the `places` layer's localities, read once from disk when the
blob lands, stored on the row as `place`), "Oliver · 12 km" when the pin is
not in it. Blobs from before names existed get theirs on the page's next
refresh.

## Files

| file | job |
|---|---|
| `tiles.ts` | slippy math, the anchor-tile range, its pyramid and its parents, the missing-keys diff (tested) |
| `budget.ts` | the 1 GB line, the dev override, `BudgetError` |
| `places.ts` | the nearest town in a blob's own tiles, for its row (tested) |
| `follow.ts` | follow-me: how much map is left toward the nearest blob edge, the 10 km line, the 1 km step (tested) |
| `clip.ts` | cut a raw MVT tile to rectangles, byte-level, no GeoJSON (tested) |
| `store.ts` | IndexedDB `gc-offlineV10`: `tiles` + `regions` (a region carries its range and its place); the budget wall in `putTiles`, `checkRegions`, `keepStorage` |
| `download.ts` | one blob: pool of 32 fetches, batched writes, progress; empties as 0-byte rows; rollback on failure |
| `protocol.ts` | `v10://planet/{z}/{x}/{y}` → store; parents clipped to their blobs' borders; miss = 404; optional read-through |
| `style.ts` | Protomaps DARK over the blobs; a gold line on the outline of the saved tiles, gone by z9, no fill; `LEGEND` rows for the drawer |
| `blobService.ts` | THE blob engine, app-wide: one queue, one download at a time; started by the (getcache) layout, so a pin dropped on the ONLINE map earns its blob right away |
| fires | not here — the pass is the child's `getCache_OfflineMap/routes/fires/fireService.ts`, started by the `(getcache)` layout with every blob centre and the blob-landed signal, into the shared `rt-fire-cache`; the page paints it with the child's `attachFireLayer`, a `fires` row in the LAYERS card switches it |
| `satellite.ts` | the photo pass: one 2 km satellite photo per blob, baked by the old map's `bakeSatelliteImage` into the shared photo store — the pixels come from the first row of `photoSources.ts` whose box holds the pin (USGS 1 m aerial at z16 inside the US, EOX Sentinel-2 z14 everywhere else; a row that draws nothing hands over to the next), and the photo remembers its source for the dock — (`gc-offlineSatellite`), once per blob and again only when its geometry stamp changes; the page mounts it with the old map's `createSatelliteMount` under the planet's `water` layer, so the earth and landuse fills sit under the photo and the water, roads and labels over it; a `photo` row in the LAYERS card switches it; a blob's photo goes when the blob goes |
| hospitals | not here — the pass, cache, layer and card are the child's `getCache_OfflineMap/routes/hospitals/`; the `(getcache)` layout starts the pass with the anchors and the blob-landed signal; a `hospitals` row in the LAYERS card switches the layer |
| which Worker | the child's tiles-host seam (`getCache_OfflineMap/lib/worker/worker-local-dev/tilesHost.ts`): tiles, fires and hospitals all read one target; the CONFIG card switches it (dev only, sessionStorage); shipped builds are locked to prod |
| `SessionDock.svelte` | CURRENT SESSION: memory now/avg/peak + sparkline, live download, reads, json export |
| `ConfigDock.svelte` | CONFIG: worker switches with the grey/yellow/green/red circle and the ask→seen stopwatch, read-through, the budget presets, one switch per pyramid layer |
| `BlobsDock.svelte` | OFFLINE BLOBS: the kept light and MB of budget, the not-whole count with repair all, WIPE, "+ blobs for pins in view", the FOCUSED row, a whole/missing dot and a ledger per blob |

## Pins, the ruler and the library

Since 6 Sep 2026 (evening) the queue lives in `blobService.ts`, started once by
`(getcache)/+layout@.svelte` beside the old bake service. A pin dropped or
moved anywhere in the app — the online map above all — earns its blob the
moment it lands, while there is still signal; people open the offline map when
they need it, and by then it is too late. The page only listens (`onBlob`) to
light the dock and time the paint, and reflects a download that started on
another page. Pins that existed before the service started are left alone.

The gesture is the one both other maps use (`doubleTapToPin.ts`): double-tap
or long-press plants the Snake Ruler's first node; Save drops a pin, which
lands in the app's map store like any other pin and opens the editor whose
Edit button is the pin library. All of that is the ONLINE drawer's
(`MapDrawControls`), which V10 mounts; the store's pins — every map's, the
same ones the online map draws, clustered when they crowd — come with it.

The blob follows the pin: `watchNewPins` watches the store and queues a blob
for every pin dropped this session (one download at a time, deduped by
anchor range, skipped when a blob already covers it). Pins that were there
before this page opened get nothing — 440 pins is 2 GB. The blobs dock has
"+ blobs for pins in view" for those: every on-screen pin without a blob.
Deleting a pin does not delete its blob; that stays manual in the dock.

The border is the OUTLINE of the anchor tiles on disk, not one rectangle
per blob and not a grid: a tile's side is drawn only when the tile across it
is not on disk (`outline` in the page — four neighbour lookups per tile, no
geometry library). Blobs that touch therefore read as one shape with no
seams. The line fades from z8 and is gone by z9 (`BORDER_GONE_Z` in
style.ts), before the blob's own roads fill the screen.

Zoomed out, the planet's own low tiles carry a highway or two and nothing
else, while the world base underneath still draws its roads. So every planet
layer fades in between `PLANET_GONE_Z` (6) and `PLANET_FULL_Z` (7) in style.ts:
below 6 the base shows through the blobs, and by 7 the blob is the blob.
MapLibre allows one zoom curve per expression, so a layer's own curve
(landcover, parks) is folded into the ramp rather than multiplied.

## Follow me

The blue dot's one GPS watch (the drawer's `userLocation`) hands every live
fix to the page (`onUserFix`); V10 never opens a watch of its own. A fix is
looked at only after a kilometre of movement since the last one looked at —
fixes arrive constantly and the maths is worthless on someone standing
still. For that fix, `follow.ts` computes how much map is left: for every
blob, the signed distance to its nearest EDGE (negative outside it), and the
largest of those across all blobs. Edge, not centre — a corner sits further
from the centre than an edge does, so a centre test fires early on the
diagonal. Every blob, not just the current one — doubling back over covered
ground stays deep inside an old blob and nothing fires.

Above 10 km of map ahead nothing happens. At 10 km or less the blob around
the current position is queued through `queueBlob`: the same `RADIUS_KM` box on
whole z10 tiles a pin gets, so the new blob overlaps the old one and shares
its tiles on disk (only the new ones are fetched — ~0.6 MB on a straight
walk). The 10 km is slack on purpose: it fires while there is still map ahead
and, more to the point, while there may still be signal. Nothing is queued
while a download is in flight, so a slow fetch in bad signal cannot stack up
near-duplicates a kilometre apart. Overlap is expected and never stitched;
a follow-me blob whose tiles are all on disk still lands as a row (and a
photo) but fetches nothing.

The blobs dock shows the state: "following · N km of map ahead", gold once
it is at or under the line. `__v10.fix(lng, lat)` in dev feeds a fix by hand.

## The online map's chrome

Inside the phone V10 mounts the ONLINE map's tools, the way `/app/offline`
does: eye and crow (`MapTopControls`), the tool drawer with its zoom and
map-name pills (`MapDrawControls`, `offline`, with the pyramid layer switches
in its BASEMAP card), and the scale bar. The camera is the shared saved one
(`mapViewport`), and the crow hops to `/app/map?at=lat,lng&z=`, which the
online map now reads and writes beside its `#z/lat/lng` hash. So the two
maps open on the same spot from either side.

Since 6 Sep 2026 `OFFLINE_MAP_ROUTE` (`lastMapRoute.svelte.ts`) is
`/app/offlinev10`: the online crow, the MAP tab and every "See on map" eye
land here, and the crow carries `?at&z`. The old `/app/offline` is reachable
only by typing its URL. The drawer's LEGEND card opens the shared `MapLegend`
with the DARK palette's rows (`LEGEND` in style.ts); GRID is the online
grid and draws from z13, the same as on `/app/map`.

The three cards wear the shared `.dev-card` shell and copy the old map's
panel layout; their state comes from V10 only (no bake service, no paint
watcher). Sizes are MB everywhere.

Sprites: `static/offlineV10/sprites/dark*`.
Route folder is lowercase because the getcache host 301s every path to lowercase.
