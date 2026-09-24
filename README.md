# Get Cache offline map — handoff

Get Cache is a mobile app used in the reforestation industry. See it on the
[App Store (iPhone)](https://apps.apple.com/ca/app/get-cache/id6765921100) and the
[Play Store (Android)](https://play.google.com/store/apps/details?id=com.retreever.map).

The feature is an offline map: what data is stored locally on the phone (or
browser, since it is a Capacitor app). The vector roads and satellite tile
"blobs" are downloaded dynamically based on the user's location and the pins
and polygons added to the map. Repos:
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
ever download, which looks like a bug rather than missing configuration. The
~50 MB basemap is NOT in git — `mobileAssets/` holds only `LICENSE.md`
(proprietary terms); `fetchAssets.sh` copies it from a local
`ReTreever/static/mobileAssets` or downloads the `assets-v1` release tarball.

**You are set up when:** the map shows, you drop a pin near Ottawa
(`?at=45.42,-75.70&z=11`), and roads appear inside the blob within a minute.
If the satellite photo appears but roads never do, `.env` is missing or wrong
— the console says so on the first line (`VITE_TILES_HOST is not set`).
`?at=lat,lng&z=` jumps the camera (lat first, the order a human reads one off
a screen). `/` lands on the offline map too — see `hooks.ts`. The debug rails
are a toggle on the map itself, not a second URL.

I made an [explainer video about the "blobs"](https://youtu.be/ksRR6UpchDc).
Very basically I want the blobs to be 1) always on (nothing appears or
disappears as you zoom in or out) 2) tiles arrive as fast as possible 3) tiles
render as fast as possible.
[What blobs are meant to look like](https://drive.google.com/file/d/1oriasZR-0QLkTWlDmD74hvC07HX9tGMt/view?usp=sharing):
a jagged disc of satellite photo and vector roads around a pin. Vector tiles
come from a Cloudflare R2 bucket through a Cloudflare Worker (you run a local
Worker to test); satellite photos come from whichever imagery source is
sharpest where the pin sits; fires from the
[NASA FIRMS API](https://firms.modaps.eosdis.nasa.gov/api). Everything lands in
IndexedDB and renders with no network.

The Cloudflare Worker that serves tiles lives in this repo at
`workers/worker-local-dev/` (`worker-cloud-dev/` and `worker-cloud-prod/` are
the copies each cloud tier runs). To run it locally:
`cd workers/worker-local-dev && npm run dev`, then pick the `worker-local-dev`
tier in the map's CONFIG card (`lib/worker/README.md`).

**No keys are needed to work on this.** The default tier is `worker-cloud-dev`,
already deployed and already holding every key. A local Worker without a
`.dev.vars` still serves roads; only `/satellite` and `/fires` 500 there, and
photos fall through to EOX automatically — blurrier, never blank. If you want
those two routes locally, put a gitignored `workers/worker-local-dev/.dev.vars`
with `MAPTILER_KEY=` and `FIRMS_MAP_KEY=` (ask Chris for the MapTiler one — the
licence is per-account; FIRMS is free at firms.modaps.eosdis.nasa.gov).

## What this is

The offline map is V10, `routes/offlinev10/` (its `README.md`), served at
`/app/offlinev10` by every parent. It downloads map tiles and satellite
photos for blobs around pins, stores them in IndexedDB, and renders them
(MapLibre GL) with no network. Tiles come from the Worker; satellite photos
from the imagery registry in `lib/onPhone/satellite/photoSources.ts`.

**The debugger IS the map.** Same component, docks beside it. Instruments
attached to a stand-in produce confident wrong answers.

## Where the data comes from

| Layer | Source | Always on? | Radius per pin |
|---|---|---|---|
| Vector roads — plus water, town labels, hospital/campsite POIs, all in the same blob | One Cloudflare R2 bucket (`offline-tiles`) holding a full-planet OpenStreetMap extract (`planet.pmtiles`); the Worker range-reads it and serves one tile per request | highways and major roads yes; small roads and water only inside a disc from z11 / z10 (`MINOR_ROAD_Z`, `WATER_Z` in `lib/onPhone/render/wallStyle.ts`) | `RADIUS_KM` (`routes/offlinev10`) |
| Satellite photo | The first row in `lib/onPhone/satellite/photoSources.ts` whose box holds the pin, baked on the phone: **USGS** NAIP aerial (~1 m/px, US only, no key) → **MapTiler** satellite-v2 (~1–2 m/px worldwide, paid, proxied through the Worker's `/satellite` route so the key stays a Worker secret) → **EOX** Sentinel-2 cloudless (~10 m/px, public, no key). A row that yields nothing hands over to the next, so a pin is never left blank | yes | 2 km per photo; photos along a line overlap into a ribbon (`lib/onPhone/satellite/satelliteImage.ts`) |
| Fires | NASA FIRMS — VIIRS on NOAA-20, NOAA-21 and Suomi-NPP, last 48 h, proxied through the Worker's `/fires` route so the API key stays a Worker secret | yes — `attachFireLayer` (`lib/onPhone/render/fireLayer.ts`) | 500 km (`lib/shared/fireContract.ts`) |
| Hospitals | the Worker's `/hospitals` route, from the world list bundled in the Worker | yes | 500 km |

A phone holds at most 1 GB of offline map data (`routes/offlinev10/budget.ts`).

## THE ONE RULE

All map code belongs in THIS repo. Not in ReTreever, not split across both.
"Offline map" is a narrow name for a folder that also holds fires, hospitals
and places — deliberate: this repo has the debugger, so code here can be
watched while it runs. Do not propose renaming it or a second "shared map" repo.

A parent reaches anything here through the `$parent` alias, never a relative
climb (rapper's `noEscapePlugin` throws during build), never a symlink:

```ts
import { attachFireLayer } from "$parent/siblings/getCache_OfflineMap/lib/onPhone/render/fireLayer";
```

## Where things are

| What | Where |
|---|---|
| The map (V10) | `routes/offlinev10/` — read its `README.md` first |
| Fires engine | `routes/fires/` — read `routes/fires/docs/FIRES.md` first |
| Hospitals | `routes/hospitals/` — same pattern as fires: own pass, own cache, painted by the page |
| Fires Worker half | `lib/worker/firesWorker.ts` — `workers/worker-local-dev/src/index.ts` imports it relatively |
| Tile Worker (Cloudflare, R2) | `workers/worker-local-dev/` — `workers/worker-local-dev/README.md`; `worker-cloud-dev/`, `worker-cloud-prod/` are the deployed twins |
| Worker client (tiers, download, fires fetch) | `lib/worker/` — `lib/worker/README.md` |
| Docs — this repo is PUBLIC: no secret, account or endpoint in any of them | `docs/OFFLINE_PLAN.md` (laws, stack, acceptance tests), `docs/LINES_AND_CORRIDORS.md`, `routes/fires/docs/FIRES.md` |
| Map art (pins, `fire_icon.webp`, `fire_intensity/`, `pdf_maps_icon.webp`) | `lib/assets/` — committed, imported by URL (`import x from "../assets/….webp"`), never a `/mobileAssets/` string |
| Basemap (`worldBase`, ~50 MB) | `static/mobileAssets/worldBase/` (gitignored — `fetchAssets.sh` fills it; only `mobileAssets/LICENSE.md` is committed) |
| Storage, bake service, renderer, roads, satellite | `lib/onPhone/` |
| Tile contract (byte-identical to `workers/worker-local-dev/src/`) | `lib/contract/` |
| Shared helpers, places index, debug panels, map UI components, map state stores | `lib/shared/`, `lib/places/`, `lib/panels/`, `lib/mapUi/`, `lib/mapState/` |
| Engine door — `HostPorts` | `lib/shared/hostPorts.ts` — ReTreever's implementation: `ReTreever/src/lib/mobile/offline/host/retreeverPorts.ts` |
| Map-UI door — `MapHostPorts { store, ui, gps, scenes?, q704? }` | `lib/shared/mapHostPorts.ts` — ReTreever's implementation: `ReTreever/src/lib/mobile/offline/host/retreeverMapPorts.ts` |

Every `lib/mapUi` component takes a required `ports: MapHostPorts` prop; every
store factory that needs the host takes it as a parameter. ReTreever's real
`MapStore` is ASSIGNED to `MapHostStore` in `retreeverMapPorts.ts` — that
assignment is the type-check at the boundary. The one thing still in
ReTreever on purpose: `mapStore.svelte.ts` — it IS the database. It comes in
as `ports.store`.

**Declared pair:** this child imports `getCache_OnlineMap` (mapDraw, areaLabels,
safeMap, coord, safeMarker, …), declared in ReTreever's
`childBoundary.test.ts` `DECLARED_CHILD_DEPS`, so the offline child ships WITH
the online child (`_siblings/` in a clone).

## Standing rules

1. **ONE COPY.** Move files, don't copy them.
2. **THE HOST COMES IN AS A PROP.** This repo never imports `$lib`, never
   names a parent (`lib/noParentNames.test.ts`), never climbs out of itself.
   Two doors: `lib/shared/hostPorts.ts` (data for the engine) and
   `lib/shared/mapHostPorts.ts` (store, icons, share sheet, GPS, q704 for the
   map UI). Add a member the day a file needs it.
3. **THE ALIAS IS THE MECHANISM.** Never a raw `../` climb, never a symlink.

## Known broken — pick any of these up

1. **AN EMPTY ANSWER LOOKS LIKE SUCCESS.** The Worker returns HTTP 200 with an
   empty pack when it has nothing. A miss is indistinguishable from a hit at
   every layer above. Make it error.
2. **DEAD EXPORTS.** Written, exported, never called: `setCoverageMirror`
   (`lib/onPhone/store/coverageRegistry.ts`), `parseCellKey`, `tileHoldsRadius`
   (`lib/contract/grid.ts`), `idbDeleteMany` (`packDownload.ts`),
   `offlineDownloadGateStats` (`lib/onPhone/offlineDownloadGate.ts`). Wire or delete.
3. **A BLOCKED WIPE IS AN UNHANDLED REJECTION.** `lib/onPhone/store/wipe.ts`
   closes connections and waits out `onblocked`, but a genuinely blocked wipe
   still `throw`s instead of surfacing as a toast.
4. **THE WORKER TRUSTS EVERYONE.** Every request to `tiles-prod` is anonymous —
   the app has no more standing than a stranger's `curl`, so a third party
   could build their own service on the tile Worker. Add a shared token: the
   client sends a header read from `.env` (beside `VITE_TILES_HOST`), the
   Worker rejects requests without it. The token ships in a public web bundle,
   so this is a fence, not a lock — the win is rotation. Build and test it
   against `worker-local-dev`; no Cloudflare account needed.
5. **THE MAP UI HAS NO HOST IN RAPPER.** `lib/mapUi/` and `lib/mapState/` are
   mounted only by ReTreever, through `retreeverMapPorts.ts`. Five of them
   (`SnakeRuler`, `userLocation`, `vertexDrag`, `overlayManager`,
   `pinMarkers`) import `getCache_OnlineMap`, so they need that sibling beside
   this one.

## Test baseline — what red is NORMAL

`npm test` here: rune files (`*.svelte.ts` and the tests that import them,
e.g. `lib/onPhone/bake/bakeService.test.ts`) fail with `$state is not defined`
— this repo's bare vitest has no Svelte plugin, so they only run under a
parent's suite. `routes/fires/masks/urbanExclusion.test.ts` SKIPS until
`./fetchAssets.sh` has run. Anything else is yours.

## How to verify anything

**Load it in a browser and look.** Not the terminal, not a test — the screen.
A test passing while the page rendered nothing happened repeatedly here.

If the console looks empty, check DevTools' **"Custom levels"** filter — it
hides `console.log` by default.
