<!-- Snake Ruler measure tool. Owns all its own state and never touches draw state, so it cannot open the draw palette. -->
<script lang="ts">
import { iconPath } from "../shared/icons";
import handShovelCursor from "$gc/assets/hand_shovel_cursor.webp";
import handShovelCursorRight from "$gc/assets/hand_shovel_cursor_right.webp";
import handShovelCursor100 from "$gc/assets/hand_shovel_cursor_100.webp";
import pinDefaultUrl from "../assets/pin_library_small/pin_default_sm.webp";
import xCloseWhite from "$gc/assets/x_close_white.webp";
import type { Feature } from "geojson";
import type { Map as MapboxMap } from "mapbox-gl";
import { area, length as turfLength } from "@turf/turf";
import { markerCtor } from "../shared/rendererOf";
import type { Lnglat } from "$parent/siblings/getCache_OnlineMap/lib/draw/mapDraw";
import { formatHectares, formatMeasureDist } from "../panels/measureFormat";
import { legLabelsReadable } from "./legLabelCrowding";
import { type Rect, mapKeepOutRects, shiftClear } from "../shared/mapKeepOut";
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
    onMeasureDrag,
    onPersist,
    onSavePoint,
    onPlot,
    onActivate,
    userCoord,
    onSnapSelf,
    gridSnap,
    setGridGlow,
}: {
    ports: MapHostPorts;
    map: MapboxMap | null;
    /** Seed from the host's double-tap: plants the first node. */
    measureEvent?: { lng: number; lat: number; n: number } | null;
    /** Palette tap-to-build mode; null = double-tap + hands mode. */
    armKind?: "line" | "polygon" | "pin" | null;
    /** Fired the instant an end is grabbed so the host can drop its stale "Drop a pin" card. */
    onMeasureDrag?: (() => void) | undefined;
    onPersist: (
        kind: "line" | "polygon",
        verts: Lnglat[],
        share: boolean,
        format?: MapShareFormat,
    ) => void;
    onSavePoint?: ((lng: number, lat: number) => void) | undefined;
    /** `atSelf` = seed snapped onto the blue dot (proof-of-presence); `plusCode` = snapped grid dot, null if dropped free. */
    onPlot?:
        | ((
              lng: number,
              lat: number,
              atSelf: boolean,
              plusCode: string | null,
          ) => void)
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
} = $props();

let active = $state(false);
let verts: Lnglat[] = $state([]);
let cursor: Lnglat | null = $state(null); // live tip while dragging an end
let isPolygon = $state(false);
let dragFromHead = false;
let dragAnchor: Lnglat | null = null;
let moveIndex: number | null = $state(null); // polygon vertex being reshaped
let mapMoveSeq = $state(0);
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
let gridSnapDot = $state<{ lng: number; lat: number; plusCode: string } | null>(
    null,
);

const MEASURE_LINE_SRC = "measure-line";
const MEASURE_NODES_SRC = "measure-nodes";
const MEASURE_FILL_SRC = "measure-fill";
const MEASURE_TICKS_SRC = "measure-ticks";
const MEASURE_ENDDOTS_SRC = "measure-end-dots";
const MEASURE_SNAP_PX = 18;
const SELF_SNAP_PX = 22; // ≈44px touch target
const FINISH_TAP_PX = 22;
const MEASURE_UNSNAP_PX = 34; // hysteresis: un-snaps only past this
const LEG_LABEL_FRAC = 0.78;
const LEG_LABEL_OFF = 18;
const LABEL_HALF_H = 10;
const TOTAL_TAIL_BIAS = 0.35;

function setData(id: string, fc: GeoJSON.FeatureCollection) {
    const src = map?.getSource(id);
    if (src && "setData" in src) {
        (src as unknown as { setData: (d: GeoJSON.FeatureCollection) => void }).setData(fc);
    }
}

