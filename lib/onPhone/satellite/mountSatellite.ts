// Pure: map, blob and its own registries only. Area selection stays with the caller.
import type * as mapboxgl from "maplibre-gl";
import type maplibregl from "maplibre-gl";
import {
    BAKE_RADIUS_KM,
    getSatImageByKey,
    satImageKey,
    type Bounds,
} from "./satelliteImage";
import { SAT_INSERT_BEFORE } from "../render/wallStyle";
import { kmToDegSpan } from "../../shared/kmGeo";

export interface SatelliteMount {
    /** Mount the already-baked photo for this centre, if one is on disk. */
    display(center: [number, number]): Promise<void>;
    /** Mount the photos near this camera, unmount the far ones; returns how many are on the map. */
    reconcile(
        camera: Bounds,
        anchors: readonly [number, number][],
        zoom?: number,
    ): Promise<number>;
    unmount(key: string): void;
    mounted(): ReadonlySet<string>;
    /** Revoke every object URL and forget everything. */
    dispose(): void;
}

/** `,` and `-` are not id-safe. */
export function satLayerId(key: string): string {
    return `v4-sat-${key.replace(/[^a-z0-9]/gi, "_")}`;
}

// The viewport cull: RAM scales with photos on screen, not pin count. Two
// rings give hysteresis so a photo near the edge does not flap on every pan.

/** Camera zoom below which no photo mounts. Lower holds most of the store
 *  on screen at once (z6.5 peaked at 543 MB); the cull, not the floor, is
 *  what bounds cost. */
export const SAT_MIN_Z = 7.5;
const SAT_FADE_SPAN = 0.5;
const SAT_FADE_MS = 300;

/** Whole viewports per side of the camera before a photo may mount. */
export const SAT_MOUNT_VIEWPORTS = 1;
/** Wider than the mount ring on purpose (hysteresis). */
export const SAT_UNMOUNT_VIEWPORTS = 2;

function expanded(camera: Bounds, n: number): Bounds {
    const [w, s, e, no] = camera;
    const dx = (e - w) * n;
    const dy = (no - s) * n;
    return [w - dx, s - dy, e + dx, no + dy];
}

function discIntersects(center: [number, number], b: Bounds): boolean {
    const { dLat, dLng } = kmToDegSpan(BAKE_RADIUS_KM, center[1]);
    return (
        center[0] + dLng >= b[0] &&
        center[0] - dLng <= b[2] &&
        center[1] + dLat >= b[1] &&
        center[1] - dLat <= b[3]
    );
}

export interface PhotoCullPlan {
    mount: [number, number][];
    /** A mounted photo outside this set gets unmounted. */
    keep: Set<string>;
}

/** Pure: which photos belong on the map for this camera. Antimeridian cameras span the world and mount everything, which is correct. */
export function photoCullPlan(
    camera: Bounds,
    anchors: readonly [number, number][],
    zoom: number = SAT_MIN_Z,
): PhotoCullPlan {
    // Empty on both sides below the floor, so the sweep unmounts everything.
    if (zoom < SAT_MIN_Z) return { mount: [], keep: new Set() };
    const mountRing = expanded(camera, SAT_MOUNT_VIEWPORTS);
    const keepRing = expanded(camera, SAT_UNMOUNT_VIEWPORTS);
    const mount: [number, number][] = [];
    const keep = new Set<string>();
    for (const c of anchors) {
        if (discIntersects(c, keepRing)) keep.add(satImageKey(c));
        if (discIntersects(c, mountRing)) mount.push(c);
    }
    return { mount, keep };
}

export function createSatelliteMount(
    map: maplibregl.Map,
    onMounted?: () => void,
    insertBefore: string = SAT_INSERT_BEFORE,
): SatelliteMount {
    const mountedSat = new Set<string>();
    let disposed = false;
    // createObjectURL pins the blob in memory until revoked.
    const satUrls = new Map<string, string>();

    const mountSat = (key: string, blob: Blob, bounds: Bounds): void => {
        if (disposed) return;
        const id = satLayerId(key);
        const existing = map.getSource(id) as
            | maplibregl.ImageSource
            | undefined;
        if (existing) {
            // A re-bake can move the bounds; a stale mount pins the old footprint.
            const [uw, us, ue, un] = bounds;
            const url = URL.createObjectURL(blob);
            const prev = satUrls.get(key);
            satUrls.set(key, url);
            try {
                existing.updateImage({
                    url,
                    coordinates: [
                        [uw, un],
                        [ue, un],
                        [ue, us],
                        [uw, us],
                    ] as never,
                });
                // Revoking a URL the source is still reading blanks the photo.
                if (prev) URL.revokeObjectURL(prev);
            } catch {
                // codestyle-allow-swallow: the previous image stays mounted; the next pass retries.
                satUrls.set(key, prev ?? url);
            }
            mountedSat.add(key);
            return;
        }
        const url = URL.createObjectURL(blob);
        satUrls.set(key, url);
        const [w, s, e, n] = bounds;
        map.addSource(id, {
            type: "image",
            url,
            coordinates: [
                [w, n],
                [e, n],
                [e, s],
                [w, s],
            ] as never,
        });
        map.addLayer(
            {
                id: `${id}-l`,
                type: "raster",
                source: id,
                paint: {
                    "raster-fade-duration": SAT_FADE_MS,
                    "raster-opacity": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        SAT_MIN_Z,
                        0,
                        SAT_MIN_Z + SAT_FADE_SPAN,
                        1,
                    ],
                },
            } as mapboxgl.LayerSpecification,
            map.getLayer(insertBefore) ? insertBefore : undefined,
        );
        mountedSat.add(key);
        onMounted?.();
    };

    const unmount = (key: string): void => {
        const id = satLayerId(key);
        if (map.getLayer(`${id}-l`)) map.removeLayer(`${id}-l`);
        if (map.getSource(id)) map.removeSource(id);
        mountedSat.delete(key);
        const u = satUrls.get(key);
        if (u) {
            URL.revokeObjectURL(u);
            satUrls.delete(key);
        }
    };

    return {
        async display(center: [number, number]): Promise<void> {
            const key = satImageKey(center);
            if (disposed || mountedSat.has(key)) return;
            const img = await getSatImageByKey(key);
            if (img && !disposed) mountSat(key, img.blob, img.bounds);
        },
        async reconcile(
            camera: Bounds,
            anchors: readonly [number, number][],
            zoom: number = SAT_MIN_Z,
        ): Promise<number> {
            const { mount, keep } = photoCullPlan(camera, anchors, zoom);
            for (const key of [...mountedSat]) if (!keep.has(key)) unmount(key);
            let shown = 0;
            for (const c of mount) {
                if (disposed) break;
                await this.display(c);
                if (mountedSat.has(satImageKey(c))) shown++;
            }
            return shown;
        },
        unmount,
        mounted: () => mountedSat,
        dispose(): void {
            disposed = true;
            for (const u of satUrls.values()) URL.revokeObjectURL(u);
            satUrls.clear();
            mountedSat.clear();
        },
    };
}
