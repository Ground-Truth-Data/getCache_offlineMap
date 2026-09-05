/**
 * placePins — the host's point features as pins on the offline map, so the two
 * maps show the SAME pins. Points only: a line or polygon place has many
 * anchors and is a blob footprint, not a pin.
 */
import type { Map as MaplibreMap } from "maplibre-gl";
import type { HostPlace, HostPorts } from "../../shared/hostPorts";
import { DEFAULT_PIN_KEY, pinAssetPath } from "../../shared/icons";

export type PinPlace = { lng: number; lat: number; name: string; key: string };

/** ~11 cm — the same spot, never a neighbour. */
export function anchorKey(lng: number, lat: number): string {
    return `${lng.toFixed(6)},${lat.toFixed(6)}`;
}

/** The point places to draw, minus any whose anchor is already drawn by the
 *  caller (a pin dropped this session keeps its own marker and artwork; the
 *  store's copy of it must not stack a second pin on top). */
export function pointPlacesToDraw(
    places: readonly HostPlace[],
    skip: ReadonlySet<string> = new Set(),
): PinPlace[] {
    const out: PinPlace[] = [];
    const seen = new Set<string>();
    for (const p of places) {
        if (p.corridor || p.anchors.length !== 1) continue;
        const [lng, lat] = p.anchors[0];
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const key = anchorKey(lng, lat);
        if (skip.has(key) || seen.has(key)) continue;
        seen.add(key);
        out.push({
            lng,
            lat,
            name: p.featureName ?? "",
            key: p.featureKey ?? key,
        });
    }
    return out;
}

export interface PlacePinsOptions {
    /** Anchor keys the page already draws itself (session drops). */
    skip: () => ReadonlySet<string>;
}

/** Draws the host's point places and follows `onPlacesChanged`. Returns a detach. */
export function attachPlacePins(
    map: MaplibreMap,
    ports: Pick<HostPorts, "places" | "onPlacesChanged">,
    opts: PlacePinsOptions,
): () => void {
    type Marker = { remove(): void };
    const drawn = new Map<string, Marker>();
    let alive = true;

    const sync = (): void => {
        if (!alive) return;
        const want = new Map(
            pointPlacesToDraw(ports.places(), opts.skip()).map((p) => [
                p.key,
                p,
            ]),
        );
        for (const [key, m] of drawn) {
            if (!want.has(key)) {
                m.remove();
                drawn.delete(key);
            }
        }
        for (const [key, p] of want) {
            if (drawn.has(key)) continue;
            const el = document.createElement("img");
            el.src = pinAssetPath(DEFAULT_PIN_KEY);
            el.title = p.name;
            el.style.cssText = "width:34px;height:auto;display:block";
            // Reserve the slot synchronously so a second sync before the import
            // settles cannot draw the same place twice.
            const slot: Marker = { remove: () => {} };
            drawn.set(key, slot);
            // DESTRUCTURED, never `maplibregl.Marker` — see rendererMixing.test.ts.
            void import("maplibre-gl").then(({ Marker }) => {
                if (!alive || drawn.get(key) !== slot) return;
                const marker = new Marker({ element: el, anchor: "bottom" })
                    .setLngLat([p.lng, p.lat])
                    .addTo(map);
                drawn.set(key, marker);
            });
        }
    };

    const unsub = ports.onPlacesChanged(sync);
    return () => {
        alive = false;
        unsub();
        for (const m of drawn.values()) m.remove();
        drawn.clear();
    };
}