function ensureLayers() {
    if (!map || map.getSource(MEASURE_LINE_SRC)) return;
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    map.addSource(MEASURE_FILL_SRC, { type: "geojson", data: empty });
    map.addSource(MEASURE_LINE_SRC, { type: "geojson", data: empty });
    map.addSource(MEASURE_TICKS_SRC, { type: "geojson", data: empty });
    map.addSource(MEASURE_NODES_SRC, { type: "geojson", data: empty });
    map.addSource(MEASURE_ENDDOTS_SRC, { type: "geojson", data: empty });
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
            "circle-stroke-color": "#f5d565", "circle-stroke-width": 2,
        },
    });
    // Invisible fat halo so a node is easy to grab with a finger.
    map.addLayer({
        id: "measure-nodes-halo", type: "circle", source: MEASURE_NODES_SRC,
        paint: { "circle-radius": 16, "circle-color": "#ffffff", "circle-opacity": 0.01 },
    });
    map.addLayer({
        id: "measure-end-dots", type: "circle", source: MEASURE_ENDDOTS_SRC,
        paint: { "circle-radius": 2, "circle-color": "#c97a4a" },
    });
}

// Ticks are built per leg, in screen px, so they never fight across a bend; rebuilt on every move.
function buildTicksFC(ring: Lnglat[]): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    if (!map || ring.length < 2) return { type: "FeatureCollection", features };
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
    return { type: "FeatureCollection", features };
}

function liveVerts(): Lnglat[] {
    if (isPolygon && moveIndex !== null && cursor) {
        const v = [...verts];
        v[moveIndex] = cursor;
        return v;
    }
    return verts;
}
function points(): Lnglat[] {
    if (isPolygon) return liveVerts();
    if (!cursor) return [...verts];
    return dragFromHead ? [cursor, ...verts] : [...verts, cursor];
}

function render() {
    if (!map) return;
    ensureLayers();
    const pts = points();
    const ring: Lnglat[] =
        isPolygon && pts.length >= 3 ? [...pts, pts[0]] : pts;
    setData(MEASURE_LINE_SRC, {
        type: "FeatureCollection",
        features: ring.length >= 2
            ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } }]
            : [],
    });
    setData(MEASURE_TICKS_SRC, buildTicksFC(ring));
    setData(MEASURE_NODES_SRC, {
        type: "FeatureCollection",
        features: (isPolygon ? pts : verts).map((c) => ({
            type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c },
        })),
    });
    // Fill auto-closes the ring while still open; no visible line across the open side.
    setData(MEASURE_FILL_SRC, {
        type: "FeatureCollection",
        features: pts.length >= 3
            ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] } }]
            : [],
    });
    const endPts: Lnglat[] = isPolygon
        ? pts
        : pts.length >= 2
          ? [pts[0], pts[pts.length - 1]]
          : pts.length === 1
            ? [pts[0]]
            : [];
    setData(MEASURE_ENDDOTS_SRC, {
        type: "FeatureCollection",
        features: endPts.map((c) => ({
            type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c },
        })),
    });
    renderLegs();
    updateEndCursors();
}

function clearAll() {
    cursor = null;
    isPolygon = false;
    moveIndex = null;
    copied = false;
    copyFailed = false;
    document.body.classList.remove("rt-snake-grabbing");
    if (copiedTimer) clearTimeout(copiedTimer);
    setData(MEASURE_LINE_SRC, { type: "FeatureCollection", features: [] });
    setData(MEASURE_TICKS_SRC, { type: "FeatureCollection", features: [] });
    setData(MEASURE_NODES_SRC, { type: "FeatureCollection", features: [] });
    setData(MEASURE_FILL_SRC, { type: "FeatureCollection", features: [] });
    setData(MEASURE_ENDDOTS_SRC, { type: "FeatureCollection", features: [] });
    clearLegs();
    headCursor?.remove();
    headCursor = null;
    tailCursor?.remove();
    tailCursor = null;
}

