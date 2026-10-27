<!-- Snake Ruler measure tool. Owns all its own state and never touches draw state, so it cannot open the draw palette. -->
<script lang="ts">
import { iconPath } from "../shared/icons";
import { m } from "$parent/src/lib/paraglide/messages";
import type { Feature } from "geojson";
import type * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import area from "@turf/area";
import turfLength from "@turf/length";
import { markerCtor } from "../shared/rendererOf";
import { coordLabel, emit as emitPress } from "../shared/doubleTapToPin";
import { DRAW_LIMIT_NOTE, mayAddVertex } from "$gc/drawLimit";
import { BORDER_RUST, POLYGON_FILL, POLYGON_OUTLINE, STROKE } from "$gc/drawDials";
import { type Lnglat, type SnapKind, type SnapRings, snapLngLat, snapRings } from "$gc/snapToShapes";
import { formatArea, formatLength } from "$gc/units.svelte";
import { keptLegLabels } from "./legLabelCrowding";
import { type Rect, mapKeepOutRects, readFloorY, readTopBarH, shiftClear } from "../shared/mapKeepOut";
import type {
    MapHostPorts,
    MapShareFormat,
    MapShareRow as ShareFormat,
} from "../shared/mapHostPorts";

let {
    ports,
    map,
    measureEvent = $bindable(null),
    armKind = $bindable(null),
    onPersist,
    onSavePoint,
    onPlot,
    onActivate,
    userCoord,
    onSnapSelf,
    gridSnap,
    setGridGlow,
    snapShapes,
}: {
    ports: MapHostPorts;
    map: MapLibreMap | null;
    /** The host's double-tap or settled hold: plants the first node, then each next corner. */
    measureEvent?: { lng: number; lat: number; n: number } | null;
    /** Palette tap-to-build mode; null = hold mode. */
    armKind?: "line" | "polygon" | "pin" | null;
    onPersist: (
        kind: "line" | "polygon",
        verts: Lnglat[],
        share: boolean,
        format?: MapShareFormat,
    ) => void;
    onSavePoint?: ((lng: number, lat: number, kind: "pin" | "cachePin") => void) | undefined;
    /** `atSelf` = seed snapped onto the blue dot (proof-of-presence); `plusCode` = snapped grid dot, null if dropped free. Resolves true when it dropped, else the refusal's words ("" when it shows its own cue). */
    onPlot?:
        | ((
              lng: number,
              lat: number,
              atSelf: boolean,
              plusCode: string | null,
          ) => Promise<true | string>)
        | undefined;
    onActivate?: (() => void) | undefined;
    /** Blue-dot coord, or null without a fix. */
    userCoord?: (() => Lnglat | null) | undefined;
    onSnapSelf?: (() => void) | undefined;
    /** Nearest audit-grid dot within the magnet radius, or null; both absent when snapping is off. */
    gridSnap?:
        | ((
              lng: number,
              lat: number,
          ) => { lng: number; lat: number; plusCode: string } | null)
        | undefined;
    setGridGlow?:
        | ((
              dot: { lng: number; lat: number; plusCode: string } | null,
          ) => void)
        | undefined;
    /** Saved shapes on the map; a dragged point snaps to their corners and edges. */
    snapShapes?: (() => Feature[]) | undefined;
} = $props();

let active = $state(false);
// Raw: a point keeps its identity, which is how `snapped` recognises it.
let verts: Lnglat[] = $state.raw([]);
let cursor: Lnglat | null = $state.raw(null);
let isPolygon = $state(false);
let moveIndex: number | null = $state(null); // corner being dragged
let mapMoveSeq = $state(0);
let spotBump = $state(0);
let armed: "line" | "polygon" | "pin" | null = $state(null);
let paletteMode = $derived(armed !== null);

