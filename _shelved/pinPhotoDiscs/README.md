# ⚠️⚠️ DO NOT DELETE — shelved by Chris 5 Nov 2026

**Pin photo discs and circles: a cool asset we will use again. Disconnected, not dead.**

Nothing imports this folder. It is left out of vitest, svelte-check/tsc, knip and every build. No dead-code tool,
sweep or agent may delete it.

## What it was

Until 5 Nov 2026 every **pin** got a satellite photo: a 2 km disc of tiles (`photoTilesFor`) around the pin, plus
the overview zooms (`FAR_ZOOMS` 10–12). A pin within 1 km of an existing disc centre reused that disc
(`choosePhoto` / `photoCovering`, `PHOTO_REUSE_KM`). The gold jagged outline (`heldEdge`) traced the union of
the discs. **SAVE AREA**, a tile in the map tool drawer, and the **open rule** (the map opened at the same spot on
two occasions, `planOpen`) each saved an `area: true` blob that also baked a disc.

Card TreePS/GC/147 replaced it: only blocks and pieces get photos, using the cover rule (every tile a piece's outer
ring touches). Pins still get their road blob. The live code is in `lib/onPhone/satellite/satelliteImage.ts`
(`coverTiles`, `pieceTileKeys`, `heldEdge`).

## The files, each a whole copy as it stood at the last commit before the shelf

| File | Came from |
|---|---|
| `satelliteImage.ts` | `getCache_OfflineMap/lib/onPhone/satellite/satelliteImage.ts`: `photoTilesFor`, `areaTileKeys`, `PHOTO_COVERAGE_RADIUS_KM`, disc `heldEdge` |
| `mountSatellite.ts` | the same folder: discs drawn by centre, `discIntersects` |
| `store.ts` | `getCache_OfflineMap/routes/offlinev10/store.ts`: `choosePhoto`, `photoCovering`, `Region.photoCenter` |
| `areaOpens.ts`, `areaOpens.test.ts` | `routes/offlinev10/`: the open rule |
| `saveArea.svelte.ts` | `getCache_OnlineMap/lib/chrome/saveArea.svelte.ts`: SAVE AREA and the open rule's hands |
| `saveAreaCard.svelte.txt` | the SAVE AREA card from `getCache_OnlineMap/lib/chrome/MapToolDrawer.svelte` |
| `wholePhoto.test.ts`, `photoChoice.test.ts` | the disc tests |

## How it was wired

1. `getCache/src/lib/offline/host/retreeverPorts.ts` set `photo: true` on every non-plot Point place.
2. `routes/offlinev10/blobService.ts` `download()` called `choosePhoto(at, regions)` for a photo blob and wrote
   `photoKey` + `photoCenter` on the region row; it emitted `{ kind: "start", photoKey, photoCenter, area }`.
3. `routes/offlinev10/satellite.ts` `startPhotoService` heard that event and `bakePhotos` called
   `saveAreaTiles(photoKey, photoCenter, …)`, which fetched `areaTileKeys(center, zoom)`.
4. `heldPhotos.ts` / `mountSatellite.ts` drew every held disc and its gold edge on the online map; the offline
   preview (`routes/offlinev10/+page.svelte`) did the same.
5. `MobMapPage.svelte` set `saveArea.centre` and called `mapOpened(fix)`; `MapToolDrawer.svelte` showed the card.

To bring it back, copy the functions back beside their live successors and set `photo` on the pins again. Drop the
two banner lines when you do.