// HEAD (vertex 0) = LEFT hand; TAIL = RIGHT hand. Widths chosen so both render ≈64px tall.
const HEAD_CURSOR = {
    src: handShovelCursor,
    w: 47,
    offset: [16, -2] as [number, number], // fingertip nudge
};
const TAIL_CURSOR = {
    src: handShovelCursorRight,
    w: 28,
    offset: [4, -2] as [number, number],
};
let headCursor: mapboxgl.Marker | null = null;
let tailCursor: mapboxgl.Marker | null = null;
function makeEndCursorEl(src: string, w: number): HTMLElement {
    const el = document.createElement("div");
    el.className = "rt-measure-grab";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.draggable = false;
    img.style.width = `${w}px`;
    el.appendChild(img);
    return el;
}
// move/up listeners live on WINDOW so the gesture survives the sprite being removed mid-drag when it snaps to a polygon.
function wireHandDrag(el: HTMLElement, which: "head" | "tail") {
    let moved = false;
    // Node-to-pointer gap at grab time, so the node doesn't jump to the cursor.
    let grabDX = 0;
    let grabDY = 0;
    // preventDefault blocks the mousemove the fake cursor follows, so it is parked from pointer events instead. 11,5 = FAKE_CURSOR_HOTSPOT.
    let fakeCursor: HTMLElement | null = null;
    const syncFakeCursor = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        fakeCursor ??= document.querySelector<HTMLElement>(".fake-cursor");
        if (fakeCursor) {
            fakeCursor.style.transform = `translate3d(${e.clientX - 11}px, ${e.clientY - 5}px, 0)`;
        }
    };
    const toLngLat = (e: PointerEvent): Lnglat => {
        const r = map!.getCanvas().getBoundingClientRect();
        const p = map!.unproject([e.clientX - r.left + grabDX, e.clientY - r.top + grabDY]);
        return [p.lng, p.lat];
    };
    let raf = 0;
    let pendingLL: Lnglat | null = null;
    const flush = () => {
        raf = 0;
        if (!pendingLL || !map) return;
        const [lng, lat] = pendingLL;
        hover(lng, lat);
    };
    const onMove = (e: PointerEvent) => {
        if (!map) return;
        moved = true;
        syncFakeCursor(e);
        pendingLL = toLngLat(e);
        if (!raf) raf = requestAnimationFrame(flush);
    };
    const onUp = (e: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        pendingLL = null;
        syncFakeCursor(e); // park it at the release point BEFORE it un-hides
        document.body.classList.remove("rt-snake-grabbing");
        if (map) map.dragPan.enable();
        if (moved && map) {
            const [lng, lat] = toLngLat(e);
            commitAt(lng, lat);
        } else {
            cursor = null;
            isPolygon = false;
            render();
        }
        moved = false;
    };
    el.addEventListener("pointerdown", (e: PointerEvent) => {
        if (!active || !map) return;
        e.preventDefault();
        e.stopPropagation();
        moved = false;
        dragFromHead = which === "head";
        dragAnchor = which === "head" ? verts[0] : verts[verts.length - 1];
        {
            const r0 = map.getCanvas().getBoundingClientRect();
            const ns = map.project({ lng: dragAnchor[0], lat: dragAnchor[1] });
            grabDX = ns.x - (e.clientX - r0.left);
            grabDY = ns.y - (e.clientY - r0.top);
        }
        onMeasureDrag?.();
        map.dragPan.disable();
        // The var holds the WHOLE `url(...)` token: `url(var(--x))` is invalid CSS.
        document.body.style.setProperty(
            "--rt-grab-cursor",
            `url(${handShovelCursor100})`,
        );
        document.body.classList.add("rt-snake-grabbing");
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
    });
}
function updateEndCursors() {
    if (!map) return;
    const pts = points();
    const show = active && !isPolygon && pts.length >= 1 && armed !== "pin";
    if (!show) {
        headCursor?.remove();
        headCursor = null;
        tailCursor?.remove();
        tailCursor = null;
        return;
    }
    const head = pts[0];
    const tail = pts[pts.length - 1];
    if (!headCursor) {
        const el = makeEndCursorEl(HEAD_CURSOR.src, HEAD_CURSOR.w);
        headCursor = new (markerCtor(map))({ element: el, anchor: "top", offset: HEAD_CURSOR.offset })
            .setLngLat(head).addTo(map);
        wireHandDrag(el, "head");
    } else {
        headCursor.setLngLat(head);
    }
    if (pts.length >= 2) {
        if (!tailCursor) {
            const el = makeEndCursorEl(TAIL_CURSOR.src, TAIL_CURSOR.w);
            tailCursor = new (markerCtor(map))({ element: el, anchor: "top", offset: TAIL_CURSOR.offset })
                .setLngLat(tail).addTo(map);
            wireHandDrag(el, "tail");
        } else {
            tailCursor.setLngLat(tail);
        }
    } else {
        tailCursor?.remove();
        tailCursor = null;
    }
}