let canFinish = $derived(isPolygon ? verts.length >= 3 : verts.length >= 2);
let singlePoint = $derived(
    active && !isPolygon && !cursor && verts.length === 1 && !armed,
);
let copied = $state(false);
let copyFailed = $state(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
let seedAtSelf = $state(false);
// Why the last plot tap did not drop, under the popover's buttons until the snake goes.
let plotNote = $state("");
let gridSnapDot = $state<{ lng: number; lat: number; plusCode: string } | null>(
    null,
);
// Saved-shape rings projected once per drag; dropped on map move, so a tap builds them fresh.
let shapeRings: SnapRings | null = null;
// Points born from a snap, by identity: they read white while held AND after the drop.
const snapped = new WeakSet<Lnglat>();
let lastSnap: SnapKind = null;
function snap(lng: number, lat: number, reach?: number): Lnglat {
    if (!map || !snapShapes) return [lng, lat];
    shapeRings ??= snapRings(map, snapShapes());
    const s = snapLngLat(map, [lng, lat], shapeRings, lastSnap, reach);
    if (s.kind) snapped.add(s.ll);
    // The snapping node is under the finger; the far nodes pulsing is what the user can see. Edge → corner pulses again.
    if (s.kind && s.kind !== lastSnap) flashCorners(BORDER_RUST);
    lastSnap = s.kind;
    return s.ll;
}

const MEASURE_LINE_SRC = "measure-line";
const MEASURE_NODES_SRC = "measure-nodes";
const MEASURE_FILL_SRC = "measure-fill";
const MEASURE_TICKS_SRC = "measure-ticks";
const MEASURE_ENDDOTS_SRC = "measure-end-dots";
const ALL_SRCS = [MEASURE_FILL_SRC, MEASURE_LINE_SRC, MEASURE_TICKS_SRC, MEASURE_NODES_SRC, MEASURE_ENDDOTS_SRC];
const SELF_SNAP_PX = 22; // ≈44px touch target
const FINISH_TAP_PX = 22;
const LEG_LABEL_FRAC = 0.78;
const LEG_LABEL_OFF = 18;
const LABEL_HALF_H = 10;
const TOTAL_TAIL_BIAS = 0.35;

const fc = (features: GeoJSON.Feature[] = []): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const pointsFC = (cs: Lnglat[]) =>
    fc(cs.map((c) => ({ type: "Feature", properties: snapped.has(c) ? { _snapped: true } : {}, geometry: { type: "Point", coordinates: c } })));

function setData(id: string, data: GeoJSON.FeatureCollection) {
    const src = map?.getSource(id);
    if (src && "setData" in src) {
        (src as unknown as { setData: (d: GeoJSON.FeatureCollection) => void }).setData(data);
    }
}

function ensureLayers() {
    if (!map || map.getSource(MEASURE_LINE_SRC)) return;
    for (const id of ALL_SRCS) map.addSource(id, { type: "geojson", data: fc() });
    map.addLayer({
        id: "measure-fill", type: "fill", source: MEASURE_FILL_SRC,
        paint: { "fill-color": "#ffd54a", "fill-opacity": 0.22 },
    });
    // No bevel: a directional shadow flips wrong as the snake bends.
    map.addLayer({
        id: "measure-line-casing", type: "line", source: MEASURE_LINE_SRC,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#41454d", "line-width": 12, "line-opacity": 0.55 },
    });
    map.addLayer({
        id: "measure-ticks", type: "line", source: MEASURE_TICKS_SRC,
        paint: {
            "line-color": ["match", ["get", "kind"], "half", "#ffd700", "#ffffff"],
            "line-width": ["match", ["get", "kind"], "half", 1.6, "quarter", 1.1, 0.75],
        },
    });
    map.addLayer({
        id: "measure-nodes", type: "circle", source: MEASURE_NODES_SRC,
        paint: {
            "circle-radius": 4.5, "circle-color": "#000000", "circle-opacity": 0,
            "circle-stroke-color": ["case", ["==", ["get", "_snapped"], true], "#ffffff", "#f5d565"],
            "circle-stroke-width": 2,
        },
    });
    // Invisible fat halo so a node is easy to grab with a finger.
    map.addLayer({
        id: "measure-nodes-halo", type: "circle", source: MEASURE_NODES_SRC,
        paint: { "circle-radius": 16, "circle-color": "#ffffff", "circle-opacity": 0.01 },
    });
    map.addLayer({
        id: "measure-end-dots", type: "circle", source: MEASURE_ENDDOTS_SRC,
        paint: {
            "circle-radius": ["case", ["==", ["get", "_snapped"], true], 5, 2],
            "circle-color": ["case", ["==", ["get", "_snapped"], true], "#ffffff", "#c97a4a"],
        },
    });
    map.addLayer({
        id: "measure-close-flash", type: "circle", source: MEASURE_NODES_SRC,
        paint: {
            "circle-radius": FLASH_R[0], "circle-color": "#ffffff", "circle-opacity": 0,
            "circle-stroke-color": "#ffffff", "circle-stroke-width": 3, "circle-stroke-opacity": 0,
        },
    });
}

// Every corner throws a ring at once: white = closed into a piece, rust = touched a saved shape.
// Mapbox tweens it: one setPaintProperty per frame re-parses the style and stutters the drag.
const FLASH_LAYER = "measure-close-flash";
const FLASH_R = [6, 28] as const;
const FLASH_MS = 650;
const FLASH_TWEENED = ["circle-radius", "circle-opacity", "circle-stroke-opacity"] as const;
let flashRaf = 0;
function flashCorners(color = "#ffffff") {
    const m = map;
    if (!m?.getLayer(FLASH_LAYER)) return;
    const paint = (p: string, v: unknown) => m.setPaintProperty(FLASH_LAYER, p as "circle-radius", v as number);
    const pose = (r: number, fill: number, ring: number, ms: number) => {
        for (const p of FLASH_TWEENED) paint(`${p}-transition`, { duration: ms, delay: 0 });
        paint("circle-radius", r);
        paint("circle-opacity", fill);
        paint("circle-stroke-opacity", ring);
    };
    cancelAnimationFrame(flashRaf);
    paint("circle-color", color);
    paint("circle-stroke-color", color);
    pose(FLASH_R[0], 0.4, 0.9, 0);
    // The start pose must paint once before the tween to the end pose begins.
    flashRaf = requestAnimationFrame(() => {
        flashRaf = requestAnimationFrame(() => pose(FLASH_R[1], 0, 0, FLASH_MS));
    });
}

// Ticks are built per leg, in screen px, so they never fight across a bend; rebuilt on every move.
function buildTicksFC(ring: Lnglat[]): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    if (!map || ring.length < 2) return fc(features);
    const SPACING_PX = 13;
    const MINOR_PX = 2.5;
    const QUARTER_PX = 4;
    const GOLD_PX = 6; // = band half-width, flush
    const END_MARGIN = 10;

    const tick = (cx: number, cy: number, ux: number, uy: number, half: number, kind: string) => {
        const px = -uy, py = ux;
        const p1 = map!.unproject([cx - px * half, cy - py * half]);
        const p2 = map!.unproject([cx + px * half, cy + py * half]);
        features.push({
            type: "Feature", properties: { kind },
            geometry: { type: "LineString", coordinates: [[p1.lng, p1.lat], [p2.lng, p2.lat]] },
        });
    };

    for (let i = 0; i < ring.length - 1; i++) {
        const a = map.project({ lng: ring[i][0], lat: ring[i][1] });
        const b = map.project({ lng: ring[i + 1][0], lat: ring[i + 1][1] });
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 2) continue;
        const ux = dx / len, uy = dy / len;
        const place = (d: number, half: number, kind: string) =>
            tick(a.x + ux * d, a.y + uy * d, ux, uy, half, kind);

        // N a multiple of 4 so 1/4, 1/2, 3/4 are always exact.
        let n = Math.round(len / SPACING_PX);
        n = Math.max(4, Math.round(n / 4) * 4);
        for (let k = 1; k < n; k++) {
            const d = (k / n) * len;
            if (d < END_MARGIN || d > len - END_MARGIN) continue;
            if (k === n / 2) place(d, GOLD_PX, "half");
            else if (k === n / 4 || k === (3 * n) / 4) place(d, QUARTER_PX, "quarter");
            else place(d, MINOR_PX, "minor");
        }
    }
    return fc(features);
}

