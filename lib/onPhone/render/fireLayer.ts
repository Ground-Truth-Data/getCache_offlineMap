/** The offline map's fire renderer. Paints what the bake stored; never fetches. */
import maplibregl from "maplibre-gl";
import fireIconUrl from "../../assets/fire_icon.webp";
import fireIntensity1 from "../../assets/fire_intensity/1-fire_intensity.webp";
import fireIntensity2 from "../../assets/fire_intensity/2-fire_intensity.webp";
import fireIntensity3 from "../../assets/fire_intensity/3-fire_intensity.webp";
import fireIntensity4 from "../../assets/fire_intensity/4-fire_intensity.webp";
import fireIntensity5 from "../../assets/fire_intensity/5-fire_intensity.webp";

import {
    fireEntriesNear,
    hotspotsToGeoJSON,
    unionHotspots,
} from "../../../routes/fires/fireCache";
import { peekUrbanVerdict } from "../../../routes/fires/fireClassifyCache";
import {
    buildClusterCard,
    buildHotspotCard,
    type CardRow,
} from "../../../routes/fires/fireHotspotCopy";
import { fireOutlines } from "../../../routes/fires/fireOutline";
import {
    distKm,
    fireFeatureCollection,
    HARD_CUTOFF_KM,
} from "../../../routes/fires/fireRelevance";
import type { TrendBand } from "../../../routes/fires/fireSeverity";
import {
    peekPlaces,
    setPlacesRegion,
    warmPlaces,
} from "../../places/placeIndex";
import { placeReference } from "../../places/placeReference";
import {
    peekStaticMask,
    warmStaticMask,
} from "../../../routes/fires/masks/staticHeatIndex";
import { isStaticSource } from "../../../routes/fires/masks/staticHeatSources";
import {
    FIRE_CLUSTER_MAX_ZOOM,
    FIRE_OUTLINE_MIN_ZOOM,
    FIRE_CLUSTER_RADIUS,
} from "../../../routes/fires/fireDials";

export const FIRE_LAYER_IDS = {
    src: "v4-fire-geo",
    cluster: "v4-fire-cluster",
    clusterIcon: "v4-fire-cluster-count",
    flame: "v4-fire-flame-single",
    outlineSrc: "v4-fire-outline-geo",
    outline: "v4-fire-outline",
} as const;

export const FIRE_LAYER_ID_LIST: readonly string[] = [
    FIRE_LAYER_IDS.cluster,
    FIRE_LAYER_IDS.clusterIcon,
    FIRE_LAYER_IDS.flame,
    FIRE_LAYER_IDS.outline,
];

// Terracotta, never red: red is the destructive-action colour.
const FIRE_DOT = "#b36940";
const FIRE_HOT = "#d18a5e";
const FIRE_ICON = "rt-fire-flame";

const EMPTY: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [],
};

export interface FireLayerHandle {
    (): void;
    repaint(): void;
}

export interface FireLayerOptions {
    /** Pin anchors and live fix; relevance is measured from these, never the screen box. */
    readonly origins?: () => readonly (readonly [number, number])[];
}

// Decoded before any layer can ask for it: MapLibre warns in the same tick
// as `styleimagemissing`. Lazy because `Image` is absent in SSR.
let flame: HTMLImageElement | null = null;
let flameLoad: Promise<void> | null = null;
function flameDecoded(): Promise<void> {
    flameLoad ??= (async () => {
        const img = new Image();
        img.src = fireIconUrl;
        try {
            await img.decode();
            flame = img;
        } catch (err) {
            console.warn(
                "[fire] flame icon failed to load — single detections will NOT render (clusters still will)",
                err,
            );
        }
    })();
    return flameLoad;
}

function ensureFireIcon(map: maplibregl.Map): void {
    if (flame && !map.hasImage(FIRE_ICON)) map.addImage(FIRE_ICON, flame);
}