let legMarkers: mapboxgl.Marker[] = [];
let legLabelsShown = false;
/** FALSE with no labels to place, matching what a cleared render leaves, or the move handler rebuilds every pan frame. */
function legLabelsFit(): boolean {
    if (!map) return false;
    const m = map;
    const anchors = legLabelAnchors();
    if (!anchors.length) return false;
    return legLabelsReadable(
        anchors.map(({ geo, off }) => {
            const p = m.project({ lng: geo[0], lat: geo[1] });
            return { x: p.x + off[0], y: p.y + off[1] };
        }),
    );
}
function clearLegs() {
    for (const m of legMarkers) m.remove();
    legMarkers = [];
    legLabelsShown = false;
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
function legLabelAnchors(): Array<{ geo: Lnglat; off: [number, number] }> {
    if (!map) return [];
    const pts = points();
    const ring = isPolygon && pts.length >= 3 ? [...pts, pts[0]] : pts;
    if (ring.length < (isPolygon ? 4 : 3)) return [];
    const out: Array<{ geo: Lnglat; off: [number, number] }> = [];
    for (let i = 0; i < ring.length - 1; i++) {
        const geo: Lnglat = [
            ring[i][0] + (ring[i + 1][0] - ring[i][0]) * LEG_LABEL_FRAC,
            ring[i][1] + (ring[i + 1][1] - ring[i][1]) * LEG_LABEL_FRAC,
        ];
        const a = map.project({ lng: ring[i][0], lat: ring[i][1] });
        const b = map.project({ lng: ring[i + 1][0], lat: ring[i + 1][1] });
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        let px = -dy / len, py = dx / len;
        if (py > 0) { px = -px; py = -py; } // upper side
        out.push({ geo, off: [px * LEG_LABEL_OFF, py * LEG_LABEL_OFF] });
    }
    return out;
}
function renderLegs() {
    clearLegs();
    if (!map) return;
    const pts = points();
    const ring = isPolygon && pts.length >= 3 ? [...pts, pts[0]] : pts;
    if (ring.length < (isPolygon ? 4 : 3)) return;
    const anchors = legLabelAnchors();
    // Crowded legs show NO labels: overlapping digits read as a wrong number.
    legLabelsShown = legLabelsFit();
    if (!legLabelsShown) return;
    for (let i = 0; i < ring.length - 1; i++) {
        const segKm = turfLength({
            type: "Feature", properties: {},
            geometry: { type: "LineString", coordinates: [ring[i], ring[i + 1]] },
        });
        if (anchors[i]) addLeg(anchors[i].geo, formatMeasureDist(segKm), anchors[i].off);
    }
}

function hover(lng: number, lat: number) {
    if (!active) return;
    if (map && verts.length >= 3) {
        const anchorIdx = dragFromHead ? verts.length - 1 : 0;
        const anchor = verts[anchorIdx];
        const f = map.project({ lng: anchor[0], lat: anchor[1] });
        const p = map.project({ lng, lat });
        const d2 = (f.x - p.x) ** 2 + (f.y - p.y) ** 2;
        const threshold = isPolygon ? MEASURE_UNSNAP_PX : MEASURE_SNAP_PX;
        if (d2 < threshold ** 2) {
            isPolygon = true;
            cursor = anchor;
            render();
            return;
        }
    }
    isPolygon = false;
    cursor = [lng, lat];
    render();
}
function commitAt(lng: number, lat: number) {
    if (!active) return;
    if (isPolygon) {
        cursor = null;
        render();
        return;
    }
    // Releasing near the grabbed end cancels: no tiny trailing stub.
    if (dragAnchor && map) {
        const a = map.project({ lng: dragAnchor[0], lat: dragAnchor[1] });
        const p = map.project({ lng, lat });
        if ((a.x - p.x) ** 2 + (a.y - p.y) ** 2 < MEASURE_SNAP_PX ** 2) {
            cursor = null;
            render();
            return;
        }
    }
    verts = dragFromHead ? [[lng, lat], ...verts] : [...verts, [lng, lat]];
    seedAtSelf = false;
    cursor = null;
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

function start(seed?: Lnglat) {
    active = true;
    armed = null;
    cursor = null;
    isPolygon = false;
    let atSelf = false;
    if (seed) {
        const snapped = snapSeedToSelf(seed);
        seed = snapped.seed;
        atSelf = snapped.atSelf;
    }
    seedAtSelf = atSelf;
    verts = seed ? [seed] : [];
    onActivate?.();
    ensureLayers();
    render();
    if (atSelf) onSnapSelf?.();
}
function startArmed(kind: "line" | "polygon" | "pin") {
    active = true;
    armed = kind;
    cursor = null;
    moveIndex = null;
    isPolygon = false;
    seedAtSelf = false;
    verts = [];
    onActivate?.();
    ensureLayers();
    render();
}
function discard() {
    active = false;
    armed = null;
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
    if (armed) return;
    // A fast final click-to-commit can read as a dblclick; swallow the seed so the fresh popover isn't torn down.
    if (performance.now() - lastCommitAt < 600) return;
    start([ev.lng, ev.lat]);
});

$effect(() => {
    const k = armKind;
    if (k && armed !== k) startArmed(k);
    else if (!k && armed) discard();
});

// Hands mode is click-to-place: tap the LAST node to commit, the FIRST (3+ nodes) to close.
$effect(() => {
    const m = map;
    if (!m) return;
    const onClick = (e: mapboxgl.MapMouseEvent) => {
        if (!active) return;
        const pt: Lnglat = [e.lngLat.lng, e.lngLat.lat];
        const nearIdx = verts.findIndex((v) => {
            const q = m.project({ lng: v[0], lat: v[1] });
            return (q.x - e.point.x) ** 2 + (q.y - e.point.y) ** 2 < FINISH_TAP_PX ** 2;
        });
        if (armed === "pin") {
            // Deferred so the host's own map-click handler can't instantly clear the fresh pin's selection.
            const [lng, lat] = pt;
            queueMicrotask(() => {
                onSavePoint?.(lng, lat);
                discard();
            });
        } else if (armed === "line") {
            if (verts.length === 0) {
                verts = [pt];
                render();
            }
        } else if (armed === "polygon") {
            if (nearIdx !== -1) return;
            verts = [...verts, pt];
            isPolygon = verts.length >= 3;
            render();
        } else {
            if (isPolygon) return;
            if (nearIdx === verts.length - 1 && canFinish) {
                // This handler registers before the host's; a synchronous select would read as an outside tap and get deselected.
                queueMicrotask(() => persist(false));
                return;
            }
            if (nearIdx === 0 && verts.length >= 3) {
                isPolygon = true;
                cursor = null;
                render();
                return;
            }
            if (nearIdx !== -1) return;
            verts = [...verts, pt];
            seedAtSelf = false;
            cursor = null;
            render();
        }
    };
    m.on("click", onClick);
    return () => m.off("click", onClick);
});

$effect(() => {
    if (active && verts.length >= 2) onMeasureDrag?.();
});

$effect(() => {
    const m = map;
    if (!m) return;
    let dragging = false;
    let moved = false;
    const down = (e: mapboxgl.MapLayerMouseEvent | mapboxgl.MapLayerTouchEvent) => {
        if (!active || verts.length === 0) return;
        let nearest = -1;
        let nearestD = Number.POSITIVE_INFINITY;
        for (let i = 0; i < verts.length; i++) {
            const q = m.project({ lng: verts[i][0], lat: verts[i][1] });
            const d = (q.x - e.point.x) ** 2 + (q.y - e.point.y) ** 2;
            if (d < nearestD) { nearestD = d; nearest = i; }
        }
        if (isPolygon) {
            moveIndex = nearest;
        } else {
            const isHead = nearest === 0;
            const isTail = nearest === verts.length - 1;
            if (!isHead && !isTail) return;
            dragFromHead = isHead && !isTail;
            dragAnchor = verts[nearest];
            moveIndex = null;
            onMeasureDrag?.();
        }
        e.preventDefault();
        dragging = true;
        moved = false;
        m.dragPan.disable();
    };
    const move = (e: { lngLat: { lng: number; lat: number } }) => {
        if (!dragging) return;
        moved = true;
        if (moveIndex !== null) {
            cursor = [e.lngLat.lng, e.lngLat.lat];
            render();
        } else {
            hover(e.lngLat.lng, e.lngLat.lat);
        }
    };
    const up = (e: { lngLat: { lng: number; lat: number } }) => {
        if (!dragging) return;
        dragging = false;
        m.dragPan.enable();
        if (moveIndex !== null) {
            if (moved) {
                const v = [...verts];
                v[moveIndex] = [e.lngLat.lng, e.lngLat.lat];
                verts = v;
            }
            moveIndex = null;
            cursor = null;
            render();
        } else if (moved) {
            commitAt(e.lngLat.lng, e.lngLat.lat);
        } else {
            cursor = null;
            render();
        }
        moved = false;
    };
    m.on("mousedown", "measure-nodes-halo", down);
    m.on("touchstart", "measure-nodes-halo", down);
    m.on("mousedown", "measure-nodes", down);
    m.on("touchstart", "measure-nodes", down);
    m.on("mousemove", move);
    m.on("touchmove", move);
    m.on("mouseup", up);
    m.on("touchend", up);
    return () => {
        m.off("mousedown", "measure-nodes-halo", down);
        m.off("touchstart", "measure-nodes-halo", down);
        m.off("mousedown", "measure-nodes", down);
        m.off("touchstart", "measure-nodes", down);
        m.off("mousemove", move);
        m.off("touchmove", move);
        m.off("mouseup", up);
        m.off("touchend", up);
    };
});

const CHROME_STACK_PX = 150; // popover offset + height
const HAND_DROP_PX = 44; // hands hang below the end nodes
const VP_MARGIN = 14;
const OFFSCREEN_HIDE = 40;
const POP_HALF_W = 85;
const POP_GRID_W = 160; // keep in sync with .measure-grid width
const POP_EDGE_PX = 5;
const TOTAL_HALF_W = 72;
// keep in sync with the .measure-pop / .measure-total translates
const POP_OFFSET_PX = 52;
const TOTAL_OFFSET_PX = 16;
const POP_H = 78;

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
    const fitsAbove = minY - CHROME_STACK_PX >= VP_MARGIN;
    const belowY = maxY + HAND_DROP_PX;
    const fitsBelow = belowY + CHROME_STACK_PX <= H - VP_MARGIN;
    const below = !fitsAbove && fitsBelow;
    const cornered = !fitsAbove && !fitsBelow;
    const y = below ? belowY : minY;
    const clampX = (x: number, half: number, edge: number) =>
        Math.min(Math.max(x, edge + half), W - edge - half);
    const popHalf = singlePoint ? POP_GRID_W / 2 : POP_HALF_W;
    let popX = clampX(cx, popHalf, POP_EDGE_PX);

    // Dodge the map's floating chrome SIDEWAYS (upward reads as a diagonal leap), pill + popover as ONE box.
    const popW = popHalf * 2;
    // The snake itself is a keep-out: sideways from the crow's corner is straight onto the measurement.
    const snakeRect: Rect = {
        x: minX,
        y: minY,
        w: Math.max(maxX - minX, 1),
        h: Math.max(maxY - minY, 1),
    };
    const rects = [
        ...mapKeepOutRects(W, undefined, map.getCanvas()),
        snakeRect,
    ];
    const minPopX = POP_EDGE_PX;
    const maxPopX = W - POP_EDGE_PX - popW;
    const stackBox = (atY: number, isBelow: boolean): Rect => ({
        x: popX - popHalf,
        y: isBelow ? atY + TOTAL_OFFSET_PX : atY - POP_OFFSET_PX - POP_H,
        w: popW,
        h: POP_OFFSET_PX + POP_H - TOTAL_OFFSET_PX,
    });
    const shifted = shiftClear(stackBox(y, below), rects, minPopX, maxPopX);
    if (shifted !== null) popX = shifted + popHalf;

    // A sideways dodge drops the upward lift and sits level with the snake instead.
    const dodgedSideways =
        shifted !== null && Math.abs(shifted + popHalf - clampX(cx, popHalf, POP_EDGE_PX)) > 1;
    const levelY = dodgedSideways ? (minY + maxY) / 2 + POP_OFFSET_PX + POP_H / 2 : y;

    // The ✕ Discard lives in this box, so it must always be reachable; the `cornered` pan can silently refuse.
    const topOffset = below ? TOTAL_OFFSET_PX : -POP_OFFSET_PX - POP_H;
    const clampedY = Math.min(
        Math.max(levelY, VP_MARGIN - topOffset),
        H - VP_MARGIN - POP_H - topOffset,
    );

    return {
        popX,
        totalX: singlePoint
            ? popX
            : clampX(cx + (tailX - cx) * TOTAL_TAIL_BIAS, TOTAL_HALF_W, VP_MARGIN),
        y: clampedY,
        below,
        cornered,
        minY,
    };
});