function points(): Lnglat[] {
    if (moveIndex === null || !cursor) return verts;
    const v = [...verts];
    v[moveIndex] = cursor;
    return v;
}
/** The drawn path: closed back to its first corner once it is a polygon. */
function ring(pts = points()): Lnglat[] {
    return isPolygon && pts.length >= 3 ? [...pts, pts[0]] : pts;
}

function render() {
    if (!map) return;
    ensureLayers();
    const pts = points();
    const r = ring(pts);
    setData(MEASURE_LINE_SRC, fc(r.length >= 2
        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r } }]
        : []));
    setData(MEASURE_TICKS_SRC, buildTicksFC(r));
    setData(MEASURE_NODES_SRC, pointsFC(isPolygon ? pts : verts));
    // Fill auto-closes the ring while still open; no visible line across the open side.
    setData(MEASURE_FILL_SRC, fc(pts.length >= 3
        ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] } }]
        : []));
    setData(MEASURE_ENDDOTS_SRC, pointsFC(isPolygon || pts.length < 2 ? pts : [pts[0], pts[pts.length - 1]]));
    renderLegs();
}

function clearAll() {
    cursor = null;
    isPolygon = false;
    moveIndex = null;
    shapeRings = null;
    copied = false;
    copyFailed = false;
    if (copiedTimer) clearTimeout(copiedTimer);
    for (const id of ALL_SRCS) setData(id, fc());
    clearLegs();
}
// The leg labels are Markers added to the map, not Svelte DOM: a dev hot-swap of this
// component would otherwise leave them on the map with no state behind them and no way to dismiss.
$effect(() => () => clearAll());

// The lesson's "saved" beat: the shape turns into a saved piece (drawStyle's own paint), holds,
// then dims to nothing and is discarded. A new start or a discard mid-fade bumps the token, so the
// fade leaves whatever replaced it alone.
let fading = $state(false);
let fadeGen = 0;
const SAVED_HOLD_MS = 700;
const SAVED_PAINT = [
    ["measure-fill", "fill-color", POLYGON_FILL],
    ["measure-fill", "fill-opacity", 0.35],
    ["measure-line-casing", "line-color", POLYGON_OUTLINE],
    ["measure-line-casing", "line-width", STROKE.polygon.line],
    ["measure-line-casing", "line-opacity", 1],
    ["measure-ticks", "line-opacity", 0],
    ["measure-nodes", "circle-stroke-opacity", 0],
    ["measure-end-dots", "circle-color", POLYGON_OUTLINE],
    ["measure-end-dots", "circle-radius", 4],
    ["measure-end-dots", "circle-opacity", 1],
] as const;
const DIM_PAINT = [
    ["measure-fill", "fill-opacity", 0.35],
    ["measure-line-casing", "line-opacity", 1],
    ["measure-end-dots", "circle-opacity", 1],
] as const;
async function tourFade(ms: number): Promise<void> {
    const m = map;
    if (!m || !active) return discard();
    const gen = ++fadeGen;
    fading = true;
    clearLegs();
    const base = SAVED_PAINT.map(([id, prop]) => [id, prop, m.getPaintProperty(id, prop)] as const);
    for (const [id, prop, v] of SAVED_PAINT) m.setPaintProperty(id, prop, v);
    await new Promise((r) => setTimeout(r, SAVED_HOLD_MS));
    const t0 = performance.now();
    await new Promise<void>((done) => {
        const step = () => {
            const k = gen === fadeGen ? Math.min(1, (performance.now() - t0) / ms) : 1;
            for (const [id, prop, full] of DIM_PAINT) m.setPaintProperty(id, prop, full * (1 - k));
            if (k < 1) requestAnimationFrame(step);
            else done();
        };
        requestAnimationFrame(step);
    });
    if (gen === fadeGen) discard();
    for (const [id, prop, v] of base) m.setPaintProperty(id, prop, v);
    fading = false;
}
/** The teaching hand drives a real ruler through these instead of synthetic pointer events. */
export const tour = {
    seed: (lng: number, lat: number) => start(null, [lng, lat]),
    add,
    fade: tourFade,
    discard,
};