function addFireLayers(map: maplibregl.Map): void {
    ensureFireIcon(map);
    if (map.getSource(FIRE_LAYER_IDS.src)) return;

    // Outline first so it sits under the flames; its own source so it is never clustered.
    map.addSource(FIRE_LAYER_IDS.outlineSrc, { type: "geojson", data: EMPTY });
    map.addLayer({
        id: FIRE_LAYER_IDS.outline,
        type: "line",
        source: FIRE_LAYER_IDS.outlineSrc,
        minzoom: FIRE_OUTLINE_MIN_ZOOM,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
            // The one sanctioned red: every wildfire agency draws a boundary in it.
            "line-color": "#d9422b",
            "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                6,
                0.8,
                10,
                1.2,
                14,
                1.6,
            ],
            "line-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                FIRE_OUTLINE_MIN_ZOOM,
                0,
                FIRE_OUTLINE_MIN_ZOOM + 1,
                0.85,
            ],
        },
    });

    map.addSource(FIRE_LAYER_IDS.src, {
        type: "geojson",
        data: EMPTY,
        cluster: true,
        clusterRadius: FIRE_CLUSTER_RADIUS,
        clusterMaxZoom: FIRE_CLUSTER_MAX_ZOOM,
        clusterProperties: {
            // Max, never sum; industrial FRP excluded so a flare stack cannot colour the fire beside it.
            maxFrp: [
                "max",
                [
                    "case",
                    ["==", ["coalesce", ["get", "ind"], 0], 1],
                    0,
                    ["coalesce", ["get", "frp"], 0],
                ],
            ],
            indCount: ["+", ["coalesce", ["get", "ind"], 0]],
        },
    });

    map.addLayer({
        id: FIRE_LAYER_IDS.cluster,
        type: "circle",
        source: FIRE_LAYER_IDS.src,
        filter: ["has", "point_count"],
        paint: {
            "circle-color": [
                "interpolate",
                ["linear"],
                ["coalesce", ["get", "maxFrp"], 0],
                0,
                FIRE_DOT,
                200,
                FIRE_HOT,
            ],
            // Dimmed only when every member is an industrial heat source.
            "circle-opacity": [
                "case",
                [
                    ">=",
                    ["coalesce", ["get", "indCount"], 0],
                    ["get", "point_count"],
                ],
                0.2,
                0.5,
            ],
            "circle-radius": [
                "step",
                ["get", "point_count"],
                9,
                25,
                11,
                100,
                13,
                500,
                16,
            ],
            "circle-stroke-width": 1,
            "circle-stroke-color": "rgba(0,0,0,0.3)",
        },
    });

    // No count label: "1.8k" beside a flame reads as scale of disaster.
    map.addLayer({
        id: FIRE_LAYER_IDS.clusterIcon,
        type: "symbol",
        source: FIRE_LAYER_IDS.src,
        filter: ["has", "point_count"],
        layout: {
            "icon-image": FIRE_ICON,
            "icon-size": [
                "interpolate",
                ["linear"],
                ["get", "point_count"],
                2,
                0.075,
                50,
                0.095,
                500,
                0.12,
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
        },
    });

    // No minzoom and no fade: a hotspot either passed the gate or is not on the map.
    map.addLayer({
        id: FIRE_LAYER_IDS.flame,
        type: "symbol",
        source: FIRE_LAYER_IDS.src,
        filter: ["!", ["has", "point_count"]],
        layout: {
            "icon-image": FIRE_ICON,
            "icon-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                4,
                0.035,
                8,
                0.05,
                14,
                0.08,
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
        },
        paint: {
            "icon-opacity": [
                "case",
                ["==", ["coalesce", ["get", "ind"], 0], 1],
                0.35,
                1,
            ],
        },
    });
}

// Tap card styles: `.rt-fire-*` in rapper/gc/mobile.css, shared with the online map.

/** Newest `fetchedAt` among painted discs. */
let lastPingedAt: number | null = null;