$effect(() => {
    if (!map || !active) return;
    const a = popAnchor;
    if (!a?.cornered) return;
    const shortfall = VP_MARGIN + CHROME_STACK_PX - a.minY;
    if (shortfall > 4 && !map.isEasing()) {
        map.panBy([0, shortfall], { duration: 220 });
    }
});

let totalText = $derived.by(() => {
    if (!active) return null;
    const pts = points();
    if (pts.length >= 3) {
        const ring: Lnglat[] = [...pts, pts[0]];
        const poly: Feature = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
        const ha = formatHectares((area(poly) || 0) / 10000);
        return isPolygon ? ha : `≈ ${ha}`;
    }
    if (pts.length < 1) return null;
    if (pts.length === 1) return `${pts[0][1].toFixed(3)}°, ${pts[0][0].toFixed(3)}°`;
    const km = turfLength({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } });
    return formatMeasureDist(km);
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
function savePoint() {
    const p = verts[0];
    if (!p) return;
    onSavePoint?.(p[0], p[1]);
    discard();
}
function dropPlot() {
    const p = verts[0];
    if (!p) return;
    // Snap-to-self beats snap-to-grid: a plot ON YOU ignores the grid.
    const snap = seedAtSelf ? null : gridSnapDot;
    const lng = snap ? snap.lng : p[0];
    const lat = snap ? snap.lat : p[1];
    setGridGlow?.(null);
    onPlot?.(lng, lat, seedAtSelf, snap?.plusCode ?? null);
    discard();
}

$effect(() => {
    if (!map || !map.getLayer("measure-nodes")) return;
    map.setPaintProperty(
        "measure-nodes",
        "circle-stroke-color",
        seedAtSelf ? "#1da1f2" : "#f5d565",
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
    const onMove = () => {
        // Guard first: this fires every pan frame for the map's whole life.
        if (!active) return;
        mapMoveSeq += 1;
        const pts = points();
        const ring: Lnglat[] =
            isPolygon && verts.length >= 3 ? [...verts, verts[0]] : pts;
        setData(MEASURE_TICKS_SRC, buildTicksFC(ring));
        // Rebuild ONLY when the crowding verdict flips; renderLegs recreates every marker's DOM.
        if (legLabelsShown !== legLabelsFit()) renderLegs();
    };
    m.on("move", onMove);
    return () => m.off("move", onMove);
});
</script>

{#if active && totalText && popAnchor}
    <div
        class="rt-line-label rt-line-label-total measure-total"
        class:measure-gliding={!!cursor}
        class:measure-below={popAnchor.below}
        style="left:{popAnchor.totalX}px; top:{popAnchor.y}px;"
    >{totalText}</div>
{/if}

<!-- Unanchorable snake: the popover carrying ✕ cannot be placed, and the user still needs a way out. -->
{#if active && !popAnchor}
    <button style="--x-white:url({xCloseWhite})" class="measure-btn measure-x measure-x-loose" onclick={discard} title="Discard" aria-label="Discard measurement">&#x2715;</button>
{/if}

{#if active && popAnchor && (canFinish || singlePoint)}
    <div class="measure-pop" class:measure-grid={singlePoint} class:measure-at-self={singlePoint && seedAtSelf} class:measure-gliding={!!cursor} class:measure-below={popAnchor.below} style="left:{popAnchor.popX}px; top:{popAnchor.y}px;">
        {#if singlePoint}
            <!-- 2×2 checkerboard: copy · ✕ / plot · save — Save under the right thumb. -->
            {#if seedAtSelf}
                <div class="measure-self-badge">
                    <span class="measure-self-dot"></span>At your location
                </div>
            {/if}
            <button class="measure-btn measure-share" onclick={sharePoint} title="Copy GPS to clipboard">
                {#if copied}
                    ✓ Copied!
                {:else if copyFailed}
                    Couldn't copy
                {:else}
                    <ports.ui.Icon name="copy" size={13} style="flex-shrink:0" />
                    Copy
                {/if}
            </button>
            <button style="--x-white:url({xCloseWhite})" class="measure-btn measure-x" onclick={discard} title="Discard" aria-label="Discard measurement">&#x2715;</button>
            <button class="measure-btn measure-plot" class:at-self={seedAtSelf} onclick={dropPlot} title={seedAtSelf ? "Drop a plot AT your location (proof you were here)" : "Drop a Quality 704 plot here"}>
                <img class="measure-plot-ic" src={iconPath("qualityWhite")} alt="" />
                Plot
            </button>
            <button class="measure-btn measure-save" onclick={savePoint} title="Save pin">
                <img class="measure-pin-ic" src={pinDefaultUrl} alt="" />
                Save
            </button>
        {:else}
            <div class="measure-col">
                {#if !paletteMode}
                    <!-- side="below": an upward menu would overlap the app header. -->
                    <ports.ui.SharePicker formats={shareFormats} side="below">
                        {#snippet trigger({ toggle }: { toggle: () => void })}
                            <button class="measure-btn measure-share" onclick={toggle} title="Save &amp; share">
                                <ports.ui.Icon name="upload" size={13} style="flex-shrink:0" />
                                Share
                            </button>
                        {/snippet}
                    </ports.ui.SharePicker>
                {/if}
                <button class="measure-btn measure-save" onclick={() => persist(false)} title="Save">
                    {#if isPolygon}
                        <ports.ui.Icon name="pentagon" size={13} style="flex-shrink:0" />
                    {:else}
                        <ports.ui.Icon name="share-nodes" size={13} style="flex-shrink:0" />
                    {/if}
                    Save
                </button>
            </div>
            <button style="--x-white:url({xCloseWhite})" class="measure-btn measure-x" onclick={discard} title="Discard" aria-label="Discard measurement">&#x2715;</button>
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

    .measure-x-loose {
        position: absolute;
        top: 14px;
        right: 14px;
        z-index: 18;
    }

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
    .measure-pin-ic { height: 24px; width: auto; flex-shrink: 0; display: block; }

    /* keep in sync with POP_GRID_W */
    .measure-pop.measure-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        width: 160px;
        gap: 0.25rem;
        align-items: stretch;
    }
    .measure-pop.measure-grid .measure-btn {
        padding: 0 0.2rem;
        height: 32px;
    }
    .measure-plot-ic { height: 24px; width: auto; flex-shrink: 0; display: block; }

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
    /* Red is reserved for the trash glyph; ✕ is a dismiss, nothing lost. */
    .measure-share { color: var(--color-accent-terracotta); }
    .measure-share:active { background: color-mix(in srgb, var(--color-accent-terracotta) 16%, transparent); }
    .measure-save { color: var(--color-accent); }
    .measure-save:active { background: color-mix(in srgb, var(--color-accent) 16%, transparent); }
    .measure-plot { color: #f2f2f2; }
    .measure-plot:active { background: color-mix(in srgb, #ffffff 14%, transparent); }
    .measure-x {
        align-self: stretch;
        /* `color` stays: the border is currentColor. The image arrives as a CSS var
           because `$gc/` inside a component <style> is NOT resolved by Vite. */
        font-size: 0;
        padding: 0 0.6rem;
        min-width: 2.2rem;
        background: var(--x-white) center / 15px 15px no-repeat;
        color: #f2f3ea;
    }
    .measure-x:active {
        background:
            var(--x-white) center / 15px 15px no-repeat,
            rgba(255, 255, 255, 0.14);
    }

    :global(.rt-measure-grab) {
        pointer-events: auto;
        cursor: grab;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
    }
    :global(.rt-measure-grab:active) { cursor: grabbing; }
    /* Hotspot 11,5 matches the fake cursor, which is hidden so there's a single hand. */
    :global(body.rt-snake-grabbing),
    :global(body.rt-snake-grabbing *) {
        cursor: var(--rt-grab-cursor) 11 5, grabbing !important;
    }
    :global(body.rt-snake-grabbing .fake-cursor) { visibility: hidden !important; }
    :global(.rt-measure-grab img) {
        display: block;
        height: auto;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55));
    }
    :global(body.rt-snake-grabbing .rt-measure-grab img) {
        opacity: 0.65;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55)) drop-shadow(0 0 8px rgba(255, 215, 0, 0.5));
    }
</style>
