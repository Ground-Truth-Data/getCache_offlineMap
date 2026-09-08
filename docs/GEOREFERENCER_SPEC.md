# PDF Georeferencer — build spec

**Status:** blank route shipped, feature unbuilt. This document is the brief.
**Route:** `/app/georef` (solo install: `/georef`)
**Repo:** `getCache_OfflineMap` — the whole feature lives here, including any
GDAL work. Nothing goes in ReTreever.
**Reader:** the contractor building it. You own everything below the line.

---

## ⛓️ CONSTRAINTS

🗜️ Everything you write lives in `getCache_OfflineMap/` — nothing in ReTreever.
🗜️ It must work on a phone, one-handed, outdoors, in gloves.
🗜️ The user has no GIS training and will never hear the words "affine" or "CRS".
🗜️ It must work with no signal — georeferencing happens on the device.
🗜️ At least 3 control points before a result is possible; 4+ is normal.
🗜️ This child may not import `$lib`, `$tinyStore`, `$mobRoutes`, or another child.
🗜️ The output must be the corner quad the map overlay already consumes.

---

## Why this exists

Get Cache imports forestry PDFs — planting maps, block maps, cut plans. When a
PDF carries georeferencing (a GeoPDF `/VP` viewport, or GCPs), the app reads it,
computes the corners, and lays the sheet on the satellite map at the right spot.
That path already works.

**Most PDFs in the field do not carry it.** They were exported from ArcMap
without the geospatial PDF option, or printed to PDF, or scanned. Today those
hit a gold notice that says:

> **PDF not georeferenced**
> Check with map provider or email info@getcache.org, I'll fix it for ya.

That notice is the honest current answer, and it is a dead end for the planter
standing in a cutblock. **Your job is to replace that dead end with a screen
where they georeference it themselves, in about a minute.**

When you are done, that toast gains a button: *"Place it myself"* → your route.

---

## The interaction, in one paragraph

Two panes. The **PDF sheet** in one, the **live map** in the other. The user
taps a recognisable spot on the PDF — a road junction, a corner of the block, a
bridge — then taps the same real-world spot on the map. That pair is **control
point 1**. Repeat for 2 and 3. With three pairs you can solve the transform;
show the sheet laid over the map, let them eyeball it, let them add a 4th or
nudge a bad one. Save.

The numbering is the whole UX: **point 1 on the PDF, point 1 on the map, point
2 on the PDF, point 2 on the map.** Numbered, colour-matched, and always
obvious which half of the pair you owe next.

---

## Screens

### 1. Pick a PDF
List of PDFs already imported to this device that lack georeferencing. Plus a
file picker for a new one. Tapping one opens the workspace.

### 2. The workspace — the screen that matters

The hard part is that a phone is small and you need both the sheet and the map.

**DECIDED — build it STACKED: PDF top half, map bottom half, both always
visible.** Chris settled this on 8 Sep 2026. Seeing both halves at once is what
makes the numbered pairing legible, and the cost — each pane is small — is
bought back by letting either pane expand temporarily while the user works in
it. Do not spend time re-evaluating a full-screen toggle or a swipe pair;
they were considered and rejected for losing the pairing.

How the stack behaves is yours: the split ratio, whether a pane expands on
touch, and what the expand gesture is.

**In each pane:**
- Free pan and pinch-zoom, independent per pane. Zooming in to place a point
  precisely is the single most-used gesture — make it excellent.
- A crosshair at pane centre, and a **Set point** button, is more accurate than
  tapping directly (a fingertip is ~10 mm; a crosshair is 1 px). Consider
  crosshair-first with tap as a shortcut.
- Existing points drawn as numbered, colour-matched pins. Tap a pin to select;
  selected pin can be dragged or deleted.
- The pane you owe the next tap in is visibly highlighted.

**State machine per point:** `awaiting PDF tap` → `awaiting map tap` → `paired`.
Never let both halves be pending at once, and never lose a half-entered pair on
a pan.

### 3. Preview
Sheet laid over the map at the computed transform, opacity slider, with the
control points still visible. This is where the user decides it's right.
Per-point residual (how far each point landed from where it was put) belongs
here — but expressed as **metres**, or as a coloured dot, never as "RMSE".

### 4. Save
Writes the corner quad, marks the PDF georeferenced, returns to the map with
the sheet placed.

---

## The maths

Three points give you a full **affine** transform — translation, scale,
rotation, shear — which is the right model for a printed map sheet. With more
than three, least-squares over all of them.

**Do not write this from scratch.** The solver already exists, audited
8 Sep 2026:

- `ReTreever/src/lib/mobile/utils/geoPdfBounds.ts` (606 lines) —
  `fitPageToGeoAffine()` fits a mean-centred least-squares affine through
  GCPs and rejects a fit whose reprojection error exceeds
  `max(30 m, 1% of the page diagonal)`. `applyPageToGeo()` transforms a page
  point forward. Also `/VP` → `/Measure` → `/GPTS`+`/LPTS` parsing,
  `pdfHasAnyGeoref()`, `pdfUsesJpxImages()`. Tested by `geoPdfBounds.test.ts`
  (453 lines) and `pdfHasAnyGeoref.test.ts`.

**This file imports NOTHING but `pdf-lib` — no `$lib`, no `$app`, no store.**
It is pure logic and moves into this child as-is. See "GDAL" below.

