import * as Sentry from "@sentry/sveltekit";
import type { Feature } from "geojson";
import type mapboxgl from "mapbox-gl";
import type { Map as MapboxMap } from "mapbox-gl";
import { getAreaLabelRects } from "$parent/siblings/getCache_OnlineMap/lib/areaLabels";
import { isFiniteCoord } from "$parent/siblings/getCache_OnlineMap/lib/safeMap";
// Pins render on BOTH Mapbox (online) and MapLibre (offline /mobile/offlinev4) — a Mapbox Marker attached to a MapLibre map throws and takes the whole map down.
// plotByGpsKey arrives via the optional ports.q704 — absent on hosts without inspections, so callers must optional-chain it.
import { markerCtor } from "../shared/rendererOf";
import {
    iconPath,
    parseEmojiPin,
    parsePinKey,
    pinAssetPath,
} from "../shared/icons";
import clusterPinUrl from "../assets/pin_library_small/pin_blank_emoji_sm.webp";
import clusterGlyphUrl from "../assets/pin_library_small/pin_default_sm.webp";
import { mount } from "svelte";
import type {
    MapHostPorts,
    MapHostStore as MapStore,
} from "../shared/mapHostPorts";
import { overlayVisibility } from "./overlayVisibility.svelte";

type PinMarker = { key: string; pinTypeKey: string; marker: mapboxgl.Marker };

// NATIVE Mapbox clustering (stock pattern): a GeoJSON source per kind w/ cluster:true; unclustered pins render as DOM markers, and WHICH ones are unclustered is read back via querySourceFeatures so the two views can never disagree.
const CLUSTER_SOURCE = "rt-pin-clusters";
const CLUSTER_LAYER = "rt-pin-clusters-circle";
const CLUSTER_COUNT_LAYER = "rt-pin-clusters-count";
const CLUSTER_ICON = "rt-cluster-pin";
// Plots cluster in their OWN source, so a plot and a pin standing close never
// merge into each other: pins bubble as a teardrop, plots as a mega plaque —
// the plot pin's black-and-gold square, bigger, with the count where the
// number goes.
const PLOT_CLUSTER_SOURCE = "rt-plot-clusters";
const PLOT_CLUSTER_LAYER = "rt-plot-clusters-plaque";
const PLOT_CLUSTER_COUNT_LAYER = "rt-plot-clusters-count";
const PLOT_CLUSTER_PCT_LAYER = "rt-plot-clusters-pct";
const PLOT_CLUSTER_ICON = "rt-cluster-plaque";
const PLOT_PLAQUE = { w: 40, h: 34, radius: 8, border: 2 }; // CSS px
const PLOT_CLUSTER_COUNT_SIZE = 14;
// Two stacked lines inside the plaque: how many plots, and how good they are.
// The count keeps the gold it always had; the % wears its band colour, so the
// plaque answers "is this block in trouble" before it is ever tapped.
const PLOT_CLUSTER_COUNT_DY = -6; // CSS px from the plaque's centre
const PLOT_CLUSTER_PCT_SIZE = 11;
const PLOT_CLUSTER_PCT_DY = 8;
// Home slots. A plot bubble and a pin bubble on the same spot would stack, so
// plots sit just LEFT of the point and pins just RIGHT, shoulder to shoulder
// with the coordinate between them. A bubble marks an area, not a spot, so
// the half-width shift costs nothing. CSS px at the point.
const PLOT_SLOT_X = -(PLOT_PLAQUE.w / 2) - 1;
const PIN_SLOT_X = 16;
// The plaque wears the plot pin's ears, summed: each ear counts the member
// plots with that condition. Same order and colours as StatusDots.svelte —
// under hugs the corner, the others fan left, absent ears close the gap.
const PLOT_EARS = [
    { key: "under", icon: "rt-ear-under", cssVar: "--rt-q704-under", fallback: "#ec6c9c", glyph: "\u2212" },
    { key: "over", icon: "rt-ear-over", cssVar: "--rt-q704-over", fallback: "#3fb6c8", glyph: "+" },
    { key: "fault", icon: "rt-ear-fault", cssVar: "--rt-q704-fault", fallback: "#f0463a", glyph: "" },
] as const;
const PLOT_EAR = { d: 14, ring: 1.25, gap: 2.5, textSize: 9 }; // CSS px
// Ear centre for the corner slot, relative to the plaque's centre: perched
// above-and-outside the top-right corner like the DOM ears.
const PLOT_EAR_X0 = PLOT_SLOT_X + PLOT_PLAQUE.w / 2 - PLOT_EAR.d / 2 + 2;
const PLOT_EAR_Y = -(PLOT_PLAQUE.h / 2) - PLOT_EAR.d / 2 + 3;
type Expr = mapboxgl.ExpressionSpecification;
// Slot = how many earlier ears this cluster shows; `scale` converts px to the
// property's unit (1 for icon-offset, text-size for text-offset ems).
function earOffset(i: number, scale: number): Expr {
    const at = (slot: number): Expr => [
        "literal",
        [(PLOT_EAR_X0 - slot * (PLOT_EAR.d + PLOT_EAR.gap)) / scale, PLOT_EAR_Y / scale],
    ];
    if (i === 0) return at(0);
    const slot: Expr = [
        "+",
        0,
        ...PLOT_EARS.slice(0, i).map((e): Expr => ["case", [">", ["get", e.key], 0], 1, 0]),
    ];
    return ["case", ["==", slot, 0], at(0), ["==", slot, 1], at(1), at(2)];
}

// A cluster is a blank pin of the app's own art with the count in gold, at the
// 30×40 the DOM pins wear (MapDrawControls' .map-pin-marker) — it reads as
// "pins here", not a coin. 300×420 source → 30×42 CSS px at this ratio.
const CLUSTER_PIN_SRC = clusterPinUrl;
const CLUSTER_PIN_PIXEL_RATIO = 10;
// Where the count sits: the head of the pin, in ems of CLUSTER_COUNT_SIZE above the point.
const CLUSTER_COUNT_SIZE = 13;
const CLUSTER_COUNT_OFFSET_EM = -2.05;

// A small pin beside the count: the count says how many, the pin says of
// what. The two share the head like characters — count left, pin right,
// both further out at two digits — and the head holds three, so from 100 up
// the pin goes and the number takes the head alone.
const CLUSTER_GLYPH_LAYER = "rt-pin-clusters-glyph";
const CLUSTER_GLYPH_ICON = "rt-cluster-glyph";
const CLUSTER_GLYPH_SRC = clusterGlyphUrl;
const CLUSTER_GLYPH_INK_H = 10; // px on screen, about the count's height
const CLUSTER_GLYPH_DY = 1; // px the pin sits below the count's centre
const CLUSTER_GLYPH_MAX = 99; // last count that still gets the pin
const CLUSTER_GLYPH_GAP = 3; // px between count and pin
const CLUSTER_DIGIT_PX = 7.4; // one digit's width at CLUSTER_COUNT_SIZE
// The art is 630×859 with the ink in a 413×584 box, centred 3.5 px right and
// 16.5 px above the frame's centre; at this ratio the frame is 30 CSS px
// wide at icon-size 1.
const CLUSTER_GLYPH_PIXEL_RATIO = 21;
const CLUSTER_GLYPH_INK = { w: 19.67, h: 27.8, cx: 0.17, cy: -0.79 };
const CLUSTER_GLYPH_SIZE = CLUSTER_GLYPH_INK_H / CLUSTER_GLYPH_INK.h;
const CLUSTER_GLYPH_W = CLUSTER_GLYPH_INK.w * CLUSTER_GLYPH_SIZE;
// The pair (count + gap + pin) is centred on the head, so the count moves
// left by half of what sits to its right — the same shift for 1 or 2 digits.
const CLUSTER_COUNT_X_EM = PIN_SLOT_X / CLUSTER_COUNT_SIZE;
const CLUSTER_COUNT_PAIRED_X_EM =
    CLUSTER_COUNT_X_EM - (CLUSTER_GLYPH_GAP + CLUSTER_GLYPH_W) / 2 / CLUSTER_COUNT_SIZE;