let legMarkers: maplibregl.Marker[] = [];
/** Which legs wore a label at the last render, as "1101": the move handler rebuilds only when this changes. */
let legLabelsShown = "";
function legLabelsFit(anchors = legLabelAnchors()): boolean[] {
    const m = map;
    if (!m) return [];
    return keptLegLabels(
        anchors.map(({ geo, off, lenPx }) => {
            const p = m.project({ lng: geo[0], lat: geo[1] });
            return { x: p.x + off[0], y: p.y + off[1], legPx: lenPx };
        }),
    );
}
function clearLegs() {
    for (const m of legMarkers) m.remove();
    legMarkers = [];
    legLabelsShown = "";
}
function addLeg(lngLat: Lnglat, text: string, offset: [number, number]) {
    if (!map) return;
    const el = document.createElement("div");
    el.className = "rt-line-label rt-line-label-leg";
    el.textContent = text;
    legMarkers.push(
        new (markerCtor(map))({ element: el, anchor: "center", offset }).setLngLat(lngLat).addTo(map),
    );
}
function legLabelAnchors(): Array<{ geo: Lnglat; off: [number, number]; lenPx: number }> {
    if (!map) return [];
    const r = ring();
    if (r.length < (isPolygon ? 4 : 3)) return [];
    const out: Array<{ geo: Lnglat; off: [number, number]; lenPx: number }> = [];
    for (let i = 0; i < r.length - 1; i++) {
        const geo: Lnglat = [
            r[i][0] + (r[i + 1][0] - r[i][0]) * LEG_LABEL_FRAC,
            r[i][1] + (r[i + 1][1] - r[i][1]) * LEG_LABEL_FRAC,
        ];
        const a = map.project({ lng: r[i][0], lat: r[i][1] });
        const b = map.project({ lng: r[i + 1][0], lat: r[i + 1][1] });
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        let px = -dy / len, py = dx / len;
        if (py > 0) { px = -px; py = -py; }
        out.push({ geo, off: [px * LEG_LABEL_OFF, py * LEG_LABEL_OFF], lenPx: len });
    }
    return out;
}
function renderLegs() {
    clearLegs();
    const anchors = legLabelAnchors();
    const kept = legLabelsFit(anchors);
    legLabelsShown = kept.map(Number).join("");
    const r = ring();
    anchors.forEach(({ geo, off }, i) => {
        if (!kept[i]) return;
        const segKm = turfLength({
            type: "Feature", properties: {},
            geometry: { type: "LineString", coordinates: [r[i], r[i + 1]] },
        });
        addLeg(geo, formatLength(segKm * 1000), off);
    });
}

/** The corner within a finger of canvas point (x, y), or -1. */
function nodeAt(m: MapLibreMap, x: number, y: number): number {
    return verts.findIndex((v) => {
        const q = m.project({ lng: v[0], lat: v[1] });
        return (q.x - x) ** 2 + (q.y - y) ** 2 < FINISH_TAP_PX ** 2;
    });
}
/** A hold that settles while the ruler is out: a corner at the crosshair, or on the first corner, the close. */
function add(lng: number, lat: number) {
    if (!active || !map) return;
    const p = map.project({ lng, lat });
    const near = nodeAt(map, p.x, p.y);
    console.log("[dbg:loupe108] add", { near, n: verts.length, isPolygon, moveIndex, p: [p.x | 0, p.y | 0] });
    if (near === 0 && verts.length >= 3 && !isPolygon) {
        isPolygon = true;
        render();
        flashCorners();
        return;
    }
    if (near !== -1 || !mayAddVertex(verts.length)) return;
    verts = [...verts, snap(lng, lat, SELF_SNAP_PX)];
    seedAtSelf = false;
    render();
}

function snapSeedToSelf(seed: Lnglat): { seed: Lnglat; atSelf: boolean } {
    const uc = userCoord?.();
    if (!uc || !map) return { seed, atSelf: false };
    const a = map.project({ lng: seed[0], lat: seed[1] });
    const b = map.project({ lng: uc[0], lat: uc[1] });
    if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= SELF_SNAP_PX ** 2) {
        return { seed: [uc[0], uc[1]], atSelf: true };
    }
    return { seed, atSelf: false };
}

/** Hold mode starts from a seed; palette mode starts armed and empty. */
function start(kind: typeof armed, seed?: Lnglat) {
    const snapped = seed ? snapSeedToSelf(seed) : null;
    fadeGen++;
    active = true;
    armed = kind;
    cursor = null;
    moveIndex = null;
    isPolygon = false;
    spotBump = 0;
    seedAtSelf = snapped?.atSelf ?? false;
    verts = snapped ? [snapped.seed] : [];
    onActivate?.();
    render();
    if (seedAtSelf) onSnapSelf?.();
}
export function discard() {
    plotNote = "";
    fadeGen++;
    active = false;
    armed = null;
    armKind = null;
    seedAtSelf = false;
    gridSnapDot = null;
    setGridGlow?.(null);
    clearAll();
    verts = [];
}
let lastCommitAt = 0;
function persist(share: boolean, format?: MapShareFormat) {
    if (!canFinish) return;
    lastCommitAt = performance.now();
    const kind: "line" | "polygon" = isPolygon ? "polygon" : "line";
    // `verts` holds $state proxies; a shallow copy still hands proxies across and breaks structuredClone in the store.
    const out: Lnglat[] = verts.map((c) => [c[0], c[1]]);
    onPersist(kind, out, share, format);
    discard();
}

// Synchronous so navigator.share keeps the click's user activation.
const shareFormats: ShareFormat[] = [
    { ext: "getcache", run: () => persist(true, "getcache") },
    { ext: "kmz", run: () => persist(true, "kmz") },
];
/** Palette UNDO: drops the last-placed corner; stays armed at zero. */
export function undoLast() {
    if (!active || verts.length === 0) return;
    verts = verts.slice(0, -1);
    if (verts.length < 3) isPolygon = false;
    cursor = null;
    moveIndex = null;
    render();
}
/** Host gates its map-click feature hit-test on this so a mid-measure tap places a node. */
export function isMeasuring(): boolean {
    return active;
}

