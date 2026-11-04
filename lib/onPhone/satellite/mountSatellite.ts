// Pure: map, blob and its own registries only. Area selection stays with the caller.
import type * as mapboxgl from "maplibre-gl";
import type * as maplibregl from "maplibre-gl";
import {
    LEVELS,
    PHOTO_COVERAGE_RADIUS_KM,
    getSatImageByKey,
    heldEdge,
    photoLevels,
    type Bounds,
} from "./satelliteImage";
import { kmToDegSpan } from "../../shared/kmGeo";
import { sourceNamed } from "../../contract/satelliteSources";
import { CLOSE_UP } from "./satelliteImage";

/** A blob's photo as its record names it: the stored key and the exact centre, never rebuilt from each other. */
export interface PhotoSite {
    key: string;
    center: [number, number];
}

export interface SatelliteMount {
    /** New close-up tiles are on disk; MapLibre remembers the 404s until told. */
    closeUpChanged(): void;
    /** Mount the photos near this camera, unmount the far ones; returns how many are on the map. */
    reconcile(
        camera: Bounds,
        sites: readonly PhotoSite[],
        zoom?: number,
    ): Promise<number>;
    mounted(): ReadonlySet<string>;
    /** Each mounted photo's source attribution, once; the map must show them while those photos are up. */
    attributions(): string[];
    dispose(): void;
}

/** `,` and `-` are not id-safe. */
export function satLayerId(key: string): string {
    return `v4-sat-${key.replace(/[^a-z0-9]/gi, "_")}`;
}

/** The photo's raw source tiles over it: close in, the shrunk photo has no more pixels to give. */
export const SAT_CLOSE_ID = "v4-sat-close";
export const SAT_CLOSE_LAYER = `${SAT_CLOSE_ID}-l`;
export const SAT_EDGE_ID = "v4-sat-edge";
/** The edge where a blob's ground or the photos stop, so it reads as deliberate, not as data that failed. */
export const HELD_EDGE: maplibregl.LineLayerSpecification["paint"] = { "line-color": "#f5a119", "line-opacity": 0.85, "line-width": 0.5 };

// The viewport cull: RAM scales with photos on screen, not pin count. Two rings give hysteresis so a photo near the edge does not flap on every pan.

/** Camera zoom below which no photo mounts — lower holds most of the store on screen at once (z6.5 peaked at 543 MB); the cull, not the floor, is what bounds cost. */
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
    const { dLat, dLng } = kmToDegSpan(PHOTO_COVERAGE_RADIUS_KM, center[1]);
    return (
        center[0] + dLng >= b[0] &&
        center[0] - dLng <= b[2] &&
        center[1] + dLat >= b[1] &&
        center[1] - dLat <= b[3]
    );
}

/** Pure: the smallest level (0 = the full photo, i = 1/LEVELS[i-1]) with a pixel for every device pixel the photo covers at this zoom. */
export function photoLevel(bounds: Bounds, canvasPx: number, zoom: number, dpr: number): number {
    const screenPx = ((bounds[2] - bounds[0]) / 360) * 512 * 2 ** zoom * dpr;
    for (let i = LEVELS.length; i > 0; i--) if (canvasPx / LEVELS[i - 1]! >= screenPx) return i;
    return 0;
}

export interface PhotoCullPlan {
    mount: PhotoSite[];
    /** A mounted photo outside this set gets unmounted. */
    keep: Set<string>;
}

/** Pure: which photos belong on the map for this camera. Antimeridian cameras span the world and mount everything, which is correct. */
export function photoCullPlan(
    camera: Bounds,
    sites: readonly PhotoSite[],
    zoom: number = SAT_MIN_Z,
): PhotoCullPlan {
    // Empty on both sides below the floor, so the sweep unmounts everything.
    if (zoom < SAT_MIN_Z) return { mount: [], keep: new Set() };
    const mountRing = expanded(camera, SAT_MOUNT_VIEWPORTS);
    const keepRing = expanded(camera, SAT_UNMOUNT_VIEWPORTS);
    const mount: PhotoSite[] = [];
    const keep = new Set<string>();
    for (const s of sites) {
        if (discIntersects(s.center, keepRing)) keep.add(s.key);
        if (discIntersects(s.center, mountRing)) mount.push(s);
    }
    return { mount, keep };
}

