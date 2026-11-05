# Satellite sources

Every satellite pixel on both maps is a tile the phone holds: nothing streams. Each blob (a pin, or an area
the planter saved) holds its source's tiles once — the 2 km disc at the source's zoom and the z10–12 tiles
over it — fetched through the tiles Worker, so `/app/squirrel` can count, price and switch them. They live in
the tile store as `p/<source>/z/x/y` and MapLibre draws them through `v10://photo/<source>/…`. Every source's
licence lets us keep its tiles. The list itself is `lib/contract/satelliteSources.ts`; the Worker, the phone
and Squirrel all read it. When this page and that file disagree, the file wins and this page is fixed.

## Who serves what

| Where | Source | Close zoom | Kept | Cost |
|---|---|---|---|---|
| Blobs outside the US | MapTiler | 16 | R2, and on the phone | $0.15 per 1,000 past 500k a month |
| Blobs in the US | USGS | 16 | R2, and on the phone | Free |
| Blobs in New South Wales | NSW Spatial Services | 18 | R2, and on the phone | Free |
| Blobs in France | IGN BD ORTHO | 18 | R2, and on the phone | Free |
| Blobs in the Netherlands | PDOK Luchtfoto | 18 | R2, and on the phone | Free |
| Blobs in Spain | IGN España PNOA | 18 | R2, and on the phone | Free |
| Anywhere, when the planter switches it on (BASEMAP → Sentinel satellite; off by default, per device) | Sentinel, streamed under the held photos | 15 | R2 | Free |
| Ground the first source has no imagery for | Sentinel | 14 | R2, and on the phone | Free |
| A new planter's sample area (Mississippi Lake, Ontario) | Sentinel, bundled in the app | 14 | In the app bundle (70 KB) | Free |
| Off | BC Imagery | — | — | Not wired |

Esri World Imagery and Mapbox Satellite were deleted on 1 Nov 2026: both licences forbid storing tiles
outside their own SDKs, so neither can be a blob.

### Sentinel

- EOX `s2cloudless_3857`, the 2016 mosaic: 10 m pixels, 256 px tiles to z15.
- CC BY 4.0, so caching and shipping it in the app are allowed. EOX's later years are non-commercial; only
  the unyeared (2016) layer may be used.

### USGS — the US

- The National Map `USGSImageryOnly`: 256 px to z16. It 404s past z16 and blanks past the border, so
  its coverage boxes stay inside the US. Ranked first wherever it covers (`sourceAt`).
- Public domain: "Map services and data downloaded from The National Map are free and in the public domain."

### MapTiler — everywhere else

- `satellite-v2`, already 512 px tiles, held at **z16** across a 2 km radius. Outside cities Maxar's real
  detail ends at z16.
- The default photo source; Squirrel can switch the photo source. Approved for R2.

### Regional government orthophotos

Each wins inside its `covers` boxes, which stay inside ground the service has imagery for (corners
tested at z17–18). All serve 256 px JPEG in Web Mercator with no key.

- **NSW Spatial Services** `NSW_Imagery` (ArcGIS, `/tile/z/y/x`): cities to z21, the bush 404s past
  z18. "Data accessed through these Web Services are subject to a Creative Commons Attribution By
  Licence". One 2018 sheet says CC BY-ND; we keep and serve the bytes unaltered, which ND allows.
- **France, IGN Géoplateforme** `ORTHOIMAGERY.ORTHOPHOTOS` (WMTS PM) to z19. Licence Ouverte / Etalab 2.0:
  "l'intégralité des données publiques de l'IGN sont placées sous la licence ouverte Etalab".
- **Netherlands, PDOK** `Actueel_orthoHR` to z21. CC BY 4.0; capabilities say no access constraints,
  no fees.
- **Spain, IGN PNOA** `OI.OrthoimageCoverage` to z20. "el uso de los productos y servicios de
  información geográfica del IGN… conlleva la aceptación por el usuario de una licencia CC-BY 4.0".

### Found, not used