function esc(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const INTENSITY_ICONS = [
    fireIntensity1,
    fireIntensity2,
    fireIntensity3,
    fireIntensity4,
    fireIntensity5,
];
function intensityIconSrc(level: number): string {
    const lvl = Math.min(5, Math.max(1, Math.round(level)));
    return INTENSITY_ICONS[lvl - 1];
}

// Red/green is a colourblind confusion pair, so the shape carries direction
// too and the Status row spells it out. Never drop the Status row.
const TREND_RED = "#e63329";
const TREND_GREEN = "#3fb95a";

function trendGlyph(trend: TrendBand | undefined): string {
    switch (trend) {
        case "growing":
            return `<svg width="18" height="18" viewBox="0 0 18 18"><polygon points="9,2.5 2,14 16,14" fill="${TREND_RED}"/></svg>`;
        case "quieter":
            return `<svg width="18" height="18" viewBox="0 0 18 18"><polygon points="9,15.5 2,4 16,4" fill="${TREND_GREEN}"/></svg>`;
        case "steady":
            return `<svg width="18" height="18" viewBox="0 0 18 18"><rect x="3" y="8" width="12" height="2.4" rx="1.2" fill="rgba(255,255,255,0.65)"/></svg>`;
        default:
            return `<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="2.6" fill="rgba(255,255,255,0.4)"/></svg>`;
    }
}

function intensityGlyph(level: number, trend: TrendBand | undefined): string {
    return (
        `<img class="rt-fire-ring" src="${intensityIconSrc(level)}" alt="" aria-hidden="true" decoding="async"/>` +
        `<span class="rt-fire-trend" aria-hidden="true">${trendGlyph(trend)}</span>`
    );
}

function cardHtml(title: string, rows: readonly CardRow[]): string {
    const body = rows
        .map((r) => {
            const glyph =
                r.level === undefined ? "" : intensityGlyph(r.level, r.trend);
            return `<div class="rt-fire-row"><span class="rt-fire-k">${esc(r.label)}</span><span class="rt-fire-v">${esc(r.value)}${glyph}</span></div>`;
        })
        .join("");
    return `<div class="rt-fire-card"><h4>${esc(title)}</h4>${body}</div>`;
}

// Only if the gazetteer is already warm: a tap must never wait on a 5 MB fetch.
function whereFor(at: [number, number]): string | null {
    const places = peekPlaces();
    if (places === null || places.length === 0) return null;
    const ref = placeReference(at, places);
    return ref.primary === null ? null : ref.text;
}

function anchorNearest(
    origins: readonly (readonly [number, number])[],
    at: readonly [number, number],
): readonly [number, number] | null {
    let best: readonly [number, number] | null = null;
    let bestKm = Number.POSITIVE_INFINITY;
    for (const a of origins) {
        const km = distKm(a, at);
        if (km < bestKm) {
            bestKm = km;
            best = a;
        }
    }
    return best;
}

// Diagonal anchors keep ~0 gap: the dotted trail (`.rt-fire-popup::after`) cannot be drawn at 45°.
const FIRE_POPUP_OFFSET = 16;
const firePopupOptions: maplibregl.PopupOptions = {
    closeButton: true,
    maxWidth: "280px",
    className: "rt-fire-popup",
    offset: {
        top: [0, FIRE_POPUP_OFFSET],
        bottom: [0, -FIRE_POPUP_OFFSET],
        left: [FIRE_POPUP_OFFSET, 0],
        right: [-FIRE_POPUP_OFFSET, 0],
        "top-left": [2, 2],
        "top-right": [-2, 2],
        "bottom-left": [2, -2],
        "bottom-right": [-2, -2],
        center: [0, 0],
    },
};

// iOS WebView eats the first touch on a freshly-focused control as a focus
// gesture, so `click` never fires; `pointerup` does.
function wireCloseButton(popup: maplibregl.Popup): void {
    const btn = popup
        .getElement()
        ?.querySelector<HTMLButtonElement>(".maplibregl-popup-close-button");
    if (!btn) return;
    btn.blur();
    let closed = false;
    btn.addEventListener("pointerup", (e) => {
        if (closed) return;
        closed = true;
        e.preventDefault();
        e.stopPropagation();
        popup.remove();
    });
}

type FirePoint = {
    coordinates: [number, number];
    t: number;
    frp: number;
    px?: number;
};

function pointOf(
    props: Record<string, unknown> | null | undefined,
    coordinates: [number, number],
): FirePoint {
    const px = Number(props?.px);
    return {
        coordinates,
        t: Number(props?.t),
        frp: Number(props?.frp),
        px: Number.isFinite(px) ? px : undefined,
    };
}

/** Attach the fire layer; re-adds itself on style.load. The disposer also carries `.repaint()`. */
export function attachFireLayer(
    map: maplibregl.Map,
    opts: FireLayerOptions = {},
): FireLayerHandle {
    let disposed = false;
    warmStaticMask();

    const paint = async (): Promise<void> => {
        if (disposed) return;
        const c0 = map.getCenter();
        const own = opts.origins?.() ?? [];
        const origin: readonly (readonly [number, number])[] = own.length
            ? own
            : [[c0.lng, c0.lat]];
        const entries = await fireEntriesNear(origin, HARD_CUTOFF_KM);
        await flameDecoded();
        if (disposed) return;
        addFireLayers(map);
        const { hotspots: all } = unionHotspots(entries);
        lastPingedAt = entries.length
            ? entries.reduce((m, e) => Math.max(m, e.fetchedAt), 0)
            : null;
        setPlacesRegion([c0.lng, c0.lat]);
        warmPlaces();
        const { fc, shown } = fireFeatureCollection({
            hotspots: all,
            origin,
            now: Date.now(),
            staticMask: peekStaticMask(),
            toGeoJSON: hotspotsToGeoJSON,
            isStatic: isStaticSource,
            // Reads a cache, never classifies: unknown is shown.
            isUrban: (lng, lat) => peekUrbanVerdict(lng, lat) === true,
        });
        const src = map.getSource(FIRE_LAYER_IDS.src) as
            | maplibregl.GeoJSONSource
            | undefined;
        // Plain JSON across the GL worker boundary — $state proxies corrupt the transfer.
        src?.setData(
            JSON.parse(JSON.stringify(fc)) as GeoJSON.FeatureCollection,
        );
        const outlineSrc = map.getSource(FIRE_LAYER_IDS.outlineSrc) as
            | maplibregl.GeoJSONSource
            | undefined;
        // `all` is the memo key; the hull is built from `shown` so it matches the flames.
        outlineSrc?.setData(fireOutlines(shown, all));
    };

    const onStyle = (): void => void paint();
    map.on("style.load", onStyle);
    // MapLibre only accepts an image added synchronously inside this listener.
    const onMissing = (e: { id: string }): void => {
        if (e.id === FIRE_ICON) ensureFireIcon(map);
    };
    map.on("styleimagemissing", onMissing);
    void paint();

    // Tapping a cluster opens its summary, never a zoom.
    let popup: maplibregl.Popup | null = null;
    const open = (at: [number, number], html: string): void => {
        if (disposed) return;
        popup?.remove();
        popup = new maplibregl.Popup(firePopupOptions)
            .setLngLat(at)
            .setHTML(html)
            .addTo(map);
        wireCloseButton(popup);
    };
    const onFlame = (e: maplibregl.MapLayerMouseEvent): void => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const at = f.geometry.coordinates as [number, number];
        const card = buildHotspotCard(
            pointOf(f.properties, at),
            anchorNearest(opts.origins?.() ?? [], at),
            Date.now(),
            whereFor(at),
            Number(f.properties?.ind) === 1,
            lastPingedAt,
        );
        open(at, cardHtml(card.title, card.rows));
    };
    const onCluster = (e: maplibregl.MapLayerMouseEvent): void => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const centre = f.geometry.coordinates as [number, number];
        const clusterId = Number(f.properties?.cluster_id);
        const count = Number(f.properties?.point_count ?? 0);
        const src = map.getSource(FIRE_LAYER_IDS.src) as
            | maplibregl.GeoJSONSource
            | undefined;
        if (!Number.isFinite(clusterId) || !src) return;
        void src.getClusterLeaves(clusterId, count || 1000, 0).then(
            (leaves) => {
                if (disposed) return;
                const members = leaves
                    .filter((l) => l.geometry?.type === "Point")
                    .map((l) =>
                        pointOf(
                            l.properties,
                            (l.geometry as GeoJSON.Point).coordinates as [
                                number,
                                number,
                            ],
                        ),
                    );
                if (members.length === 0) return;
                // A mixed cluster is a fire that happens to include a flare.
                const mask = peekStaticMask();
                const allIndustrial = members.every((m) =>
                    isStaticSource(m.coordinates[0], m.coordinates[1], mask),
                );
                const card = buildClusterCard(
                    members,
                    centre,
                    anchorNearest(opts.origins?.() ?? [], centre),
                    Date.now(),
                    whereFor(centre),
                    allIndustrial,
                    lastPingedAt,
                );
                open(centre, cardHtml(card.title, card.rows));
            },
            (err) => {
                if (!disposed)
                    console.warn("[fire] could not read cluster members", err);
            },
        );
    };
    map.on("click", FIRE_LAYER_IDS.flame, onFlame);
    map.on("click", FIRE_LAYER_IDS.cluster, onCluster);
    map.on("click", FIRE_LAYER_IDS.clusterIcon, onCluster);

    const handle = (): void => {
        disposed = true;
        popup?.remove();
        map.off("click", FIRE_LAYER_IDS.flame, onFlame);
        map.off("click", FIRE_LAYER_IDS.cluster, onCluster);
        map.off("click", FIRE_LAYER_IDS.clusterIcon, onCluster);
        map.off("style.load", onStyle);
        map.off("styleimagemissing", onMissing);
    };
    handle.repaint = (): void => void paint();
    return handle as FireLayerHandle;
}
