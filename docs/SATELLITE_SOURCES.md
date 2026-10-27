# Satellite sources

Every satellite pixel on both maps comes from one of the sources below, through the tiles Worker, so
`/app/squirrel` can count and price it. The list itself is `lib/contract/satelliteSources.ts`; the
Worker, the photo bake and Squirrel all read it. When this page and that file disagree, the file wins
and this page is fixed.

## Who serves what

| Where | Source | Zooms | Kept | Cost |
|---|---|---|---|---|
| Browsing, zoomed out (below z12) | Sentinel | 0–15 | R2 | Free |
| Browsing z12+, outside pins and outside the US | Esri | 12–18 | Never | Free to 2M tiles a month |
| Browsing z12+ in the US | USGS | 12–16 | R2 | Free |
| Pin blobs (the baked photo and its close-up) | MapTiler | 17 | R2, and on the phone | $0.15 per 1,000 |
| Pin blobs in the US | USGS | 16 | R2, and on the phone | Free |
| Standby, off | Mapbox satellite | 13–18 | Never | $0.25 per 1,000 past 750k |
| Standby, off | BC Imagery | — | — | Not wired |

### Sentinel — zoomed out

- EOX `s2cloudless_3857`, the 2016 mosaic: 10 m pixels, 256 px tiles to z15.
- It is drawn under everything, so it shows wherever a sharper source answers 404.
- CC BY 4.0, so caching is allowed, and R2 keeps it (`cacheToR2: true`) until Squirrel's cache switch says
  otherwise.
- EOX's later years are non-commercial; only the unyeared (2016) layer may be used.

### Esri — zoomed in, outside pins, outside the US

- ArcGIS Location Platform basemap tiles, read with the Worker secret `GC_esri_key`.
- **Live only.** It is never put in the edge cache, R2 or a photo, and photos never bake from it.
  Master Agreement E204 §3.2c: "Customer may not otherwise scrape, download, or store Data".
- The phone asks for no Esri tile while the whole view sits inside a pin's photo or inside USGS cover.
- **Free-tier guard.** The free tier is 2,000,000 tiles a month, spent by tiles-dev and tiles-prod on
  one key, so both count into one `METER` bucket. At 90% of their sum each Worker answers 404 and
  Sentinel shows through until the month resets. No card is on the account, so pay-as-you-go can
  never start.

### USGS — the US

- The National Map `USGSImageryOnly`: 256 px to z16. It 404s past z16 and blanks past the border, so
  its coverage boxes stay inside the US.
- Ranked first wherever it covers: the Worker 404s Esri and Mapbox there, and the phone draws USGS
  instead.
- Public domain, cached in R2: "Map services and data downloaded from The National Map are free and in
  the public domain."

### MapTiler — pin blobs

- `satellite-v2`, already 512 px tiles. Photos bake at **z17** into a 3,456 px canvas across a 2 km
  radius (~350 tiles per pin at 49° N). The raw tiles stay on the phone for the close-up.
- It is the default photo source; Squirrel can switch the photo source to another bakeable one.
- Approved for R2: both Workers keep its tiles while its cache switch is on.
- Inside USGS cover, a pin's photo bakes from USGS at z16 instead, on purpose: `sourceAt` takes the
  covering source first. USGS is free and public domain, and z16 is its sharpest zoom.

### Standby

- **Mapbox satellite** — streamed only, never cached (Mapbox ToS). Off until switched on in Squirrel. While on,
  it takes Esri's place on the online map. 750k free tiles a month, then $0.25, $0.20 from 2M and $0.15
  from 4M per 1,000. The 90% guard covers it like Esri.
- **BC Imagery Web Map Service** — off until the Province approves; not in the source list. Its
  catalogue licence is "Access Only", and the service "cannot be cascaded through another Web Map
  Service without the express written permission of the Province of British Columbia".

## Licence and attribution