| Service | Why |
|---|---|
| BC Imagery WMS / web_mercator_cache | "Access Only"; "cannot be cascaded through another Web Map Service without the express written permission of the Province of British Columbia". No BC imagery is under the Open Government Licence – BC |
| Ontario Imagery Web Map Service | Every project "© King's Printer for Ontario. All Rights Reserved." |
| Alberta, NRCan | No open imagery tile service (NRCan's CBMT is a topo map) |
| Victoria, Vicmap Basemap aerial | Paid: "a licence service fee for incorporating Vicmap Basemaps into your … web mapping application" |
| Tasmania, LIST orthophoto | CC BY-NC-ND 3.0 AU: non-commercial |
| WA, Landgate SLIP | "only use this data for your personal and non-commercial use" |
| SA | No public imagery tile service found |
| Geoscience Australia / DEA | Topo basemap, or Sentinel/Landsat at 10 m+: nothing over Sentinel |
| Queensland `LatestStateProgram_AllUsers` | Aerial is CC BY-SA, but where there is no aerial it fills with Planet satellite "all rights reserved", and the service does not say which a tile is |
| New Zealand, LINZ Basemaps aerial | CC BY 4.0 and usable, but needs an API key: a Developer key (no expiry) would live in Bitwarden under a name Chris picks, then the Worker's `secret` |
| Denmark, Dataforsyningen | Needs a token behind a sign-up |
| Switzerland swisstopo, Estonia Maa-amet | Open and usable (swisstopo OGD; Estonian open-data licence, TMS y-flipped) — not added: no planting there yet |

## When a blob comes down

The phone checks its location only when the map opens (a new session, or back after 30 min in the
background), never in the background. An area is a z10 tile. `routes/offlinev10/areaOpens.ts` decides:

- **First open, or back after 14 days:** the blob at the planter's fix downloads at once and the camera
  jumps to it at z14. With location off, the Worker's `/where` (Cloudflare's IP lookup, no permission)
  stands in at z13; a first open with location off shows the sample area instead.
- **The same area on two occasions** (≥ 4 h apart, or on different days): its blob downloads. On Wi-Fi at
  once; on cellular the SAVE AREA tile says so and a tap downloads it — never a popup.
- **Skipped** where a held photo already reaches the spot (`PHOTO_REUSE_KM`).
- **SAVE AREA** in the map drawer saves the map centre by hand.

The open history is localStorage `gc-map-opens`. An area blob is a `Region` with `area: true`: it bakes a
photo with no pin, and only the LRU or the dock removes it.

## Licence and attribution

| Source | Licence | Credit in the ⓘ, each linked | Logo |
|---|---|---|---|
| Sentinel | CC BY 4.0 | © EOX (linked to cloudless.eox.at) · modified Copernicus Sentinel 2016 | None asked |
| USGS | US public domain | The National Map orthoimagery courtesy of the U.S. Geological Survey | None asked |
| MapTiler | MapTiler Cloud terms; R2 caching approved | © MapTiler © OpenStreetMap contributors | Owed on the free plan only; not shown |
| Streets (planet PMTiles) | ODbL | © OpenStreetMap contributors | — |

A held area's record carries its source's name, and the map credits every source held near the camera.

## Where each rule lives

| Rule | Code |
|---|---|
| The source list, licences, attributions, prices | `lib/contract/satelliteSources.ts` |
| A covering source wins (USGS first) | `lib/contract/satelliteSources.ts` (`sourceAt`, `coverOf`) |
| The online map draws held photos and the sample | `lib/onPhone/satellite/heldPhotos.ts` |
| The open rule | `routes/offlinev10/areaOpens.ts` |
| SAVE AREA, the cellular ask, the open camera | `../getCache_OnlineMap/lib/chrome/saveArea.svelte.ts` |
| Worker: edge → R2 → upstream; R2 only when the cache switch says keep | `workers/worker-local-dev/src/index.ts` (`satelliteTile`) |
| Worker: `/where` | `workers/worker-local-dev/src/index.ts` |
| Only Chris's Supabase sign-in flips a switch, on either Worker | `workers/worker-local-dev/src/index.ts` (`squirrelAdmin`) |
| Mounted photos' attributions | `lib/onPhone/satellite/mountSatellite.ts` |
| Photo coverage radius (2 km) | `lib/onPhone/satellite/satelliteImage.ts` |

## R2

Bucket `gc-satellite-cache`, bound as `SAT_CACHE` (`workers/worker-cloud-dev/wrangler.toml`).

| Key | What |
|---|---|
| `<source>/<z>/<x>/<y>.jpg` | One tile, only from a source whose cache switch is on, only a 200. Locked indefinitely per source prefix in both buckets: never deleted, never overwritten |
| `_squirrel/total/day/<YYYY-MM-DD>.json`, `_squirrel/total/month/<YYYY-MM>.json`, `_squirrel/total/all.json` | Squirrel's running tile counts per `source\|z\|tier` |
| `_squirrel/active` | The source photos bake from; absent means MapTiler |
| `_squirrel/cache/<source>` | `on` or `off`: keep its tiles in R2; absent means the source's `cacheToR2` |
| `_squirrel/map/*`, `_squirrel/standby/*`, `_squirrel/counts/*` | Old switches and counts; nothing reads them |

A new tileset is a new source id, so its tiles never mix with an old one's under the same key.