Your GCPs are `{ pagePx: [x, y], lngLat: [lng, lat] }`. Feed them in, get the
corner quad out. **If that function's signature doesn't quite fit manual GCPs,
widen the function — do not fork it.** One solver, two callers.

**Coordinates:** everything in the app is WGS84 lng/lat. Do not introduce a
projection layer. If a source PDF is in UTM, that's a conversion at the edge,
not a new coordinate system through your code.

**Quality signal:** compute per-point residual in metres — transform each GCP's
page point forward and measure the distance to where the user put it. A point
far off is a misplaced tap, and the user should see which one. Under ~20 m is
good on a block map; over ~100 m means a point is wrong.

---

## Output contract — get this exactly right

The overlay renderer consumes a **4-corner quad in clockwise order from the
top-left**: `[[lng,lat] TL, [lng,lat] TR, [lng,lat] BR, [lng,lat] BL]`.

It is persisted with its bounds and labels in **one cell**, shape `{ b, c, l }`.
Read the existing writer before you write yours — matching it exactly is what
makes your output indistinguishable from a real GeoPDF's downstream.

Once saved, an overlay from your screen and an overlay from a GeoPDF must be
**byte-identical in shape**. Nothing downstream should be able to tell which
made it. Do not add a "manually georeferenced" branch to the render path.

---

## GDAL — what moves into this repo, and what cannot

The intent is that this code belongs in this repo, not ReTreever. An audit ran
8 Sep 2026; **the answer is already known, so do not re-derive it.**

### Moves cleanly — ~1,434 lines, zero forbidden aliases

Take these four files (plus their tests) as your first commit. All are pure
logic; between them they import only `pdf-lib` and `pdfjs-dist`.

| File (under `ReTreever/src/lib/mobile/utils/`) | Lines | What |
|---|---|---|
| `geoPdfBounds.ts` | 606 | the whole georef core — `/VP` parsing, GCP extraction, `fitPageToGeoAffine`, `applyPageToGeo` |
| `geoPdfBounds.test.ts` | 453 | its tests — synthesises PDFs with pdf-lib |
| `pdfHasAnyGeoref.test.ts` | 85 | georef-presence sniff tests |
| `rasterizePdf.ts` | 120 | pdf.js page-1 → WebP; no georef maths. Carries one Vite `?url` idiom |
| `pdfTextLabels.ts` | 170 | projects PDF text through the affine → `OverlayLabel[]` |

`pdfTextLabels.ts` needs `devlog.ts` and `reportSwallowed.ts` moved with it —
both relative imports, both trivial. **Check those two for `$lib` before you
commit them.**

⚠️ **One thing breaks when you move `geoPdfBounds.ts`:**
`getCache_mapTools/mapImporter.svelte.ts:91` dynamically imports
`$lib/mobile/utils/geoPdfBounds`. Rewrite it to
`$parent/siblings/getCache_OfflineMap/lib/...` **in the same commit**, or the
map's waiting box breaks silently.

### Cannot move without surgery — leave alone

- `gdalConvert.ts` — reads `$env/static/public`; a child cannot import
  SvelteKit's env module. Needs config injection.
- `importPdf.ts`, `importRouter.ts` — bound to `mapStore`.
- `naming.ts` — imports `$mobRoutes/db/index.js`. The hardest tie.
- `/app/map/gdal` route + `ImportProgress.svelte` — six `$lib` specifiers.
  Note this route is **KML/KMZ only** and never sees a PDF.

### Server GDAL — not yours

`ReTreever/services/gdal-pdf/server.py` (1166 lines) is real GDAL in a
container behind a Cloudflare Worker. The Supabase `gdalConvert` function
runs **no GDAL at all** despite its name — it is a shim.

**None of it is in your path.** Today the phone rasterizes with pdf.js
immediately and a server bake swaps in silently afterward. Your feature must
work with **no server at all**: a manually placed sheet is placed on the
device, offline.

---

## Non-negotiables

1. **Offline.** No network call in the georeferencing path.
2. **No jargon.** "Point 1", "Place it", "Looks right?". Never "GCP", "affine",
   "reprojection", "RMSE".
3. **Undo.** Every point deletable and movable. Nothing destructive without a
   way back.
4. **Survives interruption.** A half-finished session must survive the app
   backgrounding — a phone call mid-georeference must not lose the work.
5. **Tests.** The maths gets unit tests, in this repo, running under `npm test`
   here. UI can be manual; the transform cannot.
6. **No `$lib` / `$tinyStore` / `$mobRoutes` / other children.** Enforced by
   `childBoundary.test.ts` — it fails the build, not just a test.

---

## Where to start

1. `npm run dev` in ReTreever, open `http://getcache.localhost:5173/app/georef`
   — the blank page is already there and already has the phone, header, footer.
2. Read `ReTreever/src/lib/mobile/utils/geoPdfBounds.ts` and its tests.
   Understand what already solves the maths before writing any.
3. Read `getCache_OfflineMap/routes/offline/+page.svelte` for the child-route
   shape, and `getCache_OfflineMap/lib/` for how this child organises code.
4. Build the two-pane point-pairing UI first, with the transform stubbed. The
   interaction is the risk; the maths is solved.

## Open question to settle with Chris before building

- Can an already-placed sheet be re-opened and corrected later, or is
  placement one-shot?
