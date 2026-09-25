/** Where a feature gets offline blobs: point → one; line → a ribbon every LINE_STEP_KM; polygon → ONE at the centroid (deters huge polys); overlay → its four corners. */
import { kmBetween } from "./kmGeo";
import { GRID_RADIUS_KM } from "../contract/grid";

export type Pt = [number, number];

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

// 1.6× the ROAD disc radius (a line bakes a corridor, no photo), so consecutive discs overlap into one ribbon.
const LINE_STEP_KM = GRID_RADIUS_KM * 1.6;

/** An anchor at the start, every `stepKm`, and at the end. */
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
	let acc = 0;
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const segKm = kmBetween(a, b);
		if (segKm === 0) continue;
		let t0 = 0;
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

/** Area-weighted centroid of the outer ring; vertex mean for a zero-area ring. */
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

/** Every feature seeds blobs today; a function so the policy has one home if it narrows. */
export function isBlobAnchor(_f: {
	geometry: GeoJSON.Feature | null;
}): boolean {
	return true;
}

/** Ten blobs ≈ 500 MB, half a 1 GB budget on ONE feature; an import of any size still draws in full, only the baking is capped. */
export const MAX_ANCHORS_PER_FEATURE = 10;

/** Evenly spread, never the first ten, so a long line reaches both ends. */
function thinToCeiling(pts: Pt[]): Pt[] {
	if (pts.length <= MAX_ANCHORS_PER_FEATURE) return pts;
	const out: Pt[] = [];
	const step = (pts.length - 1) / (MAX_ANCHORS_PER_FEATURE - 1);
	for (let i = 0; i < MAX_ANCHORS_PER_FEATURE; i++)
		out.push(pts[Math.round(i * step)]);
	return out;
}

/** The offline-coverage anchors for ANY feature, capped at {@link MAX_ANCHORS_PER_FEATURE}. */
export function anchorsOf(f: {
	geometry: GeoJSON.Feature | null;
	overlayBounds: [number, number, number, number] | null;
}): Pt[] {
	const g = f.geometry?.geometry as GeoJSON.Geometry | undefined;
	if (!g) {
		if (f.overlayBounds) {
			const [w, s, e, n] = f.overlayBounds;
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
			// Wrapped: bare `flatMap` would pass the index as `stepKm`.
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
