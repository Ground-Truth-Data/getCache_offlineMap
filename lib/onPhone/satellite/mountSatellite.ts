// Pure: map and the area records only. Area selection stays with the caller.
import type * as maplibregl from "maplibre-gl";
import { coverTiles, getSatImageByKey, heldEdge, type Bounds } from "./satelliteImage";
import { SATELLITE_SOURCES, sourceNamed } from "../../contract/satelliteSources";
import { tileToLat, tileToLng } from "../../contract/geo";
import { getPhotoTiles } from "../../../routes/offlinev10/store";

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
const nearId = (id: string) => `v4-sat-${id}`;
/** Each source's close tiles, bottom to top. */
export const SAT_LAYERS = IDS.map((id) => `${nearId(id)}-l`);
/** Prefix of a piece's stitched image, the only photo drawn below its tiles' own zoom. */
export const SAT_PIECE = "v4-sat-piece-";
/** Pixels a tile gets in the stitch: it shows only while that tile is under 90 CSS px. */
const STITCH_PX = 128;
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
    const stitched = new Map<string, string>();
    const before = (): string | undefined => (map.getLayer(insertBefore) ? insertBefore : undefined);
    const urlOf = (id: string): string[] => [tiles.replace("{source}", id)];

    // tileSize is what picks the zoom MapLibre asks for, not the tiles' pixels: 128 asks two zooms past the camera, so a
    // z16 tile serves z13.5 on, overzoomed past it. Below that each piece is one image of the same tiles.
    for (const id of IDS) {
        const z = SATELLITE_SOURCES[id as keyof typeof SATELLITE_SOURCES].zoom;
        map.addSource(nearId(id), { type: "raster", tiles: urlOf(id), tileSize: 128, minzoom: z, maxzoom: z });
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

    // One ring's held tiles on a transparent canvas, corner to corner of its staircase: Web Mercator tiles are square to
    // the image, so the four tile corners place it exactly.
    const stitch = async (id: string, ring: [number, number][], z: number, sourceId: string): Promise<void> => {
        const cover = coverTiles(ring, z);
        const got = await getPhotoTiles(cover.map((t) => `${z}/${t.x}/${t.y}`), sourceId);
        const [x0, x1] = [Math.min(...cover.map((t) => t.x)), Math.max(...cover.map((t) => t.x)) + 1];
        const [y0, y1] = [Math.min(...cover.map((t) => t.y)), Math.max(...cover.map((t) => t.y)) + 1];
        const canvas = new OffscreenCanvas((x1 - x0) * STITCH_PX, (y1 - y0) * STITCH_PX);
        const g = canvas.getContext("2d")!;
        for (const t of cover) {
            const buf = got.get(`${z}/${t.x}/${t.y}`);
            if (buf?.byteLength) g.drawImage(await createImageBitmap(new Blob([buf])), (t.x - x0) * STITCH_PX, (t.y - y0) * STITCH_PX, STITCH_PX, STITCH_PX);
        }
        const url = URL.createObjectURL(await canvas.convertToBlob());
        if (disposed || map.getSource(id)) return URL.revokeObjectURL(url);
        stitched.set(id, url);
        const [w, e, n, s] = [tileToLng(x0, z), tileToLng(x1, z), tileToLat(y0, z), tileToLat(y1, z)];
        map.addSource(id, { type: "image", url, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
        // Hands over to the source's own tiles where they start, half a zoom past the two tileSize adds.
        map.addLayer({ id, type: "raster", source: id, maxzoom: z - 2.5, paint: { "raster-fade-duration": 0 } }, map.getLayer(SAT_EDGE_ID) ? SAT_EDGE_ID : before());
    };
    const unstitch = (id: string): void => {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
        URL.revokeObjectURL(stitched.get(id)!);
        stitched.delete(id);
    };

    return {
        tilesChanged(): void {
            if (disposed) return;
            for (const id of IDS) (map.getSource(nearId(id)) as maplibregl.RasterTileSource | undefined)?.setTiles(urlOf(id));
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
                const want = new Map(held.flatMap((s) => s.rings.map((ring, i): [string, { ring: [number, number][]; z: number; source: string }] => [`${SAT_PIECE}${s.key}-${i}`, { ring, ...zoomOf.get(s.key)! }])));
                for (const id of stitched.keys()) if (!want.has(id)) unstitch(id);
                await Promise.all([...want].filter(([id]) => !stitched.has(id)).map(([id, w]) =>
                    stitch(id, w.ring, w.z, IDS.find((s) => SATELLITE_SOURCES[s as keyof typeof SATELLITE_SOURCES].name === w.source)!).catch((e) => console.warn(`[photos] ${id} not stitched`, e))));
            }
            const shown = held.filter((s) => ringsIntersect(s.rings, near));
            credits = [...new Set(shown.map((s) => sourceNamed(zoomOf.get(s.key)!.source)?.attribution).filter((a): a is string => !!a))];
            return shown.length;
        },
        attributions: () => credits,
        dispose(): void {
            disposed = true;
            zoomOf.clear();
            for (const url of stitched.values()) URL.revokeObjectURL(url);
            stitched.clear();
        },
    };
}