$effect(() => {
    const ev = measureEvent;
    if (!ev) return;
    measureEvent = null;
    console.log("[dbg:loupe108] measureEvent", { active, armed, n: verts.length });
    if (armed) return;
    // A fast final click-to-commit can read as a dblclick; swallow the seed so the fresh popover isn't torn down.
    if (performance.now() - lastCommitAt < 600) return;
    if (active) return add(ev.lng, ev.lat);
    // A finger's reach: a hold aimed at a border lands on it, not beside it.
    start(null, snap(ev.lng, ev.lat, SELF_SNAP_PX));
});

$effect(() => {
    const k = armKind;
    if (k && armed !== k) start(k);
    else if (!k && armed) discard();
});

function tapOnShape(m: MapLibreMap, x: number, y: number): boolean {
    if (verts.length < 3) return false;
    const ring = verts.map((v) => m.project({ lng: v[0], lat: v[1] }));
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

// Hold mode grows ONLY by a settled hold (`add`); a tap never adds a corner. Tap the LAST node
// to save, the FIRST (3+) to close, anywhere else to dismiss.
$effect(() => {
    const m = map;
    if (!m) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
        if (!active) return;
        const pt = snap(e.lngLat.lng, e.lngLat.lat);
        const nearIdx = nodeAt(m, e.point.x, e.point.y);
        if (armed === "pin") {
            // Deferred so the host's own map-click handler can't instantly clear the fresh pin's selection.
            const [lng, lat] = pt;
            queueMicrotask(() => {
                onSavePoint?.(lng, lat, "pin");
                discard();
            });
        } else if (armed === "line") {
            if (verts.length === 0) {
                verts = [pt];
                render();
            }
        } else if (armed === "polygon") {
            if (nearIdx !== -1 || !mayAddVertex(verts.length)) return;
            verts = [...verts, pt];
            isPolygon = verts.length >= 3;
            render();
        } else {
            if (!isPolygon && nearIdx === verts.length - 1 && canFinish) {
                // This handler registers before the host's; a synchronous select would read as an outside tap and get deselected.
                queueMicrotask(() => persist(false));
                return;
            }
            if (!isPolygon && nearIdx === 0 && verts.length >= 3) {
                isPolygon = true;
                cursor = null;
                render();
                flashCorners();
                return;
            }
            if (nearIdx !== -1) return;
            // A tap on the shape is aimed at it, not away from it — move its chrome, keep the work.
            if (tapOnShape(m, e.point.x, e.point.y)) spotBump++;
            else discard();
        }
        console.log("[dbg:loupe108] click", { nearIdx, n: verts.length, active });
    };
    m.on("click", onClick);
    return () => m.off("click", onClick);
});

$effect(() => {
    const m = map;
    if (!m) return;
    let moved = false;
    const down = (e: maplibregl.MapLayerMouseEvent | maplibregl.MapLayerTouchEvent) => {
        if (!active || verts.length === 0) return;
        let nearestD = Number.POSITIVE_INFINITY;
        for (let i = 0; i < verts.length; i++) {
            const q = m.project({ lng: verts[i][0], lat: verts[i][1] });
            const d = (q.x - e.point.x) ** 2 + (q.y - e.point.y) ** 2;
            if (d < nearestD) { nearestD = d; moveIndex = i; }
        }
        e.preventDefault();
        console.log("[dbg:loupe108] node down", moveIndex);
        moved = false;
        shapeRings = null;
        lastSnap = null;
        m.dragPan.disable();
    };
    const move = (e: { lngLat: { lng: number; lat: number } }) => {
        if (moveIndex === null) return;
        moved = true;
        const ll = snap(e.lngLat.lng, e.lngLat.lat);
        cursor = ll;
        render();
        // The loupe rides the corner, so the drop lands where the eye says. No clock: a drag is not a hold.
        const c = m.getCanvas();
        const r = c.getBoundingClientRect();
        const s = c.offsetWidth / r.width;
        const p = m.project({ lng: ll[0], lat: ll[1] });
        emitPress("aim", r.left + p.x / s, r.top + p.y / s, { canvas: c, label: coordLabel(ll[0], ll[1]) });
    };
    const up = () => {
        if (moveIndex === null) return;
        console.log("[dbg:loupe108] node up", { moveIndex, moved, n: verts.length });
        m.dragPan.enable();
        if (moved && cursor) {
            const v = [...verts];
            v[moveIndex] = cursor;
            verts = v;
            emitPress("end", 0, 0, { locked: true });
        }
        moveIndex = null;
        cursor = null;
        moved = false;
        render();
    };
    const layerEvents = ["mousedown", "touchstart"] as const;
    const nodeLayers = ["measure-nodes-halo", "measure-nodes"];
    const mapEvents = [["mousemove", move], ["touchmove", move], ["mouseup", up], ["touchend", up]] as const;
    for (const l of nodeLayers) for (const ev of layerEvents) m.on(ev, l, down);
    for (const [ev, fn] of mapEvents) m.on(ev, fn);
    return () => {
        for (const l of nodeLayers) for (const ev of layerEvents) m.off(ev, l, down);
        for (const [ev, fn] of mapEvents) m.off(ev, fn);
    };
});

const CHROME_STACK_PX = 150; // popover offset + height
const VP_MARGIN = 14;
const OFFSCREEN_HIDE = 40;
const POP_HALF_W = 42;
const POP_GRID_W = 160; // keep in sync with .measure-grid width
const POP_EDGE_PX = 5;
const TOTAL_HALF_W = 72;
// keep in sync with the .measure-pop / .measure-total translates
const POP_OFFSET_PX = 52;
const TOTAL_OFFSET_PX = 16;
const POP_H = 78;
const BESIDE_GAP = 18;