| Source | Licence | Attribution shown |
|---|---|---|
| Sentinel | CC BY 4.0 | Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016) |
| Esri | ArcGIS Location Platform, stream only | Powered by Esri · Sources: Esri, Vantor, Earthstar Geographics, and the GIS User Community |
| USGS | US public domain | USGS The National Map: Orthoimagery |
| MapTiler | MapTiler Cloud terms; R2 caching approved | © MapTiler © Maxar |
| Mapbox | Mapbox ToS, stream only | © Mapbox © Maxar |

The online map credits a streamed source through its raster source's `attribution`. A box out of view is
hidden, so it is not credited. A baked photo carries its source's name, and the map credits every photo
that is mounted.

## Where each rule lives

| Rule | Code |
|---|---|
| The source list, licences, attributions, prices | `lib/contract/satelliteSources.ts:38` (maptiler), `:57` (sentinel), `:72` (usgs), `:104` (esri), `:122` (mapbox) |
| MapTiler photos at z17 | `lib/contract/satelliteSources.ts:47` |
| MapTiler is the default photo source | `lib/contract/satelliteSources.ts:147` |
| A covering source wins (USGS first) | `lib/contract/satelliteSources.ts:154` (`sourceAt`), `:159` (`coverOf`) |
| Sentinel below, sharp from z12 | `lib/onPhone/satellite/onlineImagery.ts:18` (`SHARP_FROM_Z`), `:69` (Sentinel layer) |
| Esri (or a standby source that is on) is the one live layer | `lib/onPhone/satellite/onlineImagery.ts:35` |
| No Esri tile inside a photo or USGS cover | `lib/onPhone/satellite/onlineImagery.ts:51` |
| Worker: covered tile → 404 for a live source | `workers/worker-local-dev/src/index.ts:499` |
| Worker: standby switched off → 404 | `workers/worker-local-dev/src/index.ts:491` |
| Worker: 90% of the free tier → 404 | `workers/worker-local-dev/src/index.ts:257` (`freeTierSpent`), `:526` |
| Worker: edge → R2 → upstream; R2 only when the cache switch says keep | `workers/worker-local-dev/src/index.ts:137` |
| Squirrel's photo-source switch; standby and cache switches (a live source has no cache switch) | `workers/worker-local-dev/src/index.ts:237` (`switches`) |
| Only Chris's Supabase sign-in flips a switch, on either Worker | `workers/worker-local-dev/src/index.ts:267` (`squirrelAdmin`) |
| A photo's tiles counted by X-Cache: disk, hit, upstream | `routes/offlinev10/satellite.ts:70`, `:82` |
| Mounted photos' attributions | `lib/onPhone/satellite/mountSatellite.ts:230` |
| Photo coverage radius (2 km) | `lib/onPhone/satellite/satelliteImage.ts:12` |

## R2

Bucket `gc-satellite-cache`, bound as `SAT_CACHE` (`workers/worker-cloud-dev/wrangler.toml:42`).

| Key | What |
|---|---|
| `<source>/<z>/<x>/<y>.jpg` | One tile, only from a source whose cache switch is on, only a 200. Locked indefinitely per source prefix in both buckets: never deleted, never overwritten |
| `_squirrel/total/day/<YYYY-MM-DD>.json`, `_squirrel/total/month/<YYYY-MM>.json`, `_squirrel/total/all.json` | Squirrel's running tile counts per `source\|z\|tier`, added to every 100 tiles or 30 s; the meter reads the month's |
| `_squirrel/counts/<YYYY-MM-DD>/<isolate>-<ms>.json` | The old per-flush counts, written until 27 Oct 2026 and summed into the totals; nothing reads them |
| `_squirrel/active` | The source photos bake from; absent means MapTiler |
| `_squirrel/standby/<source>` | `on` or `off` for a standby source |
| `_squirrel/cache/<source>` | `on` or `off`: keep its tiles in R2; absent means the source's `cacheToR2` |

A new tileset is a new source id, so its tiles never mix with an old one's under the same key.