export function createSatelliteMount(
    map: maplibregl.Map,
    insertBefore: string,
    /** null on a map that cannot read the photo tile protocol: photos only, no close-up. */
    closeUpTiles: string | null,
): SatelliteMount {
    const mountedSat = new Set<string>();
    let disposed = false;
    let passes = 0;
    // createObjectURL pins the blob in memory until revoked.
    const satUrls = new Map<string, string>();
    const sourceOf = new Map<string, string | undefined>();
    const footprint = new Map<string, { bounds: Bounds; z: number; px: number; level: number }>();
    // One outline for every mounted photo, over all of them: drawn per photo, one's edge cut across the other.
    const drawEdge = (): void => {
        const data: GeoJSON.Feature = { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: heldEdge(footprint.values()) } };
        const source = map.getSource(SAT_EDGE_ID) as maplibregl.GeoJSONSource | undefined;
        if (source) return void source.setData(data);
        map.addSource(SAT_EDGE_ID, { type: "geojson", data });
        map.addLayer({ id: SAT_EDGE_ID, type: "line", source: SAT_EDGE_ID, minzoom: SAT_MIN_Z, paint: HELD_EDGE }, map.getLayer(insertBefore) ? insertBefore : undefined);
    };

    if (closeUpTiles) {
        const z = CLOSE_UP.zoom;
        map.addSource(SAT_CLOSE_ID, { type: "raster", tiles: [closeUpTiles], tileSize: 512, minzoom: z, maxzoom: z, attribution: CLOSE_UP.attribution });
        map.addLayer(
            { id: SAT_CLOSE_LAYER, type: "raster", source: SAT_CLOSE_ID, minzoom: z, paint: { "raster-fade-duration": SAT_FADE_MS } },
            map.getLayer(insertBefore) ? insertBefore : undefined,
        );
    }

    const mountSat = (key: string, blob: Blob, at: { bounds: Bounds; z: number; px: number; level: number }): void => {
        footprint.set(key, at);
        const id = satLayerId(key);
        const url = URL.createObjectURL(blob);
        satUrls.set(key, url);
        const [w, s, e, n] = at.bounds;
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
            [SAT_CLOSE_LAYER, SAT_EDGE_ID, insertBefore].find((l) => map.getLayer(l)),
        );
        mountedSat.add(key);
    };

    const unmount = (key: string): void => {
        const id = satLayerId(key);
        if (map.getLayer(`${id}-l`)) map.removeLayer(`${id}-l`);
        if (map.getSource(id)) map.removeSource(id);
        mountedSat.delete(key);
        sourceOf.delete(key);
        footprint.delete(key);
        const u = satUrls.get(key);
        if (u) {
            URL.revokeObjectURL(u);
            satUrls.delete(key);
        }
    };

    return {
        closeUpChanged(): void {
            if (!disposed && closeUpTiles) (map.getSource(SAT_CLOSE_ID) as maplibregl.RasterTileSource | undefined)?.setTiles([closeUpTiles]);
        },
        async reconcile(
            camera: Bounds,
            sites: readonly PhotoSite[],
            zoom: number = SAT_MIN_Z,
        ): Promise<number> {
            const { mount, keep } = photoCullPlan(camera, sites, zoom);
            const pass = ++passes;
            const gone = [...mountedSat].filter((key) => !keep.has(key));
            for (const key of gone) unmount(key);
            const dpr = globalThis.devicePixelRatio || 1;
            // Unmounted, or mounted at another zoom's level.
            const due = mount.filter((s) => {
                const f = footprint.get(s.key);
                return !f || f.level !== photoLevel(f.bounds, f.px, zoom, dpr);
            });
            // Read all at once and mount together: one at a time, a screenful arrived photo by photo.
            const got = await Promise.all(due.map(async ({ key }) => {
                const img = await getSatImageByKey(key);
                if (!img) return null;
                const px = img.canvasPx ?? CLOSE_UP.canvasPx;
                const level = photoLevel(img.bounds, px, zoom, dpr);
                const blob = level ? (await photoLevels(key, img))?.[level - 1] : img.blob;
                return { key, img, px, ...(blob ? { level, blob } : { level: 0, blob: img.blob }) };
            }));
            if (disposed) return 0;
            let added = 0;
            // A newer pass has its own camera: a slow shrink here must not swap a zoomed-in photo back down.
            for (const g of pass === passes ? got : []) {
                if (!g) continue;
                const f = footprint.get(g.key);
                // Its levels could not be made, so it stays as it is.
                if (f?.level === g.level) continue;
                if (f) {
                    // The same source, so the layer, its fade and its place in the stack stay put.
                    const next = URL.createObjectURL(g.blob);
                    (map.getSource(satLayerId(g.key)) as maplibregl.ImageSource).updateImage({ url: next });
                    URL.revokeObjectURL(satUrls.get(g.key)!);
                    satUrls.set(g.key, next);
                    f.level = g.level;
                    continue;
                }
                sourceOf.set(g.key, g.img.source);
                mountSat(g.key, g.blob, { bounds: g.img.bounds, z: g.img.zoom ?? CLOSE_UP.zoom, px: g.px, level: g.level });
                added++;
            }
            if (gone.length || added) drawEdge();
            return mount.filter((s) => mountedSat.has(s.key)).length;
        },
        mounted: () => mountedSat,
        attributions: () => [...new Set([...sourceOf.values()].map((n) => sourceNamed(n)?.attribution).filter((a): a is string => !!a))],
        dispose(): void {
            disposed = true;
            for (const u of satUrls.values()) URL.revokeObjectURL(u);
            satUrls.clear();
            mountedSat.clear();
            footprint.clear();
        },
    };
}