// Above the bbox by default; below if above clips the top; `cornered` when neither fits.
let popAnchor = $derived.by(() => {
    if (!map || !active) return null;
    void mapMoveSeq;
    const pts = points();
    if (pts.length < 1) return null;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const c of pts) {
        const p = map.project({ lng: c[0], lat: c[1] });
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    for (const { geo, off } of legLabelAnchors()) {
        const p = map.project({ lng: geo[0], lat: geo[1] });
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (p.y + off[1] - LABEL_HALF_H < minY) minY = p.y + off[1] - LABEL_HALF_H;
        if (p.y + off[1] + LABEL_HALF_H > maxY) maxY = p.y + off[1] + LABEL_HALF_H;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    const cx = (minX + maxX) / 2;
    const tp = map.project({ lng: pts[pts.length - 1][0], lat: pts[pts.length - 1][1] });
    const tailX = Number.isFinite(tp.x) ? tp.x : cx;

    const W = map.getCanvas().clientWidth;
    const H = map.getCanvas().clientHeight;
    // Fully off-screen hides the chrome, else the clamp pins a stray pill to the side.
    if (
        maxX < -OFFSCREEN_HIDE ||
        minX > W + OFFSCREEN_HIDE ||
        maxY < -OFFSCREEN_HIDE ||
        minY > H + OFFSCREEN_HIDE
    ) {
        return null;
    }
    // The app header overlays the canvas top, so "the top" starts under it.
    const topY = readTopBarH() + VP_MARGIN;
    const fitsAbove = minY - CHROME_STACK_PX >= topY;
    const floorY = readFloorY(map.getCanvas()) - VP_MARGIN;
    const belowY = maxY;
    const fitsBelow = belowY + CHROME_STACK_PX <= floorY;
    const popHalf = singlePoint ? POP_GRID_W / 2 : POP_HALF_W;
    const leftX = minX - BESIDE_GAP - popHalf;
    const rightX = maxX + BESIDE_GAP + popHalf;
    // Each tap on the shape steps to the next spot hugging it: the sides that fit, then over it.
    const spots: ("above" | "below" | "top" | "left" | "right" | "over")[] = [
        ...(fitsAbove ? (["above"] as const) : []),
        ...(fitsBelow ? (["below"] as const) : []),
        ...(!fitsAbove && !fitsBelow ? (["top"] as const) : []),
        ...(leftX - popHalf >= POP_EDGE_PX ? (["left"] as const) : []),
        ...(rightX + popHalf <= W - POP_EDGE_PX ? (["right"] as const) : []),
        // Only on a shape big enough to leave some of itself to tap past the pad.
        ...(maxX - minX >= 3 * popHalf &&maxY - minY >= 2 * CHROME_STACK_PX ? (["over"] as const) : []),
    ];
    const spot = singlePoint ? spots[0] : spots[spotBump % spots.length];
    const below = spot === "below";
    const cornered = spot === "top";
    const level = spot === "left" || spot === "right" || spot === "over";
    const clampX = (x: number, half: number, edge: number) =>
        Math.min(Math.max(x, edge + half), W - edge - half);
    let popX = spot === "left" ? leftX : spot === "right" ? rightX : clampX(cx, popHalf, POP_EDGE_PX);
    const midY = (minY + maxY) / 2 + POP_OFFSET_PX + POP_H / 2;
    // Cornered, the stack ends up pinned under the top bar ON the snake; start it there so the sideways dodge sees the overlap.
    const y = level ? midY : below ? belowY : cornered ? Math.max(minY, topY + POP_OFFSET_PX + POP_H) : minY;

    // Dodge the map's floating chrome SIDEWAYS (upward reads as a diagonal leap), pill + popover as ONE box.
    const popW = popHalf * 2;
    // The snake itself is a keep-out: sideways from the crow's corner is straight onto the measurement.
    const snakeRect: Rect = { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
    const rects = [
        ...mapKeepOutRects(W, undefined, map.getCanvas()),
        ...(spot === "over" ? [] : [snakeRect]),
    ];
    const minPopX = POP_EDGE_PX;
    const maxPopX = W - POP_EDGE_PX - popW;
    const stackBox = (atY: number): Rect => ({
        x: popX - popHalf,
        y: below ? atY + TOTAL_OFFSET_PX : atY - POP_OFFSET_PX - POP_H,
        w: popW,
        h: POP_OFFSET_PX + POP_H - TOTAL_OFFSET_PX,
    });
    let shifted = shiftClear(stackBox(y), rects, minPopX, maxPopX);
    let levelY = y;
    // A sideways dodge sits level with the snake instead of lifted above it — re-checked at THAT height, since
    // a box clear of the chrome up there lands square on the snake once lowered.
    if (!singlePoint && !level && shifted !== null && Math.abs(shifted + popHalf - clampX(cx, popHalf, POP_EDGE_PX)) > 1) {
        const atMid = shiftClear(stackBox(midY), rects, minPopX, maxPopX);
        if (atMid !== null) {
            shifted = atMid;
            levelY = midY;
        }
    }
    if (shifted !== null) popX = shifted + popHalf;

    // Save lives in this box, so it must always be reachable; the `cornered` pan can silently refuse.
    const topOffset = below ? TOTAL_OFFSET_PX : -POP_OFFSET_PX - POP_H;
    const clampedY = Math.min(Math.max(levelY, topY - topOffset), floorY - POP_H - topOffset);

    return {
        popX,
        totalX: singlePoint || level
            ? popX
            : clampX(cx + (tailX - cx) * TOTAL_TAIL_BIAS, TOTAL_HALF_W, VP_MARGIN),
        y: clampedY,
        totalY: clampedY,
        below,
        cornered,
        minY,
    };
});

$effect(() => {
    if (!map || !active) return;
    const a = popAnchor;
    // A spot the user tapped to is theirs; panning would walk the shape out from under it.
    if (!a?.cornered || spotBump) return;
    const shortfall = VP_MARGIN + CHROME_STACK_PX - a.minY;
    if (shortfall > 4 && !map.isMoving()) {
        map.panBy([0, shortfall], { duration: 220 });
    }
});

let totalText = $derived.by(() => {
    if (!active) return null;
    const pts = points();
    if (pts.length >= 3) {
        const ring: Lnglat[] = [...pts, pts[0]];
        const poly: Feature = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
        const size = formatArea(area(poly) || 0);
        return isPolygon ? size : `≈ ${size}`;
    }
    if (pts.length < 1) return null;
    if (pts.length === 1) return `${pts[0][1].toFixed(3)}°, ${pts[0][0].toFixed(3)}°`;
    const km = turfLength({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } });
    return formatLength(km * 1000);
});

async function sharePoint() {
    const p = verts[0];
    if (!p) return;
    const text = `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;
    const ok = await ports.ui.copyToClipboard(text);
    copied = ok;
    copyFailed = !ok;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
        copied = false;
        copyFailed = false;
    }, 1600);
}
function savePoint(kind: "pin" | "cachePin") {
    const p = verts[0];
    if (!p) return;
    onSavePoint?.(p[0], p[1], kind);
    discard();
}
async function dropPlot() {
    const p = verts[0];
    if (!p) return;
    // Snap-to-self beats snap-to-grid: a plot ON YOU ignores the grid.
    const snap = seedAtSelf ? null : gridSnapDot;
    const lng = snap ? snap.lng : p[0];
    const lat = snap ? snap.lat : p[1];
    setGridGlow?.(null);
    plotNote = "";
    const took = await onPlot?.(lng, lat, seedAtSelf, snap?.plusCode ?? null);
    if (typeof took === "string" && took) plotNote = took;
    else discard();
}

$effect(() => {
    if (!map || !map.getLayer("measure-nodes")) return;
    map.setPaintProperty(
        "measure-nodes",
        "circle-stroke-color",
        ["case", ["==", ["get", "_snapped"], true], "#ffffff", seedAtSelf ? "#1da1f2" : "#f5d565"],
    );
});

$effect(() => {
    const seed = singlePoint ? verts[0] : null;
    void mapMoveSeq;
    if (!gridSnap || !setGridGlow) return;
    if (!seed || seedAtSelf) {
        gridSnapDot = null;
        setGridGlow(null);
        return;
    }
    const dot = gridSnap(seed[0], seed[1]);
    gridSnapDot = dot;
    setGridGlow(dot);
});

// Ticks are baked into lng/lat, so they must be rebuilt on every move to stay screen-constant.
$effect(() => {
    const m = map;
    if (!m) return;
    // A search, a "see on map", any fly nobody's finger started takes the ruler with it. A resize
    // fires the same events with no originalEvent but leaves the camera where it was.
    const cam = () => `${m.getCenter().lng},${m.getCenter().lat},${m.getZoom()}`;
    let restCam: string | null = null;
    const onMoveStart = (e: { originalEvent?: Event }) => {
        restCam = active && !e.originalEvent ? cam() : null;
    };
    const onMove = () => {
        // Guard first: this fires every pan frame for the map's whole life.
        if (!active || fading) return;
        if (restCam && cam() !== restCam) return discard();
        mapMoveSeq += 1;
        shapeRings = null;
        setData(MEASURE_TICKS_SRC, buildTicksFC(ring()));
        // Rebuild ONLY when the crowding verdict changes; renderLegs recreates every marker's DOM.
        if (legLabelsShown !== legLabelsFit().map(Number).join("")) renderLegs();
    };
    m.on("movestart", onMoveStart);
    m.on("move", onMove);
    return () => {
        m.off("movestart", onMoveStart);
        m.off("move", onMove);
    };
});
</script>

{#if active && totalText && popAnchor && !fading}
    <div
        class="rt-line-label rt-line-label-total measure-total"
        class:measure-gliding={!!cursor}
        class:measure-below={popAnchor.below}
        style="left:{popAnchor.totalX}px; top:{popAnchor.totalY}px;"
    >{totalText}{#if !mayAddVertex(verts.length)} · {DRAW_LIMIT_NOTE}{/if}</div>
{/if}

{#if active && popAnchor && (canFinish || singlePoint) && !fading}
    <div class="measure-pop" class:measure-grid={singlePoint} class:measure-at-self={singlePoint && seedAtSelf} class:measure-gliding={!!cursor} class:measure-below={popAnchor.below} style="left:{popAnchor.popX}px; top:{popAnchor.y}px;">
        {#if singlePoint}
            <!-- 2×2: copy · plot / pin · cache. A tap off the node dismisses. -->
            {#if seedAtSelf}
                <div class="measure-self-badge">
                    <span class="measure-self-dot"></span>{m.ofmap_ui_at_your_location()}
                </div>
            {/if}
            <button class="measure-btn measure-share" onclick={sharePoint} title={m.ofmap_ui_copy_gps_title()}>
                {#if copied}
                    {m.ofmap_ui_copied()}
                {:else if copyFailed}
                    {m.ofmap_ui_copy_failed()}
                {:else}
                    <ports.ui.Icon name="copy" size={13} style="flex-shrink:0" />
                    {m.ofmap_ui_copy()}
                {/if}
            </button>
            <button class="measure-btn measure-plot" class:at-self={seedAtSelf} onclick={dropPlot} title={seedAtSelf ? m.ofmap_ui_drop_plot_self_title() : m.ofmap_ui_drop_plot_title()}>
                <img class="measure-plot-ic" src={iconPath("qualityWhite")} alt="" />
                {m.ofmap_ui_plot()}
            </button>
            <button class="measure-btn measure-save" onclick={() => savePoint("pin")} title={m.ofmap_ui_drop_pin_title()}>
                <img class="measure-pin-ic" src={iconPath("pin")} alt="" />
                {m.ofmap_ui_pin()}
            </button>
            <button class="measure-btn measure-save" onclick={() => savePoint("cachePin")} title={m.ofmap_ui_drop_cache_title()}>
                <img class="measure-pin-ic" src={iconPath("cache")} alt="" />
                {m.ofmap_ui_cache()}
            </button>
            {#if plotNote}
                <p class="rt-note grid-plot-note measure-plot-note" role="alert">{plotNote}</p>
            {/if}
        {:else}
            <div class="measure-col">
                {#if !paletteMode}
                    <!-- side="below": an upward menu would overlap the app header. -->
                    <ports.ui.SharePicker formats={shareFormats} side="below">
                        {#snippet trigger({ toggle }: { toggle: () => void })}
                            <button class="measure-btn measure-share" onclick={toggle} title={m.ofmap_ui_save_share_title()}>
                                <ports.ui.Icon name="upload" size={13} style="flex-shrink:0" />
                                {m.ofmap_ui_share()}
                            </button>
                        {/snippet}
                    </ports.ui.SharePicker>
                {/if}
                <button class="measure-btn measure-save" onclick={() => persist(false)} title={m.ofmap_ui_save()}>
                    <img class="measure-pin-ic" src={iconPath(isPolygon ? "poly" : "line")} alt="" />
                    {m.ofmap_ui_save()}
                </button>
            </div>
        {/if}
    </div>
{/if}

<style>
    /* z-index 16/17: BELOW the modules drawer (z 22) and its scrim (z 18). */
    .measure-total {
        position: absolute;
        transform: translate(-50%, calc(-100% - 16px));
        z-index: 16;
        pointer-events: none;
    }
    .measure-total.measure-below { transform: translate(-50%, 16px); }
    /* Glide only WHILE dragging; during a map pan it must stick to the snake with no lag. */
    .measure-total.measure-gliding,
    .measure-pop.measure-gliding {
        transition: left 0.14s ease-out, top 0.14s ease-out;
    }

    .measure-pop {
        position: absolute;
        /* An abspos box near the right edge otherwise shrink-to-fits and squishes the buttons. */
        width: max-content;
        transform: translate(-50%, calc(-100% - 52px));
        z-index: 17;
        display: flex;
        align-items: stretch;
        gap: 0.25rem;
        padding: 0.25rem;
        background: rgba(20, 20, 20, 0.45);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border: 1px solid color-mix(in srgb, var(--color-accent), transparent 60%);
        border-radius: 10px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
    }
    .measure-pop.measure-below { transform: translate(-50%, 52px); }

    .measure-col {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }
    .measure-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--rt-space-1, 0.25rem);
        padding: var(--rt-space-2, 0.35rem) var(--rt-space-3, 0.55rem);
        background: transparent;
        border: 1px solid currentColor;
        border-radius: var(--rt-radius-sm, 0.4rem);
        font-family: var(--rt-font-display);
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        /* Labels wash out over a pale satellite frame without this. */
        text-shadow:
            0 1px 1px rgba(0, 0, 0, 0.95),
            0 0 3px rgba(0, 0, 0, 0.85),
            0 0 8px rgba(0, 0, 0, 0.5);
    }
    .measure-btn :global(svg),
    .measure-pin-ic,
    .measure-plot-ic {
        filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.9))
            drop-shadow(0 0 3px rgba(0, 0, 0, 0.6));
    }
    /* Sized by HEIGHT: the pin art is much taller than wide and a width cap inflated its button. */
    .measure-pin-ic, .measure-plot-ic { height: 24px; width: auto; flex-shrink: 0; display: block; }

    /* keep in sync with POP_GRID_W */
    .measure-pop.measure-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        width: 160px;
    }
    .measure-plot-note {
        grid-column: 1 / -1;
        margin: 0;
    }
    .measure-pop.measure-grid .measure-btn {
        padding: 0 0.2rem;
        height: 32px;
    }

    /* #1da1f2 matches the user-location dot. */
    .measure-self-badge {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.3rem;
        padding: 0.15rem 0.3rem 0.05rem;
        font-family: var(--rt-font-display);
        font-size: 0.66rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: #1da1f2;
        text-shadow:
            0 1px 1px rgba(0, 0, 0, 0.95),
            0 0 3px rgba(0, 0, 0, 0.85);
    }
    .measure-self-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #1da1f2;
        border: 1.5px solid var(--rt-fg);
        box-shadow: 0 0 0 2px rgba(29, 161, 242, 0.3);
        flex-shrink: 0;
    }
    .measure-plot.at-self {
        color: #1da1f2;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, #1da1f2 55%, transparent);
    }
    .measure-plot.at-self:active { background: color-mix(in srgb, #1da1f2 16%, transparent); }
    .measure-col :global(.rt-sharepick) { display: flex; }
    .measure-col :global(.rt-sharepick .measure-btn) { flex: 1; }
    .measure-share { color: var(--color-accent-terracotta); }
    .measure-share:active { background: color-mix(in srgb, var(--color-accent-terracotta) 16%, transparent); }
    .measure-save { color: var(--color-accent); }
    .measure-save:active { background: color-mix(in srgb, var(--color-accent) 16%, transparent); }
    .measure-plot { color: #f2f2f2; }
    .measure-plot:active { background: color-mix(in srgb, #ffffff 14%, transparent); }
</style>