// icon-offset is scaled by icon-size, so divide the CSS px through; the ink
// correction is already in icon-size units.
const clusterGlyphOffset = (digits: number): [number, number] => [
    (PIN_SLOT_X + (digits * CLUSTER_DIGIT_PX + CLUSTER_GLYPH_GAP) / 2) / CLUSTER_GLYPH_SIZE -
        CLUSTER_GLYPH_INK.cx,
    (CLUSTER_COUNT_OFFSET_EM * CLUSTER_COUNT_SIZE + CLUSTER_GLYPH_DY) /
        CLUSTER_GLYPH_SIZE -
        CLUSTER_GLYPH_INK.cy,
];

// When two pins become one. Mapbox clusters on the integer zoom below the
// one on screen, so this radius reads as anything from 1× to 2× on screen:
// the pin art is ~29 px wide, and 15 lets pins nearly touch before they merge.
const CLUSTER_RADIUS = 15;
// Plots are what a surveyor came to see, so they merge LATE: at 20 they get
// to one or two body widths apart on screen before joining. Two merged
// plaques can brush at the half zooms between splits; that is the trade.
const PLOT_CLUSTER_RADIUS = 20;
const clusterImagesLoading = new WeakMap<MapboxMap, Set<string>>();
// The sprite atlas has no mipmaps: a 300 px source drawn at 30 px is sampled
// one pixel in ten and reads as jaggies. Halve on a canvas down to the size
// the screen will show, so the atlas draws the bitmap 1:1.
function shrinkForScreen(
    img: HTMLImageElement,
    pixelRatio: number,
    iconSize: number,
): { image: ImageData; pixelRatio: number } | null {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round((img.naturalWidth / pixelRatio) * iconSize * dpr));
    const h = Math.max(1, Math.round((img.naturalHeight / pixelRatio) * iconSize * dpr));
    let src: CanvasImageSource = img;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    while (sw / 2 >= w && sh / 2 >= h) {
        const c = document.createElement("canvas");
        c.width = Math.round(sw / 2);
        c.height = Math.round(sh / 2);
        const g = c.getContext("2d");
        if (!g) return null;
        g.imageSmoothingQuality = "high";
        g.drawImage(src, 0, 0, c.width, c.height);
        src = c;
        sw = c.width;
        sh = c.height;
    }
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const g = out.getContext("2d");
    if (!g) return null;
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, w, h);
    // the layer's icon-size still applies on top, so it is folded into the ratio
    return { image: g.getImageData(0, 0, w, h), pixelRatio: dpr * iconSize };
}
function loadClusterImage(
    map: MapboxMap,
    id: string,
    src: string,
    pixelRatio: number,
    iconSize = 1,
): void {
    const loading = clusterImagesLoading.get(map) ?? new Set<string>();
    clusterImagesLoading.set(map, loading);
    if (map.hasImage(id) || loading.has(id)) return;
    loading.add(id);
    const img = new Image();
    img.onload = () => {
        loading.delete(id);
        // The map can be torn down before the image lands; hasImage on a removed map throws.
        try {
            if (map.hasImage(id)) return;
            const small = shrinkForScreen(img, pixelRatio, iconSize);
            if (small) map.addImage(id, small.image, { pixelRatio: small.pixelRatio });
            else map.addImage(id, img, { pixelRatio });
        } catch {
            /* map gone */
        }
    };
    img.onerror = () => loading.delete(id);
    img.src = src;
}
// Drawn, not an asset: two rounded rects come out crisp at any
// devicePixelRatio, where a shrunk webp reads as jaggies.
function makePlaqueImage(): { image: ImageData; pixelRatio: number } | null {
    const dpr = window.devicePixelRatio || 1;
    const { w, h, radius, border } = PLOT_PLAQUE;
    const c = document.createElement("canvas");
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext("2d");
    if (!g) return null;
    g.scale(dpr, dpr);
    const inset = border / 2;
    g.beginPath();
    g.roundRect(inset, inset, w - border, h - border, radius);
    g.fillStyle = "#1a1a1a";
    g.fill();
    g.lineWidth = border;
    g.strokeStyle = "#ffd700";
    g.stroke();
    return { image: g.getImageData(0, 0, c.width, c.height), pixelRatio: dpr };
}
// FS 704 planting quality: satisfactory trees over plantable spots, summed
// across the members — Σsat/Σspots, never a mean of per-plot percentages,
// which would let a 1-spot plot outvote a 20-spot one. `satisfactory` is the
// host's own identity (derivePlot: planted − excess − faults), rebuilt here
// from the port's fields because the port hands over the parts, not the total.
// The count above is gold, so no band may be gold — two gold lines in one
// plaque read as one number wrapped, not as "how many" over "how good".
const PLOT_QUALITY_BANDS = [
    { min: 90, color: "#3fb6c8" },
    { min: 75, color: "#e8e4d6" },
    { min: 0, color: "#ec6c9c" },
] as const;
// The bands as a step over the same Σsat/Σspots the label divides.
function pctBandColor(): Expr {
    const pct: Expr = ["*", 100, ["/", ["get", "sat"], ["get", "spots"]]];
    const out: unknown[] = ["case"];
    for (const b of PLOT_QUALITY_BANDS.slice(0, -1)) {
        out.push([">=", pct, b.min], b.color);
    }
    out.push(PLOT_QUALITY_BANDS[PLOT_QUALITY_BANDS.length - 1].color);
    return out as Expr;
}
function plotQuality(
    plot: { planted: number | null; spots: number | null; excess: number | null; faults: string[] } | null,
): { sat: number; spots: number } {
    const spots = plot?.spots ?? 0;
    if (!plot || spots <= 0 || plot.planted == null) return { sat: 0, spots: 0 };
    return {
        sat: Math.max(0, plot.planted - (plot.excess ?? 0) - plot.faults.length),
        spots,
    };
}
type PlotStatus = { under: boolean; over: boolean; fault: boolean };
// Matches PlotMapPopover's maths: rose '−' = under spot count, teal '+' = excess trees, red dot = quality fault — all independent, any combination.
function plotStatus(plot: { planted: number | null; spots: number | null; excess: number | null; faults: string[] } | null): PlotStatus {
    return {
        under: Math.max(0, (plot?.spots ?? 0) - (plot?.planted ?? 0)) > 0,
        over: (plot?.excess ?? 0) > 0,
        fault: (plot?.faults.length ?? 0) > 0,
    };
}
function makeEarImage(color: string): { image: ImageData; pixelRatio: number } | null {
    const dpr = window.devicePixelRatio || 1;
    const { d, ring } = PLOT_EAR;
    const size = d + ring * 2;
    const c = document.createElement("canvas");
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    const g = c.getContext("2d");
    if (!g) return null;
    g.scale(dpr, dpr);
    g.beginPath();
    g.arc(size / 2, size / 2, d / 2 + ring / 2, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = ring;
    g.strokeStyle = "#1a1a1a";
    g.stroke();
    return { image: g.getImageData(0, 0, c.width, c.height), pixelRatio: dpr };
}
function loadClusterPin(map: MapboxMap): void {
    loadClusterImage(map, CLUSTER_ICON, CLUSTER_PIN_SRC, CLUSTER_PIN_PIXEL_RATIO);
    loadClusterImage(map, CLUSTER_GLYPH_ICON, CLUSTER_GLYPH_SRC, CLUSTER_GLYPH_PIXEL_RATIO, CLUSTER_GLYPH_SIZE);
    if (!map.hasImage(PLOT_CLUSTER_ICON)) {
        const plaque = makePlaqueImage();
        if (plaque) map.addImage(PLOT_CLUSTER_ICON, plaque.image, { pixelRatio: plaque.pixelRatio });
    }
    for (const ear of PLOT_EARS) {
        if (map.hasImage(ear.icon)) continue;
        const color =
            getComputedStyle(document.documentElement).getPropertyValue(ear.cssVar).trim() ||
            ear.fallback;
        const img = makeEarImage(color);
        if (img) map.addImage(ear.icon, img.image, { pixelRatio: img.pixelRatio });
    }
}

// Captions are PINS ONLY — a plot's plaque number is its identity and it NEVER gets a name caption.
const PIN_CAPTION_MINZOOM = 13;

type Rect = { left: number; top: number; right: number; bottom: number };

function rectsOverlap(a: Rect, b: Rect): boolean {
    return (
        a.left < b.right &&
        b.left < a.right &&
        a.top < b.bottom &&
        b.top < a.bottom
    );
}

// Reported-offender memo so the audit logs each duplicate ONCE (sync() runs often).
const auditedDupes = new Set<string>();
// Scans live plot pins for two sharing the same plot number on the same survey (the "two 78s on one map" bug) — surfaces dupes already on disk; drop-time guards block new ones.
function auditDuplicatePlotPins(
    pins: (Feature & { geometry: GeoJSON.Point })[],
): void {
    const byKey = new Map<string, string[]>(); // "survey|plot:N" → [featureKeys]
    for (const p of pins) {
        const pinType = p.properties?.pinTypeKey as string | undefined;
        if (!pinType || !pinType.startsWith("plot:")) continue;
        const survey = (p.properties?.surveyKey as string | undefined) ?? "";
        const fkey = (p.properties?.mapFeatureKey as string | undefined) ?? "?";
        const id = `${survey}|${pinType}`;
        let group = byKey.get(id);
        if (!group) {
            group = [];
            byKey.set(id, group);
        }
        group.push(fkey);
    }
    for (const [id, keys] of byKey) {
        if (keys.length < 2 || auditedDupes.has(id)) continue;
        auditedDupes.add(id);
        const msg = `[markers] DUPLICATE PLOT PIN: ${keys.length} pins for "${id.split("|")[1]}" on survey "${id.split("|")[0] || "(none)"}" — features ${keys.join(", ")}. Two identical numbered pins on one map. Clean up one.`;
        console.error(msg);
        try {
            Sentry.captureException(new Error(msg), {
                tags: { area: "quality704", kind: "duplicate-pin-audit" },
            });
        } catch {} // codestyle-allow-swallow: Sentry may be uninitialised in tests/headless
    }
}

export interface PinMarkersDeps {
    getMap: () => MapboxMap | null;
    mapStore: MapStore;
    /** `ui.EmojiPin` mounts emoji pins; `q704?.plotByGpsKey` resolves a plot's live row — q704 is optional, a host without inspections gets the baked `plot:N` label and nothing throws. */
    ports: Pick<MapHostPorts, "ui" | "q704">;
    getOffline: () => boolean;
    /** mapFeatureKey of the selected feature (popover open), or null — drives the selected plot marker's gold "Plot N" pill. */
    getSelectedKey: () => string | null;
    popoverPos: { compute(feature: Feature): void };
    /** null clears the selection (tap the selected pin again to toggle off). */
    setSelectedIndex: (idx: number | null) => void;
    panPointToTop: (feat: Feature, opts?: { zoom?: number }) => void;
}

export interface PinMarkers {
    /** Run inside an `$effect` — its synchronous reads of mapStore drive reactivity. */
    sync(): void;
    /** Run in the map-wiring effect cleanup. */
    clear(): void;
}

export function createPinMarkers(deps: PinMarkersDeps): PinMarkers {
    const { getMap, mapStore, ports } = deps;
    // Anchor 'bottom' EVERY route — the pin art is a teardrop whose point IS the coordinate. (Was center-anchored on offline once, which put the GPS coord half a pin north of where online showed it.)
    const PIN_ANCHOR = "bottom" as const;
    let pinMarkers: PinMarker[] = [];

    // Pins most recently pushed into the clustered source — reconcileSingles builds DOM markers from these once the source reports which are unclustered.
    let lastPins: (Feature & { geometry: GeoJSON.Point })[] = [];
    // Pins that NEVER cluster: feature pins + the selected pin. Rebuilt every sync alongside lastPins.
    let forcedSingleKeys = new Set<string>();
    let handlersInstalled = false;

    // Coincident same-spot plot markers (repeat surveys/imports) would stack invisibly (only the top tappable) — collapsed into one badge-wearing representative that fans out on tap (screen-space offsets; coords never change).
    const STACK_DECIMALS = 6; // ~0.11 m — same-spot pins, never neighbours
    let expandedStack: string | null = null; // coordKey the user fanned open
    let stackByFeature = new Map<string, string>(); // featureKey → coordKey
    let openStacks = new Set<string>(); // coordKeys rendered fanned right now
    // A merged plot plaque the user opened in place. Its members are pulled
    // out of the bubble and fanned around the centre it was drawn at, WITHOUT
    // a zoom change — the camera stays where the surveyor put it.
    // Held by member keys, not cluster_id: ids are re-minted on every re-tile,
    // so an id would go stale the first time the map moved a pixel.
    let expandedCluster: { at: [number, number]; keys: Set<string> } | null = null;

    // getClusterLeaves is async and paged; ask for far more than a bubble can
    // hold so one call is always the whole membership.
    const EXPAND_MAX = 200;
    function expandCluster(
        src: mapboxgl.GeoJSONSource,
        clusterId: number,
        at: [number, number],
    ): void {
        src.getClusterLeaves(clusterId, EXPAND_MAX, 0, (err, leaves) => {
            if (err || !leaves) return;
            const keys = new Set<string>();
            for (const l of leaves) {
                const k = l.properties?.mapFeatureKey as string | undefined;
                if (k) keys.add(k);
            }
            if (keys.size < 2) return;
            expandedCluster = { at, keys };
            // sync() is what carries the `open` flag into the source, and only
            // that hides the bubble the members are stepping out of.
            sync();
        });
    }

    function setStackBadge(el: HTMLElement, n: number | null): void {
        const inner = el.querySelector(".map-pin-plot__inner");
        if (!inner) return;
        let badge = inner.querySelector<HTMLElement>(".map-pin-plot__stackn");
        if (n == null) {
            badge?.remove();
            return;
        }
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "map-pin-plot__stackn";
            inner.appendChild(badge);
        }
        badge.textContent = String(n);
    }

    function setStackLeg(el: HTMLElement, dx: number, dy: number | null): void {
        let leg = el.querySelector<HTMLElement>(".map-pin-stack-leg");
        if (dy == null) {
            leg?.remove();
            return;
        }
        if (!leg) {
            leg = document.createElement("span");
            leg.className = "map-pin-stack-leg";
            el.appendChild(leg);
        }
        leg.style.height = `${Math.round(Math.hypot(dx, dy))}px`;
        // Top-anchored div extends DOWN (0,1); CSS rotate is clockwise in screen coords, so pointing at (−dx,−dy) needs θ = atan2(dx,−dy).
        leg.style.transform = `rotate(${Math.atan2(dx, -dy)}rad)`;
    }

    function resetStackStyling(pm: PinMarker): void {
        const el = pm.marker.getElement();
        if (
            !el.classList.contains("map-pin-plot--stack-rep") &&
            !el.classList.contains("map-pin-plot--stack-hidden") &&
            !el.classList.contains("map-pin-plot--stack-out")
        ) {
            return;
        }
        pm.marker.setOffset([0, 0]);
        el.classList.remove(
            "map-pin-plot--stack-rep",
            "map-pin-plot--stack-hidden",
            "map-pin-plot--stack-out",
        );
        setStackBadge(el, null);
        setStackLeg(el, 0, null);
    }

    // An opened plaque's members sit at their REAL coordinates, which at this
    // zoom are a few pixels apart — the reason they merged. Fan them onto a
    // ring around the bubble's centre so each is separately readable and
    // tappable, with a leg back to where it truly is. Screen-space offsets
    // only: no coordinate is ever moved, so nothing here can corrupt data.
    function layoutExpandedCluster(map: MapboxMap): void {
        if (!expandedCluster) return;
        const members = pinMarkers.filter((pm) => expandedCluster?.keys.has(pm.key));
        if (members.length < 2) return;
        const origin = map.project(expandedCluster.at);
        const n = members.length;
        const R = Math.min(90, 34 + n * 6);
        // Order the ring by each member's true bearing from the centre, so a
        // plot ends up on the side of the fan it actually lies on and the legs
        // never cross. Sorted by bearing rather than key: a fan whose legs
        // cross tells the surveyor the wrong thing about where a plot is.
        const withAngle = members.map((pm) => {
            const here = map.project(pm.marker.getLngLat());
            return { pm, here, bearing: Math.atan2(here.y - origin.y, here.x - origin.x) };
        });
        withAngle.sort((a, b) =>
            a.bearing === b.bearing ? (a.pm.key < b.pm.key ? -1 : 1) : a.bearing - b.bearing,
        );
        withAngle.forEach(({ pm, here }, i) => {
            const el = pm.marker.getElement();
            const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
            // The member's own pixel position is the anchor the offset is
            // measured FROM, so every member lands ON the ring regardless of
            // how near the centre it truly sits — the one at the centre would
            // otherwise stay there, buried under the legs.
            const dx = Math.round(origin.x + R * Math.cos(ang) - here.x);
            const dy = Math.round(origin.y + R * Math.sin(ang) - here.y);
            pm.marker.setOffset([dx, dy]);
            el.classList.remove(
                "map-pin-plot--stack-rep",
                "map-pin-plot--stack-hidden",
            );
            el.classList.add("map-pin-plot--stack-out");
            setStackBadge(el, null);
            setStackLeg(el, dx, dy);
        });
    }

    // Groups plot markers by exact coordinate → collapsed (badge rep) or fanned (offset circle + leg); runs every reconcile so zoom/cluster churn never leaves a stale fan.
    function layoutStacks(selKey: string | null): void {
        const groups = new Map<string, PinMarker[]>();
        for (const pm of pinMarkers) {
            if (!pm.pinTypeKey.startsWith("plot:")) continue;
            // A member of an opened plaque is laid out by the cluster fan; letting
            // the coincidence fan claim it too would leave two offsets fighting.
            if (expandedCluster?.keys.has(pm.key)) continue;
            const ll = pm.marker.getLngLat();
            const ck = `${ll.lng.toFixed(STACK_DECIMALS)},${ll.lat.toFixed(STACK_DECIMALS)}`;
            const arr = groups.get(ck);
            if (arr) arr.push(pm);
            else groups.set(ck, [pm]);
        }
        stackByFeature = new Map();
        openStacks = new Set();
        if (expandedStack && (groups.get(expandedStack)?.length ?? 0) < 2) {
            expandedStack = null; // the stack dissolved (zoom-out, delete, move)
        }
        for (const [ck, members] of groups) {
            if (members.length < 2) {
                const only = members[0];
                if (only) resetStackStyling(only);
                continue;
            }
            // Stable fan order — keyed sort so angles never shuffle between frames.
            members.sort((a, b) => (a.key < b.key ? -1 : 1));
            for (const pm of members) stackByFeature.set(pm.key, ck);
            // The selected pin forces its stack open — a selection must never sit hidden under a representative.
            const expanded =
                expandedStack === ck || members.some((m) => m.key === selKey);
            if (expanded) openStacks.add(ck);
            const n = members.length;
            members.forEach((pm, i) => {
                const el = pm.marker.getElement();
                if (!expanded) {
                    pm.marker.setOffset([0, 0]);
                    const isRep = i === 0;
                    el.classList.toggle("map-pin-plot--stack-rep", isRep);
                    el.classList.toggle("map-pin-plot--stack-hidden", !isRep);
                    el.classList.remove("map-pin-plot--stack-out");
                    setStackBadge(el, isRep ? n : null);
                    setStackLeg(el, 0, null);
                } else {
                    const R = n <= 4 ? 36 : Math.min(70, 24 + n * 5);
                    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
                    const dx = Math.round(R * Math.cos(ang));
                    const dy = Math.round(R * Math.sin(ang));
                    pm.marker.setOffset([dx, dy]);
                    el.classList.remove(
                        "map-pin-plot--stack-rep",
                        "map-pin-plot--stack-hidden",
                    );
                    el.classList.add("map-pin-plot--stack-out");
                    setStackBadge(el, null);
                    setStackLeg(el, dx, dy);
                }
            });
        }
    }

    // Skip-if-already-on-top guard is required — moveLayer fires styledata itself, so without it this becomes an infinite loop when called from styledata.
    const CLUSTER_STACK = [
        CLUSTER_LAYER,
        CLUSTER_COUNT_LAYER,
        CLUSTER_GLYPH_LAYER,
        PLOT_CLUSTER_LAYER,
        PLOT_CLUSTER_COUNT_LAYER,
        PLOT_CLUSTER_PCT_LAYER,
        ...PLOT_EARS.map((e) => `${PLOT_CLUSTER_SOURCE}-ear-${e.key}`),
    ];
    function hoistClusterLayers(map: MapboxMap): void {
        if (CLUSTER_STACK.some((id) => !map.getLayer(id))) return;
        const ids = map.getStyle()?.layers?.map((l) => l.id) ?? [];
        const top = ids.slice(-CLUSTER_STACK.length);
        if (CLUSTER_STACK.every((id, i) => top[i] === id)) {
            return; // already on top — do NOT re-move (styledata loop guard)
        }
        for (const id of CLUSTER_STACK) map.moveLayer(id);
    }

    // The opened bubble must not sit on top of the plots it just released.
    // The members carry an `open` flag (sync stamps it) which the cluster SUMS
    // like the ears do, so the bubble holding them can recognise itself with
    // no position match and no cluster_id — ids are re-minted on every re-tile,
    // so anything keyed to one would flash the plaque back mid-pan.
    const PLAQUE_LAYERS = () => [
        PLOT_CLUSTER_LAYER,
        PLOT_CLUSTER_COUNT_LAYER,
        PLOT_CLUSTER_PCT_LAYER,
        ...PLOT_EARS.map((e) => `${PLOT_CLUSTER_SOURCE}-ear-${e.key}`),
    ];

    // Idempotent — setStyle (basemap swap) wipes all custom sources/layers, so this must re-run and re-create them every sync.
    function ensureClusterLayers(map: MapboxMap): void {
        for (const id of [CLUSTER_SOURCE, PLOT_CLUSTER_SOURCE]) {
            if (map.getSource(id)) continue;
            map.addSource(id, {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
                cluster: true,
                clusterMaxZoom: 14,
                clusterRadius: id === PLOT_CLUSTER_SOURCE ? PLOT_CLUSTER_RADIUS : CLUSTER_RADIUS,
                // Each plot carries its ears as 0/1 (sync stamps them); the cluster sums them into "how many members have this".
                // sat/spots sum the same way, and the plaque divides them — summing the two terms and dividing ONCE is what makes the merged % a true weighted quality rather than an average of averages.
                ...(id === PLOT_CLUSTER_SOURCE && {
                    clusterProperties: {
                        ...Object.fromEntries(
                            PLOT_EARS.map((e) => [e.key, ["+", ["get", e.key]]]),
                        ),
                        sat: ["+", ["get", "sat"]],
                        spots: ["+", ["get", "spots"]],
                        open: ["+", ["get", "open"]],
                    },
                }),
            });
        }
        // setStyle wipes custom images too — loadClusterPin re-checks hasImage, so this stays idempotent like the layer adds below.
        loadClusterPin(map);
        if (!map.getLayer(CLUSTER_LAYER)) {
            map.addLayer({
                id: CLUSTER_LAYER,
                type: "symbol",
                source: CLUSTER_SOURCE,
                filter: ["has", "point_count"],
                layout: {
                    // ONE fixed size, must NOT grow with count — graduated sizes previously ballooned busy blocks into a wall of fat coins.
                    "icon-image": CLUSTER_ICON,
                    "icon-anchor": "bottom",
                    "icon-offset": [PIN_SLOT_X, 0],
                    "icon-allow-overlap": true,
                },
            });
        }
        if (!map.getLayer(CLUSTER_COUNT_LAYER)) {
            map.addLayer({
                id: CLUSTER_COUNT_LAYER,
                type: "symbol",
                source: CLUSTER_SOURCE,
                filter: ["has", "point_count"],
                layout: {
                    "text-field": ["get", "point_count_abbreviated"],
                    // Font must exist in the CURRENT style's glyph endpoint — offline only bundles "Noto Sans Regular"; requesting DIN Pro there 404s and the count silently never renders (blank gold coins).
                    "text-font": deps.getOffline()
                        ? ["Noto Sans Regular"]
                        : ["DIN Pro Bold", "Arial Unicode MS Bold"],
                    "text-size": CLUSTER_COUNT_SIZE,
                    "text-offset": [
                        "case",
                        ["<=", ["get", "point_count"], CLUSTER_GLYPH_MAX],
                        ["literal", [CLUSTER_COUNT_PAIRED_X_EM, CLUSTER_COUNT_OFFSET_EM]],
                        ["literal", [CLUSTER_COUNT_X_EM, CLUSTER_COUNT_OFFSET_EM]],
                    ],
                    "text-allow-overlap": true,
                },
                paint: {
                    "text-color": "#f0c040",
                    "text-halo-color": "rgba(0, 0, 0, 0.9)",
                    "text-halo-width": 0.8,
                },
            });
        }
        if (!map.getLayer(CLUSTER_GLYPH_LAYER)) {
            map.addLayer({
                id: CLUSTER_GLYPH_LAYER,
                type: "symbol",
                source: CLUSTER_SOURCE,
                filter: [
                    "all",
                    ["has", "point_count"],
                    ["<=", ["get", "point_count"], CLUSTER_GLYPH_MAX],
                ],
                layout: {
                    "icon-image": CLUSTER_GLYPH_ICON,
                    "icon-size": CLUSTER_GLYPH_SIZE,
                    "icon-anchor": "center",
                    "icon-offset": [
                        "case",
                        ["<", ["get", "point_count"], 10],
                        ["literal", clusterGlyphOffset(1)],
                        ["literal", clusterGlyphOffset(2)],
                    ],
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true,
                },
            });
        }
        if (!map.getLayer(PLOT_CLUSTER_LAYER)) {
            map.addLayer({
                id: PLOT_CLUSTER_LAYER,
                type: "symbol",
                source: PLOT_CLUSTER_SOURCE,
                filter: ["all", ["has", "point_count"], ["==", ["get", "open"], 0]],
                layout: {
                    "icon-image": PLOT_CLUSTER_ICON,
                    "icon-anchor": "center",
                    "icon-offset": [PLOT_SLOT_X, 0],
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true,
                },
            });
        }
        if (!map.getLayer(PLOT_CLUSTER_COUNT_LAYER)) {
            map.addLayer({
                id: PLOT_CLUSTER_COUNT_LAYER,
                type: "symbol",
                source: PLOT_CLUSTER_SOURCE,
                filter: ["all", ["has", "point_count"], ["==", ["get", "open"], 0]],
                layout: {
                    "text-field": ["get", "point_count_abbreviated"],
                    "text-font": deps.getOffline()
                        ? ["Noto Sans Regular"]
                        : ["DIN Pro Bold", "Arial Unicode MS Bold"],
                    "text-size": PLOT_CLUSTER_COUNT_SIZE,
                    // Count rides high only when a % sits under it; a cluster of
                    // uncounted plots keeps the number centred rather than
                    // hanging over an empty half.
                    "text-offset": [
                        "case",
                        [">", ["get", "spots"], 0],
                        [
                            "literal",
                            [
                                PLOT_SLOT_X / PLOT_CLUSTER_COUNT_SIZE,
                                PLOT_CLUSTER_COUNT_DY / PLOT_CLUSTER_COUNT_SIZE,
                            ],
                        ],
                        ["literal", [PLOT_SLOT_X / PLOT_CLUSTER_COUNT_SIZE, 0]],
                    ],
                    "text-allow-overlap": true,
                    "text-ignore-placement": true,
                },
                paint: {
                    "text-color": "#ffd700",
                },
            });
        }
        if (!map.getLayer(PLOT_CLUSTER_PCT_LAYER)) {
            map.addLayer({
                id: PLOT_CLUSTER_PCT_LAYER,
                type: "symbol",
                source: PLOT_CLUSTER_SOURCE,
                // No spots = nothing counted yet in this bubble; a "0%" there
                // would read as a failed block rather than an unvisited one.
                filter: [
                    "all",
                    ["has", "point_count"],
                    ["==", ["get", "open"], 0],
                    [">", ["get", "spots"], 0],
                ],
                layout: {
                    // Whole numbers only — a decimal is false precision at this
                    // size, and the word "quality" never fits or belongs here.
                    "text-field": [
                        "concat",
                        ["to-string", ["round", ["*", 100, ["/", ["get", "sat"], ["get", "spots"]]]]],
                        "%",
                    ],
                    "text-font": deps.getOffline()
                        ? ["Noto Sans Regular"]
                        : ["DIN Pro Bold", "Arial Unicode MS Bold"],
                    "text-size": PLOT_CLUSTER_PCT_SIZE,
                    "text-offset": [
                        PLOT_SLOT_X / PLOT_CLUSTER_PCT_SIZE,
                        PLOT_CLUSTER_PCT_DY / PLOT_CLUSTER_PCT_SIZE,
                    ],
                    "text-allow-overlap": true,
                    "text-ignore-placement": true,
                },
                paint: {
                    "text-color": pctBandColor(),
                },
            });
        }
        PLOT_EARS.forEach((ear, i) => {
            const id = `${PLOT_CLUSTER_SOURCE}-ear-${ear.key}`;
            if (map.getLayer(id)) return;
            map.addLayer({
                id,
                type: "symbol",
                source: PLOT_CLUSTER_SOURCE,
                filter: [
                    "all",
                    ["has", "point_count"],
                    ["==", ["get", "open"], 0],
                    [">", ["get", ear.key], 0],
                ],
                layout: {
                    "icon-image": ear.icon,
                    "icon-anchor": "center",
                    "icon-offset": earOffset(i, 1),
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true,
                    "text-field": ["concat", ear.glyph, ["to-string", ["get", ear.key]]],
                    "text-font": deps.getOffline()
                        ? ["Noto Sans Regular"]
                        : ["DIN Pro Bold", "Arial Unicode MS Bold"],
                    "text-size": PLOT_EAR.textSize,
                    "text-offset": earOffset(i, PLOT_EAR.textSize),
                    "text-allow-overlap": true,
                    "text-ignore-placement": true,
                },
                paint: {
                    "text-color": "#1a1a1a",
                },
            });
        });
        hoistClusterLayers(map);
        if (!handlersInstalled) {
            handlersInstalled = true;
            // Re-hoist on every styledata (not just once) — other installers (grid, draw layers, overlays) add layers whenever THEY like, and a layer added after our last hoist paints over the bubbles.
            map.on("styledata", () => hoistClusterLayers(map));
            // Tap a bubble → pins ease to the zoom where it splits (stock
            // behaviour); PLOTS open in place instead. A surveyor tapping a
            // merged plaque wants to see which plots are in it, not to lose
            // the frame they had — expanding keeps the camera exactly where
            // they put it and fans the members around the bubble.
            for (const [layerId, sourceId] of [
                [CLUSTER_LAYER, CLUSTER_SOURCE],
                [PLOT_CLUSTER_LAYER, PLOT_CLUSTER_SOURCE],
            ] as const) {
                map.on("click", layerId, (e) => {
                    const f = map.queryRenderedFeatures(e.point, {
                        layers: [layerId],
                    })[0];
                    const clusterId = f?.properties?.cluster_id as number | undefined;
                    const src = map.getSource(sourceId) as
                        | mapboxgl.GeoJSONSource
                        | undefined;
                    if (clusterId == null || !src) return;
                    const center = (f.geometry as GeoJSON.Point).coordinates as [
                        number,
                        number,
                    ];
                    if (sourceId === PLOT_CLUSTER_SOURCE) {
                        if (!isFiniteCoord(center as unknown)) return;
                        expandCluster(src, clusterId, center);
                        return;
                    }
                    src.getClusterExpansionZoom(clusterId, (err, zoom) => {
                        if (err || zoom == null) return;
                        if (!isFiniteCoord(center as unknown)) return;
                        map.easeTo({ center, zoom });
                    });
                });
                map.on("mouseenter", layerId, () => {
                    map.getCanvas().style.cursor = "pointer";
                });
                map.on("mouseleave", layerId, () => {
                    map.getCanvas().style.cursor = "";
                });
            }
            // Tap the open map → fold any fanned stack or expanded cluster back up; marker taps stopPropagation so they never reach this handler.
            map.on("click", () => {
                if (expandedStack || expandedCluster) {
                    const wasExpanded = expandedCluster !== null;
                    expandedStack = null;
                    expandedCluster = null;
                    // Closing must clear the `open` flag too, or the bubble the
                    // members fold back into stays hidden.
                    if (wasExpanded) sync();
                    else reconcileSingles();
                }
            });
            // Coalesced to ONE run per animation frame — sourcedata fires PER TILE (dozens of times during a pan), and querySourceFeatures is expensive; the unclustered set only needs to be right once, at the end of the burst.
            let reconcileRaf = 0;
            const scheduleReconcile = () => {
                if (reconcileRaf) return; // already queued for this frame
                reconcileRaf = requestAnimationFrame(() => {
                    reconcileRaf = 0;
                    reconcileSingles();
                });
            };
            map.on("sourcedata", (e) => {
                if (
                    (e.sourceId === CLUSTER_SOURCE || e.sourceId === PLOT_CLUSTER_SOURCE) &&
                    e.isSourceLoaded
                ) {
                    scheduleReconcile();
                }
            });
        }
    }

    function buildPinElement(featureKey: string, pinTypeKey: string): HTMLElement {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "map-pin-marker";
        btn.dataset.featureKey = featureKey;
        btn.setAttribute("aria-label", "Pin");
        // Quality-plot marker (`plot:N`) is built here, not from the icon registry — the number is dynamic.
        if (pinTypeKey.startsWith("plot:")) {
            // The baked `plot:N` is only a first-paint placeholder — sync() overwrites `.map-pin-plot__num` with the derived per-map rank (plot.displayNo) same frame; never treat this as the real number.
            const n = pinTypeKey.slice(5);
            btn.classList.add("map-pin-plot");
            // Built as an innerHTML string, but MUST emit the same class contract StatusDots.svelte owns (its :global CSS, imported by MapDrawControls, styles this) — sync() toggles --under/--over/--fault on the button to match.
            // Dots anchor to `.map-pin-plot__inner`, NOT the button root — the root is the Mapbox marker and must keep position:absolute or it drifts across the map on zoom.
            btn.innerHTML =
                `<span class="map-pin-plot__inner">` +
                `<span class="map-pin-plot__num">${n}</span>` +
                `<span class="q704-dots">` +
                `<span class="q704-dot q704-dot--under">−</span>` +
                `<span class="q704-dot q704-dot--over">+</span>` +
                `<span class="q704-dot q704-dot--fault"></span>` +
                `</span>` +
                `</span>`;
            return btn;
        }
        // Mounts THE EmojiPin component (same one PIN LIBRARY + detail header use) — never re-implement the emoji pin look here.
        const emojiChar = parseEmojiPin(pinTypeKey);
        if (emojiChar) {
            btn.classList.add("map-pin-emoji");
            mount(ports.ui.EmojiPin, {
                target: btn,
                props: { char: emojiChar, size: 30 },
            });
            return btn;
        }
        // Every other icon path comes from the registry in icons.ts, never built here; `tiles` is the reserved system marker, unrecognised keys fall back to `default`.
        const src =
            pinTypeKey === "tiles"
                ? iconPath("tiles")
                : pinAssetPath(parsePinKey(pinTypeKey) ?? "pin");
        btn.innerHTML = `<img src="${src}" alt="" draggable="false">`;
        return btn;
    }

    function attachMarkerClick(el: HTMLElement, featureKey: string) {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            // Tapping a collapsed stack representative fans it out (spiderfy) first — nothing selects yet; once fanned, taps fall through to normal selection.
            const stackKey = stackByFeature.get(featureKey);
            if (stackKey && !openStacks.has(stackKey)) {
                expandedStack = stackKey;
                reconcileSingles();
                return;
            }
            // Tap the selected pin again → clear the selection (same as tapping empty map).
            if (deps.getSelectedKey() === featureKey) {
                deps.setSelectedIndex(null);
                return;
            }
            const idx = mapStore.features.findIndex(
                (f) => (f.properties?.mapFeatureKey as string) === featureKey,
            );
            if (idx < 0) return;
            deps.setSelectedIndex(idx);
            const feat = mapStore.features[idx];
            if (feat) {
                deps.popoverPos.compute(feat);
                // CONVENTION: NEVER force a deeper zoom than the user chose on pin tap — only ease IN to PIN_TAP_ZOOM (10z) if farther out, leave alone if already closer. (Was max(cur,16) live/12 offline, which slammed every tap to street level.)
                const PIN_TAP_ZOOM = 10;
                const map = getMap();
                const cur = map ? map.getZoom() : NaN;
                const target = Number.isFinite(cur)
                    ? Math.max(cur, PIN_TAP_ZOOM)
                    : PIN_TAP_ZOOM;
                deps.panPointToTop(feat, { zoom: target });
            }
        });
    }

    function clear() {
        for (const pm of pinMarkers) pm.marker.remove();
        pinMarkers = [];
        expandedStack = null;
        expandedCluster = null;
        stackByFeature = new Map();
        openStacks = new Set();
    }

    function sync() {
        const map = getMap();
        if (!map) return;
        if (!mapStore.ready) return;
        // NaN-CAMERA GUARD — a degenerate camera (zoom===NaN) makes map.getBounds() THROW → red-screen crash; skip sync until it's restored (see mapInit's renderGuard).
        if (!Number.isFinite(map.getZoom())) return;
        const feats = mapStore.features;
        // Honours per-type visibility toggles: `plot:` → `plots`, `tiles` → ALWAYS shown, everything else → `pins`; filtered here so the reconcile below removes their DOM markers.
        const pins = feats.filter(
            (f): f is Feature & { geometry: GeoJSON.Point } => {
                if (f.geometry?.type !== "Point") return false;
                const t = (f.properties?.pinTypeKey as string) ?? "pin";
                if (t === "tiles") return true; // system marker, never hidden
                if (t.startsWith("plot:")) return overlayVisibility.plots;
                return overlayVisibility.pins;
            },
        );

        // Duplicate audit is scoped to ONE survey — different surveys sharing a baked `plot:N` is EXPECTED (merges into 1..N, not flagged); same survey sharing one is a real bug.
        auditDuplicatePlotPins(pins);

        // Every pin goes through native clustering — a handful close together reads as one pin with a count until you zoom in. The selected pin is pulled out so it always stands alone, and the system tiles marker never bubbles.
        const selKey = deps.getSelectedKey();
        const pinFeed: typeof pins = [];
        const plotFeed: typeof pins = [];
        forcedSingleKeys = new Set();
        for (const p of pins) {
            const t = (p.properties?.pinTypeKey as string) ?? "pin";
            const k = p.properties?.mapFeatureKey as string | undefined;
            if (t === "tiles" || k === selKey) {
                if (k) forcedSingleKeys.add(k);
            } else if (t.startsWith("plot:")) {
                const row = k ? (ports.q704?.plotByGpsKey(k) ?? null) : null;
                const st = plotStatus(row);
                const q = plotQuality(row);
                plotFeed.push({
                    ...p,
                    properties: {
                        ...p.properties,
                        under: st.under ? 1 : 0,
                        over: st.over ? 1 : 0,
                        fault: st.fault ? 1 : 0,
                        sat: q.sat,
                        spots: q.spots,
                        open: k && expandedCluster?.keys.has(k) ? 1 : 0,
                    },
                });
            } else pinFeed.push(p);
        }
        ensureClusterLayers(map);
        lastPins = pins;
        (map.getSource(CLUSTER_SOURCE) as mapboxgl.GeoJSONSource).setData({
            type: "FeatureCollection",
            features: pinFeed,
        });
        (map.getSource(PLOT_CLUSTER_SOURCE) as mapboxgl.GeoJSONSource).setData({
            type: "FeatureCollection",
            features: plotFeed,
        });
        reconcileSingles();
    }

    // Reconciles DOM markers to exactly what the clustered source reports as unclustered; runs after sync() and every re-tile — clustering happens in worker tiles, so the answer isn't available synchronously after setData.
    function reconcileSingles() {
        const map = getMap();
        if (!map || !mapStore.ready) return;
        if (!Number.isFinite(map.getZoom())) return;
        const sources = [CLUSTER_SOURCE, PLOT_CLUSTER_SOURCE];
        if (sources.some((id) => !map.getSource(id))) return;
        // Not yet re-clustered → keep the current markers; the sourcedata listener re-runs this the moment the source settles.
        if (sources.some((id) => !map.isSourceLoaded(id))) return;
        const pins = lastPins;
        // Unclustered = features without point_count; querySourceFeatures only sees loaded viewport tiles, so off-screen pins simply keep no marker.
        const singleKeys = new Set<string>();
        for (const id of sources) {
            for (const f of map.querySourceFeatures(id, {
                filter: ["!", ["has", "point_count"]],
            })) {
                const k = f.properties?.mapFeatureKey as string | undefined;
                if (k) singleKeys.add(k);
            }
        }
        // Feature pins + the selected pin never cluster — they're not in the clustered source at all, so add them back as always-wanted singles.
        for (const k of forcedSingleKeys) singleKeys.add(k);
        // An expanded plaque's members are still clustered as far as the source
        // is concerned; they get markers anyway, and the bubble they came from
        // is hidden below. Once the members re-split on their own (zoom in) the
        // expansion has nothing left to do and folds itself away.
        if (expandedCluster) {
            let stillMerged = false;
            for (const k of expandedCluster.keys) {
                if (!singleKeys.has(k)) stillMerged = true;
                singleKeys.add(k);
            }
            if (!stillMerged) expandedCluster = null;
        }

        const wantKeys = singleKeys;

        // Drop markers whose pin no longer exists OR is now inside a cluster.
        pinMarkers = pinMarkers.filter((pm) => {
            if (wantKeys.has(pm.key)) return true;
            pm.marker.remove();
            return false;
        });

        const have = new Map(pinMarkers.map((pm) => [pm.key, pm]));

        for (const pin of pins) {
            // Skip pins that the cluster query folded into a bubble.
            const pk = pin.properties?.mapFeatureKey as string | undefined;
            if (!pk || !singleKeys.has(pk)) continue;
            const fkey = pin.properties?.mapFeatureKey as string | undefined;
            if (!fkey) continue;
            const pinTypeKey = (pin.properties?.pinTypeKey as string) ?? "pin";
            const coords = pin.geometry.coordinates as [number, number];
            // Mandatory NaN guard before any Mapbox coord write (see memory `mapbox-camera-via-safeMap`) — letting NaN reach setLngLat/.addTo nulls Mapbox's projection matrix and EVERY subsequent render throws, breaking unrelated features too.
            if (!isFiniteCoord(coords as unknown)) {
                console.warn(
                    `[markers] skipping pin ${fkey} — non-finite coords:`,
                    coords,
                );
                continue;
            }
            const existing = have.get(fkey);

            if (existing) {
                // Position can shift if user moves a feature; type can change via the popover. Update both in place.
                existing.marker.setLngLat(coords);
                if (existing.pinTypeKey !== pinTypeKey) {
                    const newEl = buildPinElement(fkey, pinTypeKey);
                    attachMarkerClick(newEl, fkey);
                    // mapboxgl.Marker doesn't expose a setElement, so swap by replacing the marker entirely.
                    existing.marker.remove();
                    const m = new (markerCtor(map))({
                        element: newEl,
                        anchor: PIN_ANCHOR,
                    })
                        .setLngLat(coords)
                        .addTo(map);
                    existing.marker = m;
                    existing.pinTypeKey = pinTypeKey;
                }
                continue;
            }

            const el = buildPinElement(fkey, pinTypeKey);
            attachMarkerClick(el, fkey);
            const marker = new (markerCtor(map))({
                element: el,
                anchor: PIN_ANCHOR,
            })
                .setLngLat(coords)
                .addTo(map);
            pinMarkers.push({ key: fkey, pinTypeKey, marker });
        }

        // Selected plot marker → gold "Plot N" pill; only the selected marker's label/class changes, so this never de-styles the others.
        const selKey = deps.getSelectedKey();
        for (const pm of pinMarkers) {
            if (!pm.pinTypeKey.startsWith("plot:")) continue;
            const el = pm.marker.getElement();
            const isSel = pm.key === selKey;
            el.classList.toggle("map-pin-plot--selected", isSel);
            // pm.key = plot row's gpsFeatureKey → plotByGpsKey resolves the live row, re-checked every sync() so edits/re-flows show live; ports.q704 absent on hosts without inspections → null → baked label.
            const plot = ports.q704?.plotByGpsKey(pm.key) ?? null;
            // Label is the plot's per-MAP rank (plot.displayNo), NOT the frozen `plot:N` baked at drop time — re-flows as surveys merge/delete; falls back to baked `plot:N` only if unresolved.
            const numEl = el.querySelector(".map-pin-plot__num");
            if (numEl) {
                const n = String(plot?.displayNo || pm.pinTypeKey.slice(5));
                numEl.textContent = isSel ? `Plot ${n}` : n;
            }
            const st = plotStatus(plot);
            el.classList.toggle("map-pin-plot--under", st.under);
            el.classList.toggle("map-pin-plot--over", st.over);
            el.classList.toggle("map-pin-plot--fault", st.fault);
        }

        // SELECTION OVERRIDE — any selected pin lifts above the dim veil (owned by MapDrawControls). Toggled every reconcile so deselecting restores everything.
        for (const pm of pinMarkers) {
            pm.marker
                .getElement()
                .classList.toggle("map-pin-marker--selected", pm.key === selKey);
        }

        layoutStacks(selKey);
        layoutExpandedCluster(map);

        placeCaptions(map, selKey);
    }

    // Runs after every marker reconcile (sync, sourcedata settle, moveend) — caption winners re-compete whenever camera or data settles.
    function placeCaptions(map: MapboxMap, selKey: string | null): void {
        const zoom = map.getZoom();
        const zoomOk = Number.isFinite(zoom) && zoom >= PIN_CAPTION_MINZOOM;
        const nameByKey = new Map<string, string>();
        for (const p of lastPins) {
            const k = p.properties?.mapFeatureKey as string | undefined;
            if (k) nameByKey.set(k, String(p.properties?.name ?? "").trim());
        }

        // WRITE pass: builds each caption hidden-but-laid-out for measurement; unnamed pins, `tiles`, and PLOTS (identity is the plaque number) never get one.
        type Candidate = { pm: PinMarker; cap: HTMLElement; priority: number };
        const candidates: Candidate[] = [];
        for (const pm of pinMarkers) {
            const el = pm.marker.getElement();
            let cap = el.querySelector<HTMLElement>(".map-pin-caption");
            const name = nameByKey.get(pm.key) ?? "";
            if (
                name === "" ||
                pm.pinTypeKey === "tiles" ||
                pm.pinTypeKey.startsWith("plot:")
            ) {
                cap?.remove();
                continue;
            }
            if (!cap) {
                cap = document.createElement("span");
                cap.className = "map-pin-caption";
                el.appendChild(cap);
            }
            if (cap.textContent !== name) cap.textContent = name;
            const isSel = pm.key === selKey;
            // Zoom gate: no captions below it — except the selected pin, which shows regardless of zoom or collisions.
            if (!zoomOk && !isSel) {
                cap.style.display = "none";
                continue;
            }
            cap.style.display = "";
            cap.style.visibility = "hidden";
            candidates.push({ pm, cap, priority: isSel ? 0 : 1 });
        }
        if (candidates.length === 0) return;

        // READ pass — one reflow: caption rects, marker rects, and the tier-1 area-name rects (reserved first; a caption never crowds an area name).
        const capRects = candidates.map(
            (c) => c.cap.getBoundingClientRect() as Rect,
        );
        const markerRects = pinMarkers.map((pm) => ({
            key: pm.key,
            rect: pm.marker.getElement().getBoundingClientRect() as Rect,
        }));
        const placed: Rect[] = getAreaLabelRects(map);

        // PLACE pass — selected pin first, the rest in stable order. Overlap anything already placed or any OTHER marker → drop (no truncation, no nudging).
        const order = candidates
            .map((c, i) => ({ c, rect: capRects[i], i }))
            .sort((a, b) => a.c.priority - b.c.priority || a.i - b.i);
        for (const { c, rect } of order) {
            const isSel = c.priority === 0;
            const blocked =
                !isSel &&
                (placed.some((r) => rectsOverlap(r, rect)) ||
                    markerRects.some(
                        (m) => m.key !== c.pm.key && rectsOverlap(m.rect, rect),
                    ));
            if (blocked) {
                c.cap.style.display = "none";
            } else {
                c.cap.style.visibility = "";
                placed.push(rect);
            }
        }
    }

    return { sync, clear };
}
