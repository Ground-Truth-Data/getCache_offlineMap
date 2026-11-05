// Pure: map and the area records only. Area selection stays with the caller.
import type * as maplibregl from "maplibre-gl";
import { getSatImageByKey, heldEdge, PHOTO_MIN_Z, type Bounds } from "./satelliteImage";
import { SATELLITE_SOURCES, sourceNamed } from "../../contract/satelliteSources";

/** A held photo as its record names it: the stored key and its pieces' outer rings, never rebuilt from each other. */
export interface PhotoSite {
    key: string;
    rings: [number, number][][];
}

export interface SatelliteMount {
    /** New tiles are on disk; MapLibre remembers the 404s until told. */
    tilesChanged(): void;
    /** Rings the held areas in gold; returns how many are within a viewport of this camera. */
    reconcile(camera: Bounds, sites: readonly PhotoSite[]): Promise<number>;
    /** Each near area's source attribution, once; the map must show them while that imagery is up. */
    attributions(): string[];
    dispose(): void;
}

// The fill source lowest, so another source's own tiles land over it.
const IDS = Object.keys(SATELLITE_SOURCES).sort((a, b) => Number(b === "sentinel") - Number(a === "sentinel"));
const sourceId = (id: string) => `v4-sat-${id}`;
/** Each source's photos, bottom to top. */
export const SAT_LAYERS = IDS.map((id) => `${sourceId(id)}-l`);
export const SAT_EDGE_ID = "v4-sat-edge";
/** The edge where held ground stops, so it reads as deliberate, not as data that failed. */
export const HELD_EDGE: maplibregl.LineLayerSpecification["paint"] = { "line-color": "#f5a119", "line-opacity": 0.85, "line-width": 0.5 };

/** Camera zoom below which no edge is drawn: an area is a few pixels there. */
export const SAT_MIN_Z = 7.5;
const SAT_FADE_MS = 300;

/** Whole viewports per side of the camera whose areas are credited. */
const SAT_MOUNT_VIEWPORTS = 1;

function expanded(camera: Bounds, n: number): Bounds {
    const [w, s, e, no] = camera;
    const dx = (e - w) * n;
    const dy = (no - s) * n;
    return [w - dx, s - dy, e + dx, no + dy];
}

function ringsIntersect(rings: [number, number][][], b: Bounds): boolean {
    const xs = rings.flat().map((p) => p[0]);
    const ys = rings.flat().map((p) => p[1]);
    return Math.max(...xs) >= b[0] && Math.min(...xs) <= b[2] && Math.max(...ys) >= b[1] && Math.min(...ys) <= b[3];
}

export function createSatelliteMount(
    map: maplibregl.Map,
    insertBefore: string,
    /** `{source}` is each source's id */
    tiles: string,
): SatelliteMount {
    let disposed = false;
    let passes = 0;
    let ringed = "";
    let credits: string[] = [];
    // A record is final once current, so each is read once.
    const zoomOf = new Map<string, { z: number; source: string }>();
    const before = (): string | undefined => (map.getLayer(insertBefore) ? insertBefore : undefined);
    const urlOf = (id: string): string[] => [tiles.replace("{source}", id)];

    // One pyramid per source: its own zoom from disk, every zoom down to PHOTO_MIN_Z shrunk from those same tiles by the
    // protocol, so the patch is one shape at every zoom. tileSize 128 asks two zooms past the camera: sharp on a retina screen.
    for (const id of IDS) {
        const z = SATELLITE_SOURCES[id as keyof typeof SATELLITE_SOURCES].zoom;
        map.addSource(sourceId(id), { type: "raster", tiles: urlOf(id), tileSize: 128, minzoom: PHOTO_MIN_Z, maxzoom: z });
    }
    for (const id of SAT_LAYERS)
        map.addLayer({ id, type: "raster", source: id.slice(0, -2), paint: { "raster-fade-duration": SAT_FADE_MS } }, before());

    const drawEdge = (areas: { ring: [number, number][]; z: number }[]): void => {
        const data: GeoJSON.Feature = { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: heldEdge(areas) } };
        const source = map.getSource(SAT_EDGE_ID) as maplibregl.GeoJSONSource | undefined;
        if (source) return void source.setData(data);
        map.addSource(SAT_EDGE_ID, { type: "geojson", data });
        map.addLayer({ id: SAT_EDGE_ID, type: "line", source: SAT_EDGE_ID, minzoom: SAT_MIN_Z, paint: HELD_EDGE }, before());
    };

    return {
        tilesChanged(): void {
            if (disposed) return;
            for (const id of IDS) (map.getSource(sourceId(id)) as maplibregl.RasterTileSource | undefined)?.setTiles(urlOf(id));
        },
        async reconcile(camera: Bounds, sites: readonly PhotoSite[]): Promise<number> {
            const pass = ++passes;
            const near = expanded(camera, SAT_MOUNT_VIEWPORTS);
            await Promise.all(sites.filter((s) => !zoomOf.has(s.key)).map(async (s) => {
                const img = await getSatImageByKey(s.key);
                if (img) zoomOf.set(s.key, { z: img.zoom, source: img.source });
            }));
            // A newer pass has its own camera.
            if (disposed || pass !== passes) return 0;
            const held = sites.filter((s) => zoomOf.has(s.key));
            // Every held area, so a pan or zoom never redraws it: only a change in what is held does.
            const id = held.map((s) => s.key).sort().join("|");
            if (id !== ringed) {
                ringed = id;
                drawEdge(held.flatMap((s) => s.rings.map((ring) => ({ ring, z: zoomOf.get(s.key)!.z }))));
            }
            const shown = held.filter((s) => ringsIntersect(s.rings, near));
            credits = [...new Set(shown.map((s) => sourceNamed(zoomOf.get(s.key)!.source)?.attribution).filter((a): a is string => !!a))];
            return shown.length;
        },
        attributions: () => credits,
        dispose(): void {
            disposed = true;
            zoomOf.clear();
        },
    };
}
