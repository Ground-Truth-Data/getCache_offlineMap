/**
 * anchors.ts — canonical "where does a feature get offline blobs" map, shared by the reconcile (`/mobile/offlinev4`) and the debug array (`/app/debug/blobs/array`).
 * Point → one blob at the point. Line → sampled ALONG it (`sampleLineAnchors`) every LINE_STEP_KM, a ribbon not one midpoint. Polygon → ONE blob at centroid (`polygonAnchor`), deters huge polys. PDF/overlay → a blob at each of the four `overlayBounds` corners.
 * Overlap is expected — anchors dedup downstream by `satImageKey`, tile discs share one global deduped pile, nothing bakes twice.
 */
import { kmBetween } from "./kmGeo";
import { GRID_RADIUS_KM } from "../contract/grid";

export type Pt = [number, number];

/** A geometry's centre [lng,lat] (bbox midpoint), or null if no finite coords. */
function featureCenter(geom: GeoJSON.Geometry | undefined): Pt | null {
	if (!geom) return null;
	const box = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
	const fold = (c: unknown): void => {
		if (Array.isArray(c) && typeof c[0] === "number") {
			const [x, y] = c as number[];
			if (Number.isFinite(x) && Number.isFinite(y)) {
				box.w = Math.min(box.w, x);
				box.e = Math.max(box.e, x);
				box.s = Math.min(box.s, y);
				box.n = Math.max(box.n, y);
			}
			return;
		}
		if (Array.isArray(c)) for (const v of c) fold(v);
	};
	fold((geom as { coordinates?: unknown }).coordinates);
	if (!Number.isFinite(box.w)) return null;
	return [(box.w + box.e) / 2, (box.s + box.n) / 2];
}

// The step is 1.6× the radius of the disc it must keep continuous, so
// consecutive discs OVERLAP into one ribbon and never leave a gap.
//
// ⚠️ THE DISC IS THE ROAD DISC, NOT THE PHOTO DISC. A line bakes a CORRIDOR:
// roads only, no photo at all (the blob engine queues a corridor's anchors
// with `photo: false`, which is the whole of what "corridor" means). This
// was BAKE_RADIUS_KM * 1.6 = 3.2 km — the spacing that keeps 2 km SATELLITE
// discs touching, on the one geometry that never fetches one. An 86 km line
// took ~28 anchors where 5 cover the same ground; the extra 23 deduped
// downstream, so they cost passes through reconcile rather than bytes, and
// the ribbon was no tighter for them.
//
// If a line ever earns photos, this becomes a per-disc choice again — the
// ribbon rule (1.6× radius) is the part that holds either way.
const LINE_STEP_KM = GRID_RADIUS_KM * 1.6;

/** Walk a polyline, drop an anchor at the start, every `stepKm`, and at the end — overlapping anchors dedup downstream by `satImageKey` (tile discs by the global tile pile). */
function sampleLineAnchors(
	coords: Pt[],
	stepKm: number = LINE_STEP_KM,
): Pt[] {
	const pts = (coords ?? []).filter(
		(p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
	) as Pt[];
	if (pts.length === 0) return [];
	if (pts.length === 1) return [pts[0]];
	const out: Pt[] = [pts[0]];
	let acc = 0; // km accumulated since the last anchor
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const segKm = kmBetween(a, b);
		if (segKm === 0) continue;
		let t0 = 0; // fraction of THIS segment already consumed
		while (acc + (1 - t0) * segKm >= stepKm) {
			const t = t0 + (stepKm - acc) / segKm;
			out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
			t0 = t;
			acc = 0;
		}
		acc += (1 - t0) * segKm;
	}
	const last = pts[pts.length - 1];
	if (kmBetween(out[out.length - 1], last) > 0.01) out.push(last);
	return out;
}

