# Camera mutations — the safeMap rule

> Bare `scripts/…` paths are ReTreever-relative; sibling paths name their repo.

**Every camera mutation goes through `getCache_OnlineMap/lib/safeMap.ts`. No exceptions.**
Direct `map.flyTo`, `fitBounds`, `easeTo`, `jumpTo`, `setCenter`, `setZoom` are
banned by `scripts/check-direct-mapbox-camera.sh`, which runs in CI.

### Current known violations — triaged 2026-08-23, don't re-panic

The guard greps only `../rapper/src` and `src`, where none of these files
lives, so this hand triage is the live list. **Six are guarded, one is not.**
Sites are named by symbol, not line — line numbers here rotted within a fortnight.

| site | verdict |
|---|---|
| `getCache_mapTools/mapFramer.ts` → `createMapFramer`, the `flyTo` on the `z`/`lng`/`lat` params | `Number.isFinite` on both coords **plus** a null-island `(0,0)` reject. Safest of the seven. |
| `getCache_OfflineMap/lib/mapState/pinMarkers.ts` → the cluster-expansion `easeTo` in `createPinMarkers` | guarded by `isFiniteCoord` on the line above |
| `getCache_OnlineMap/lib/mapDraw.ts` → the cluster-expansion `easeTo` in `wireBoundaryPinNavigation` | guarded by `.every(Number.isFinite)` above |
| `getCache_OnlineMap/lib/mapDraw.ts` → the `fitBounds` on `_bbox` in `wireBoundaryPinNavigation` | `parseBbox` returns early on a bad bbox |
| `getCache_OfflineMap/lib/mapState/mapViewport.ts` → `applyCameraOrientation` | `setBearing(0)` / `setPitch(0)` — literals, cannot be NaN |
| **`getCache_OnlineMap/lib/mapGrid.ts` → the `cam.easeTo` in `attachGridLifecycle`** | ⚠️ **the real one.** Feeds an unvalidated `cam.unproject()` result straight into `easeTo`. Unproject on a mid-gesture or degenerate camera is exactly the NaN source §"NaN can also enter through SOURCES and MARKERS" describes. |

So the guard is doing its job — it forbids the *pattern*, and the pattern is
what rots. But only the `mapGrid` site is a live NaN risk; the rest want a
mechanical swap to `safeEaseTo`/`safeFlyTo` (or a documented allow), not a
rescue. Fix `mapGrid` first.

### Why

Mapbox's `_calcMatrices` is the choke point of the render pipeline. One NaN
reaching it (lng, lat, zoom, bearing, padding, offset) corrupts the camera's
internal state, and once corrupt **every subsequent call** — even a valid one —
crashes with `Cannot read properties of null (reading '3')`. Fixing one call
site does not help; the next call inherits the corruption.

`safeMap.ts` does three things at every entry:

1. Validate inputs are finite (reject + log if not).
2. Detect already-corrupt camera state and `jumpTo` a clean one first.
3. `map.stop()` to cancel in-flight animations, preventing stacked transitions.

```ts
import { safeFlyTo, safeFitBounds }
    from "$parent/siblings/getCache_OnlineMap/lib/safeMap";

safeFlyTo(map, { center: [lng, lat], zoom: 14, duration: 1200 });
```

`safeFitBounds` falls back to `safeFlyTo` for degenerate single-point bounds —
no `if (sw === ne)` branching at call sites.

Wanting to add an inline `Number.isFinite` guard before a camera call means
extending `safeMap.ts`, not duplicating the guard.

### NaN also enters through SOURCES and MARKERS

`safeMap.ts` guards camera inputs only. A NaN still crashes Mapbox if it lands
in a GeoJSON source's `coordinates`, a `Marker.setLngLat()`, or a
`map.project()` / `unproject()` argument.

That crash **looks different**: typically `Invalid LngLat object: (NaN, NaN)`
from inside Mapbox's render pass (`_evaluateOpacity`, `pointLocation3D`) with
no user code in the trace. That's the tell — a render-time unproject of bad
data, not a camera call.

Common upstream sources: `e.lngLat` from `touchmove` during a pinch (Mapbox
emits `(NaN, NaN)` mid-gesture), math on drawn vertices before the second
exists, malformed imported KML/GeoJSON, geolocation before the first fix.

**Rule:** validate before writing to a source or marker, reusing the helpers
`safeMap.ts` already exports, so the gate stays one piece of code:

```ts
import { isFiniteCoord, isFiniteLngLat }
    from "$parent/siblings/getCache_OnlineMap/lib/safeMap";

if (!isFiniteLngLat(e.lngLat)) return;
const safe = coords.filter(isFiniteCoord);
```

Never patch the symptom inside Mapbox internals — find the upstream write.

---

