# Get Cache offline map — handoff

Get Cache is a mobile app used in the reforestation industry. See it on the
[App Store (iPhone)](https://apps.apple.com/ca/app/get-cache/id6765921100) and the
[Play Store (Android)](https://play.google.com/store/apps/details?id=com.retreever.map).

The feature in question is an offline map. Its like an offline preview, you can see what data is stored localy on the phone (/browser since its a capacitor app). The vector roads and satalite tile “blobs” are downloaded dynamically based on the users location and pins/polygons added to the map.
Here are the repos you can see yourself:
[offline map GitHub](https://github.com/Ground-Truth-Data/getCache_offlineMap) ·
[rapper GitHub](https://github.com/Ground-Truth-Data/rapper)

## Running it

```bash
git clone https://github.com/Ground-Truth-Data/getCache_offlineMap
cd getCache_offlineMap
cp .env.example .env      # then fill in VITE_TILES_HOST — ask me for the dev worker
npm install
npm run dev
```

Then open <http://localhost:5173/offlinev10>.

That is the whole setup. `_rapper/` and `_siblings/` in here are the app shell
and the online map's shared code, committed alongside so a clone is a complete
app — they are generated, so change them upstream rather than in place.

Without `VITE_TILES_HOST` the satellite layer still draws but no vector roads
ever download, which looks like a bug rather than missing configuration.

I made an [explainer video about the “blobs”](https://youtu.be/ksRR6UpchDc).
 Very basically I want the "blobs" to be 1) Always on (nothing appears or disapears as you zoom in or out, like satelite images but just the minimal vectored roads) 2) tiles should arrive fast as possible 3) tiles should render fast as possible

[What blobs are meant to look like](https://drive.google.com/file/d/1oriasZR-0QLkTWlDmD74hvC07HX9tGMt/view?usp=sharing)
You can see it has a jagged circle/radius of satellite images and vector roads around it. 3km and 30km respectively. Vector “roads” tiles come from a Cloudflare R2 bucket and processed by a cloudflare worker (you run a local worker to test tho ); satellite photos come from whichever imagery source is sharpest where the pin sits — US aerial, MapTiler worldwide, or EOX Sentinel-2 as the free fallback. Fire data comes from the [NASA FIRMS API](https://firms.modaps.eosdis.nasa.gov/api).

It downloads map tiles and satellite photos, stores them in the browser's IndexedDB, and renders them with no network. 
Let me know if you have any questions.


## Day one

```bash
npm create -y --min-release-age=0 @retreever/rapper@latest <folder> -- --getCache_OfflineMap
cd <folder> && npm install && npm run dev
```

That git-clones this repo beside a copied `rapper/` and writes `rapper/.env`
(`VITE_TILES_HOST=https://tiles-prod.getcache.org` + `VITE_TILES_DEV_HOST`).
The ~50 MB basemap is NOT in git — `mobileAssets/` holds only `LICENSE.md`
(proprietary terms); `fetchAssets.sh` copies it from a local
`ReTreever/static/mobileAssets` or downloads the `assets-v1` release tarball
into `static/mobileAssets/`.
No key, no account, no npm login. `getCache_OfflineMap/` is a real clone:
edit, branch, push and open PRs from inside it.

**You are set up when:** `http://localhost:5174/offline` (the port is
rapper's `package.json` `dev` script) shows the map, you drop a pin near
Ottawa (`?at=45.42,-75.70&z=11`), and roads appear inside the circle within a
minute. If the satellite photo appears but roads never do, `rapper/.env` is
missing or wrong — the console says so on the first line
(`VITE_TILES_HOST is not set`).

`/` lands on the offline map too — see `hooks.ts`. The debug rails are a
toggle on the map itself, not a second URL. One view, one address.

The Cloudflare Worker that serves tiles lives in this repo at
`workers/worker-local-dev/` (`worker-cloud-dev/` and `worker-cloud-prod/` are
the copies each cloud tier runs). To run it locally:
`cd workers/worker-local-dev && npm run dev`, then pick the `worker-local-dev`
tier in the map's CONFIG panel (`lib/worker/README.md`).

**No keys are needed to work on this.** The default tier is `worker-cloud-dev`,
already deployed and already holding every key. A local Worker without a
`.dev.vars` still serves roads; only `/satellite` and `/fires` 500 there, and
photos fall through to EOX automatically — blurrier, never blank. If you want
those two routes locally, put a gitignored `workers/worker-local-dev/.dev.vars`
with `MAPTILER_KEY=` and `FIRMS_MAP_KEY=` (ask Chris for the MapTiler one — the
licence is per-account; FIRMS is free at firms.modaps.eosdis.nasa.gov).

## What this is

An offline map. It downloads map tiles and satellite photos for areas around
pins, stores them in the browser's IndexedDB, and renders them (MapLibre GL)
with no network. Tiles come from a Cloudflare Worker; satellite photos from
the imagery registry in `lib/onPhone/satellite/photoSources.ts`. Since 6 Sep 2026 the map Get Cache opens (`OFFLINE_MAP_ROUTE`,
`lib/mapState/lastMapRoute.svelte.ts`) is V10 in
`ReTreever/src/routes/(getcache)/app/offlinev10/` (its `README.md` and
`../OFFLINE_STACK.md`); this engine is served at `/app/offline`, by URL only.

**The debugger IS the map.** Same component, one `cards` prop, panels beside it.
Instruments attached to a stand-in produce confident wrong answers.

## Where the data comes from

| Layer | Source | Always on? | Radius per pin |
|---|---|---|---|
| Vector roads — plus water, town labels, hospital/campsite POIs, all in the same blob | One Cloudflare R2 bucket (`offline-tiles`) holding a full-planet OpenStreetMap extract (`planet.pmtiles`); the Worker in `workers/worker-local-dev/` range-reads it and serves one `/pack` blob per pin | highways and major roads yes; small roads and water only inside a disc from z11 / z10 (`MINOR_ROAD_Z`, `WATER_Z` in `lib/onPhone/render/wallStyle.ts`, 5 Sep 2026) | 30 km (`lib/contract/grid.ts`) |
| Satellite photo | The first row in `lib/onPhone/satellite/photoSources.ts` whose box holds the pin, baked on the phone: **USGS** NAIP aerial (~1 m/px, US only, no key) → **MapTiler** satellite-v2 (~1–2 m/px worldwide, paid, proxied through the Worker's `/satellite` route so the key stays a Worker secret) → **EOX** Sentinel-2 cloudless (~10 m/px, public, no key). A row that yields nothing hands over to the next, so a pin is never left blank | yes | 2 km per photo; photos along a line overlap into a ribbon (`lib/onPhone/satellite/satelliteImage.ts`) |
| Fires | NASA FIRMS — VIIRS on NOAA-20, NOAA-21 and Suomi-NPP, last 48 h, proxied through the same Worker's `/fires` route so the API key stays a Worker secret | yes — `attachFireLayer` (`lib/onPhone/render/fireLayer.ts`, since 31 Aug 2026); what is still open is Known broken #4 | 500 km (`lib/shared/fireContract.ts`) |

Everything lands in IndexedDB under a 1 GB budget (`OFFLINE_BUDGET_BYTES`)
and renders with no network.

## The blobs — what good looks like

A blob is the jagged disc of data around a pin: satellite photo at the
centre, vector roads out to the edge. The bar, in order:

1. **One radius.** One packed zoom level, overzoomed above it — a second radius
   was tried three times and always reads as a phantom shape
   (`lib/contract/roadBlob.ts`). Drawing holds detail back: small roads and
   trails from `MINOR_ROAD_Z` (11), water from `WATER_Z` (10), highways and
   major roads at every zoom (`lib/onPhone/render/wallStyle.ts`).
2. **Arrive fast.** The dl badge is a stopwatch from *asked* to *painted on
   screen* — that number is the score, never bytes on disk or an open port.
3. **Render fast, stay small in RAM.** Speed vs memory is the standing
   trade-off: pack only the layers worth their bytes (~92 kB of water, labels
   and POIs on a 445 kB roads blob — measured in `lib/contract/packLayers.ts`),
   hand the renderer URLs instead of live object graphs, and drop parsed data
   the moment it is stored.

## THE ONE RULE

This child holds no map component. The live offline map is V10, and it lives
in ReTreever (`src/routes/(getcache)/app/offlinev10/`); what remains here are
the pieces V10 imports — the layer renderers, the stores, the worker contract,
the fire and hospital passes — plus `/georef`, the one route this child still
serves end to end.

Reach anything here through the `$parent` alias, never a relative climb:

```ts
import { attachFireLayer } from "$parent/siblings/getCache_OfflineMap/lib/onPhone/render/fireLayer";
```

**Do NOT use a symlink.** SvelteKit follows it, but the child's internal
relative imports then trip rapper's `noEscapePlugin` guard. The alias is the
one mechanism.

## Where things are

All map code belongs in THIS repo. Not in ReTreever, not split across both.
"Offline map" is a narrow name for a folder that also holds fires, hospitals
and places — deliberate: this repo has the debugger, so code here can be
watched while it runs. Do not propose renaming it or a second "shared map" repo.

| What | Where |
|---|---|
| The live map (V10) — in the PARENT, not here | `ReTreever/src/routes/(getcache)/app/offlinev10/` |
| Fires engine (v1 + v2 + masks) | `routes/fires/` — read `routes/fires/docs/FIRES.md` before touching v2 |
| Fires Worker half | `lib/worker/firesWorker.ts` — `workers/worker-local-dev/src/index.ts` imports it relatively |
| Tile Worker (Cloudflare, R2) | `workers/worker-local-dev/` — `workers/worker-local-dev/README.md`; `worker-cloud-dev/`, `worker-cloud-prod/` are the deployed twins |
| Worker client (tiers, `/pack` download, fires fetch) | `lib/worker/` — `lib/worker/README.md` |
| Docs — this repo is PUBLIC: no secret, account or endpoint in any of them | `docs/OFFLINE_PLAN.md` (plan, laws, rules, acceptance tests), `docs/OFFLINE_HISTORY.md` (dead ends), `docs/FIELD_NOTES_*.md` (Chris↔contractor), `routes/fires/docs/FIRES.md`. In the parent: `ReTreever/src/lib/mobile/docs/{mapDocs,CLOUD_REGISTRY,TODO}.md`, `ReTreever/src/lib/mobile/offline/MEMORY_FINDINGS.md` (memory receipts) |
| Map art (pins, `fire_icon.webp`, `fire_intensity/`, `pdf_maps_icon.webp`) | `lib/assets/` — committed, imported by URL (`import x from "../assets/….webp"`), never a `/mobileAssets/` string |
| Basemap (`worldBase`, ~50 MB) | `static/mobileAssets/worldBase/` (gitignored — `fetchAssets.sh` fills it from ReTreever or the release tarball; only `mobileAssets/LICENSE.md` is committed) |
| Storage, bake service, renderer, roads, satellite | `lib/onPhone/` |
| Tile contract (byte-identical to `workers/worker-local-dev/src/`) | `lib/contract/` |
| Shared helpers, places index, debug panels, map UI components, map state stores | `lib/shared/`, `lib/places/`, `lib/panels/`, `lib/mapUi/`, `lib/mapState/` |
| Engine door — `HostPorts` | `lib/shared/hostPorts.ts` — ReTreever's implementation: `ReTreever/src/lib/mobile/offline/host/retreeverPorts.ts` |
| Map-UI door — `MapHostPorts { store, ui, gps, scenes?, q704? }` | `lib/shared/mapHostPorts.ts` — ReTreever's implementation: `ReTreever/src/lib/mobile/offline/host/retreeverMapPorts.ts` |

The parent reaches all of it as `$parent/siblings/getCache_OfflineMap/...`.

Every `lib/mapUi` component takes a required `ports: MapHostPorts` prop; every
store factory that needs the host takes it as a parameter
(`createOverlayManager(getMap, store, ports)`, `createUserLocator(getMap,
onDotTap, ports)`, `PinMarkersDeps.ports`, `tracking.start(store, name)`).
ReTreever's real `MapStore` is ASSIGNED to `MapHostStore` in
`retreeverMapPorts.ts` — that assignment is the type-check at the boundary.

**The one thing still in ReTreever on purpose:** `mapStore.svelte.ts` — it IS
the database (TinyBase, the snapshot uploader, the schema, the importers). It
comes in as `ports.store`.

**Declared pair:** this child imports `getCache_OnlineMap` (mapDraw, areaLabels,
safeMap, coord, safeMarker, …) — listed in `deps.json` and in ReTreever's
`childBoundary.test.ts` `DECLARED_CHILD_DEPS`, so the offline child ships WITH
the online child.

## Standing rules

1. **ONE COPY.** Move files, don't copy them.
2. **THE HOST COMES IN AS A PROP.** This repo never imports `$lib`, never
   names a parent (`lib/noParentNames.test.ts`), never climbs out of itself.
   Two doors: `lib/shared/hostPorts.ts` (data for the engine) and
   `lib/shared/mapHostPorts.ts` (store, icons, share sheet, GPS, q704 for the
   map UI). Add a member the day a file needs it.
3. **THE ALIAS IS THE MECHANISM.** Never a raw `../` climb (rapper's
   `noEscapePlugin` throws during build), never a symlink.

## Known broken — pick any of these up

1. **AN EMPTY ANSWER LOOKS LIKE SUCCESS.** The Worker returns HTTP 200 with an
   empty pack when it has nothing. A miss is indistinguishable from a hit at
   every layer above. Make it error.

2. **NO PROGRESS DURING A BAKE.** ~8 s per area, ~39 areas — about 5 minutes of
   black rectangle. "Still downloading" and "broken" look identical.

3. **DEAD EXPORTS.** Written, exported, never called: `setCoverageMirror`,
   `parseCellKey`, `tileHoldsRadius`, `idbDeleteMany`,
   `offlineDownloadGateStats`. Wire or delete.

4. **FIRES V2 IS UNWIRED.** `attachFireLayer` (`lib/onPhone/render/fireLayer.ts`)
   paints v1 from the bake's cache and the Fires row in `wallLegend.ts` carries
   its ids; `routes/fires/v2/fireLayerV2.ts` is written, tested and imported by
   nothing (`routes/fires/docs/FIRES.md`). The Worker's `/fires` route needs a
   NASA FIRMS key (free at firms.modaps.eosdis.nasa.gov): `wrangler secret put
   FIRMS_MAP_KEY` on the cloud tiers, a gitignored
   `workers/worker-local-dev/.dev.vars` locally — without one a fresh local
   Worker 500s on `/fires`. Hospitals and Places are NOT in this bucket — they already ride in the
   `/pack` blob per pin (see `lib/contract/packLayers.ts`); a row reading
   "dl Ns · 0 in view" means the download worked and the area simply has none.

5. **THE WORKER TRUSTS EVERYONE.** Every request to `tiles-prod` is anonymous —
   the app has no more standing than a stranger's `curl`, so a third party
   could build their own service on the tile Worker. Add a shared token: the
   client sends a header read from `rapper/.env` (beside `VITE_TILES_HOST`),
   the Worker rejects requests without it. The token ships in a public web
   bundle, so this is a fence, not a lock — the win is rotation: change the
   token and freeloaders go dark while the app updates. Build and test it
   against `worker-local-dev`; no Cloudflare account needed.

6. **THE MAP UI HAS NO HOST HERE.** Nothing in this repo mounts `lib/mapUi/` or
   `lib/mapState/` — only ReTreever does, through `retreeverMapPorts.ts`. Five
   of them (`SnakeRuler`, `userLocation`, `vertexDrag`, `overlayManager`,
   `pinMarkers`) import `getCache_OnlineMap`, so they need that sibling
   checked out beside this one.

## Test baseline — what red is NORMAL

`npm test` here (31 Aug 2026): 4 files / 27 tests fail, 41 skip. Anything
else is yours.

- `lib/onPhone/bake/bakeService.test.ts` ×25, `lib/mapState/lastMapRoute.svelte.test.ts`,
  `lib/mapState/overlayRenderCacheKey.test.ts` — `$state is not defined`: this
  repo's bare vitest has no Svelte plugin, so rune files only run under a
  parent's suite
- `lib/onPhone/offlineDownloadGate.test.ts` ×2 — prompt-count assertions
- `routes/fires/masks/urbanExclusion.test.ts` SKIPS until `./fetchAssets.sh`
  has run (needs `static/mobileAssets/worldBase/`)

## How to verify anything

**Load it in a browser and look.** Not the terminal, not a test — the screen.
A test passing while the page rendered nothing happened repeatedly here.

`?at=58.7986,-122.6761&z=11` on `/offline` jumps the camera to a coordinate
(lat first, the order a human reads one off a screen).

If the console looks empty, check DevTools' **"Custom levels"** filter — it
hides `console.log` by default.