/** A polygon's centroid (area-weighted, outer ring) — ONE blob on purpose, deters drawing a giant polygon to vacuum a huge area; falls back to vertex mean for a degenerate (zero-area) ring. */
function polygonAnchor(rings: Pt[][]): Pt[] {
	const outer = rings?.[0];
	if (!outer || outer.length < 3) {
		const c = featureCenter({
			type: "Polygon",
			coordinates: rings,
		} as GeoJSON.Geometry);
		return c ? [c] : [];
	}
	let a = 0;
	let cx = 0;
	let cy = 0;
	for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
		const cross = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
		a += cross;
		cx += (outer[j][0] + outer[i][0]) * cross;
		cy += (outer[j][1] + outer[i][1]) * cross;
	}
	a *= 0.5;
	if (Math.abs(a) < 1e-12) {
		const mx = outer.reduce((s, p) => s + p[0], 0) / outer.length;
		const my = outer.reduce((s, p) => s + p[1], 0) / outer.length;
		return [[mx, my]];
	}
	return [[cx / (6 * a), cy / (6 * a)]];
}

/** Should this feature seed offline blobs at all? EVERY feature does today (pins, PDF/KML/KMZ, polygons, lines, plots) — kept as a function so every `anchorsOf` call site shares one definition if the policy ever narrows. */
export function isBlobAnchor(_f: {
	geometry: GeoJSON.Feature | null;
}): boolean {
	return true;
}

/**
 * THE CEILING. No feature earns more than this many blobs, whatever its shape
 * or point count. At 30 km a blob is ~50 MB of roads, so ten is ~500 MB — half
 * a 1 GB budget on ONE feature, which is already generous.
 *
 * This is what makes an import of unknown provenance safe: a traced river with
 * 40,000 vertices, a survey line across a province, a polygon with hundreds of
 * points. The import still succeeds and the feature still draws in full — only
 * the offline baking is capped, so the failure mode is "less map saved", never
 * a refused file or a blown budget.
 */
export const MAX_ANCHORS_PER_FEATURE = 10;

/**
 * Thin a list down to the ceiling, keeping it SPREAD over the whole geometry.
 *
 * Evenly, never the first ten: a 2000 km line would otherwise bake its first
 * 300 km densely and leave everything past that with no map at all. Thinned,
 * the coverage is sparser but reaches both ends. Ends are always kept — they
 * are where someone actually starts and finishes.
 */
function thinToCeiling(pts: Pt[]): Pt[] {
	if (pts.length <= MAX_ANCHORS_PER_FEATURE) return pts;
	const out: Pt[] = [];
	const step = (pts.length - 1) / (MAX_ANCHORS_PER_FEATURE - 1);
	for (let i = 0; i < MAX_ANCHORS_PER_FEATURE; i++)
		out.push(pts[Math.round(i * step)]);
	return out;
}

/** The offline-coverage anchors for ANY feature — a LIST, since one blob isn't enough for long geometry (see file header for per-type rules), capped at {@link MAX_ANCHORS_PER_FEATURE}. Callers iterating a feature collection should gate on {@link isBlobAnchor} first. */
export function anchorsOf(f: {
	geometry: GeoJSON.Feature | null;
	overlayBounds: [number, number, number, number] | null;
}): Pt[] {
	const g = f.geometry?.geometry as GeoJSON.Geometry | undefined;
	if (!g) {
		if (f.overlayBounds) {
			const [w, s, e, n] = f.overlayBounds;
			// four corners of the PDF/map sheet — covers the whole imported extent (30km road discs from the corners fill the middle in).
			return [
				[w, s],
				[w, n],
				[e, s],
				[e, n],
			];
		}
		return [];
	}
	switch (g.type) {
		case "Point":
			return [g.coordinates as Pt];
		case "MultiPoint":
			return thinToCeiling(g.coordinates as Pt[]);
		case "LineString":
			return thinToCeiling(sampleLineAnchors(g.coordinates as Pt[]));
		case "MultiLineString":
			// Wrapped, never bare: `flatMap` passes the INDEX as the second
			// argument, which would land in `stepKm` and space part 1 at 1 km.
			return thinToCeiling(
				(g.coordinates as Pt[][]).flatMap((part) => sampleLineAnchors(part)),
			);
		case "Polygon":
			return polygonAnchor(g.coordinates as Pt[][]);
		case "MultiPolygon":
			return thinToCeiling((g.coordinates as Pt[][][]).flatMap(polygonAnchor));
		default: {
			const c = featureCenter(g);
			return c ? [c] : [];
		}
	}
}
