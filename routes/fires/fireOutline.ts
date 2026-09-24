/**
 * A thin red line around each group of fire detections: a reading aid over satellite pixels,
 * never a surveyed perimeter, so no tap target, card or area readout.
 */

/** One VIIRS pixel; keep in sync with `CELL_DEG` in staticHeatSources. */
const CELL_DEG = 0.00375;

/** Cells apart that still count as one fire: joins offset satellite passes, not unrelated fires. */
const JOIN_CELLS = 2;

/** A line around 1-2 dots is noise; the dots themselves are never suppressed. */
const MIN_CELLS = 5;

/** About one flame icon wide. No margin and border flames straddle the line; whole cells claim unburnt ground. */
const OUTLINE_MARGIN_DEG = CELL_DEG * 0.8;

type Cell = number;

// One memo entry shared by both maps; callers clone it across the GL worker boundary.
let outlineMemoKey: string | null = null;
let outlineMemo: GeoJSON.FeatureCollection | null = null;
/** WeakRef: a strong ref would leak the hotspot array. */
let outlineMemoSrc: WeakRef<object> | null = null;
let outlineMemoLen = -1;

export function __resetOutlineMemoForTest(): void {
	outlineMemoKey = null;
	outlineMemo = null;
	outlineMemoSrc = null;
	outlineMemoLen = -1;
}

/** Primitive keys are ~3× faster than strings at this volume; ±2^20 cells covers the globe. */
function pack(gx: number, gy: number): Cell {
	return gx * 4_194_304 + gy;
}

function cellOf(lng: number, lat: number): { gx: number; gy: number } {
	return {
		gx: Math.round(lng / CELL_DEG),
		gy: Math.round(lat / CELL_DEG),
	};
}

/** Monotone chain; the ring does not repeat its first point. */
export function convexHull(
	points: readonly (readonly [number, number])[],
): [number, number][] {
	const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (pts.length <= 2) return pts.map((p) => [p[0], p[1]]);
	const cross = (
		o: readonly [number, number],
		a: readonly [number, number],
		b: readonly [number, number],
	): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

	const lower: (readonly [number, number])[] = [];
	for (const p of pts) {
		while (
			lower.length >= 2 &&
			cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
		)
			lower.pop();
		lower.push(p);
	}
	const upper: (readonly [number, number])[] = [];
	for (let i = pts.length - 1; i >= 0; i--) {
		const p = pts[i];
		while (
			upper.length >= 2 &&
			cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
		)
			upper.pop();
		upper.push(p);
	}
	lower.pop();
	upper.pop();
	return [...lower, ...upper].map((p) => [p[0], p[1]]);
}

/** Push every vertex outward from the centroid; longitude scaled by cos(lat) or the line tightens east-west further north. */
export function expandRing(
	ring: readonly (readonly [number, number])[],
	marginDeg: number,
): [number, number][] {
	if (ring.length < 3 || marginDeg <= 0) return ring.map((p) => [p[0], p[1]]);
	let cx = 0;
	let cy = 0;
	for (const p of ring) {
		cx += p[0];
		cy += p[1];
	}
	cx /= ring.length;
	cy /= ring.length;
	const lngScale = Math.max(0.2, Math.cos((cy * Math.PI) / 180));
	return ring.map((p) => {
		const dx = (p[0] - cx) * lngScale;
		const dy = p[1] - cy;
		const len = Math.hypot(dx, dy);
		if (len < 1e-12) return [p[0], p[1]] as [number, number];
		return [
			p[0] + ((dx / len) * marginDeg) / lngScale,
			p[1] + (dy / len) * marginDeg,
		] as [number, number];
	});
}

/** Flood fill over the grid, one outline per group; O(cells), no distance matrix. */
export function fireOutlines(
	hotspots: readonly { coordinates: readonly [number, number] }[],
	/** A stable identity for the fast-path memo; `hotspots` itself is rebuilt every pan. Omit for slower content hashing. */
	stableKey?: object,
): GeoJSON.FeatureCollection {
	// The memo must run BEFORE any work, or a hit still pays the cell bucketing.
	const fastKey = stableKey ?? hotspots;
	if (
		outlineMemo !== null &&
		outlineMemoSrc !== null &&
		outlineMemoSrc.deref() === fastKey &&
		outlineMemoLen === hotspots.length
	) {
		return outlineMemo;
	}

	// One point per cell is most of the speed-up.
	const cellPts = new Map<Cell, [number, number]>();
	for (const h of hotspots) {
		const [lng, lat] = h.coordinates;
		if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
		const { gx, gy } = cellOf(lng, lat);
		const key = pack(gx, gy);
		if (!cellPts.has(key)) cellPts.set(key, [lng, lat]);
	}

	// Second-tier memo keyed on the cell set: a commutative hash, never a sorted join.
	let sum = 0;
	let xor = 0;
	for (const k of cellPts.keys()) {
		sum = (sum + k) % 0x7fffffff;
		xor ^= k;
	}
	const key = `${cellPts.size}:${sum}:${xor}`;
	if (key === outlineMemoKey && outlineMemo !== null) {
		// Adopt the new array as the fast-path key, or an equal-but-new array pays bucketing forever.
		outlineMemoSrc = new WeakRef(fastKey as object);
		outlineMemoLen = hotspots.length;
		return outlineMemo;
	}

	const seen = new Set<Cell>();
	const features: GeoJSON.Feature[] = [];

	for (const start of cellPts.keys()) {
		if (seen.has(start)) continue;
		// Iterative: a province-sized blob is ~1,700 cells deep.
		const stack: Cell[] = [start];
		seen.add(start);
		const group: [number, number][] = [];

		while (stack.length > 0) {
			const cur = stack.pop() as Cell;
			const pt = cellPts.get(cur);
			if (pt) group.push(pt);
			const gy = ((cur % 4_194_304) + 4_194_304) % 4_194_304;
			const gx = Math.round((cur - gy) / 4_194_304);
			for (let dx = -JOIN_CELLS; dx <= JOIN_CELLS; dx++) {
				for (let dy = -JOIN_CELLS; dy <= JOIN_CELLS; dy++) {
					if (dx === 0 && dy === 0) continue;
					const n = pack(gx + dx, gy + dy);
					if (cellPts.has(n) && !seen.has(n)) {
						seen.add(n);
						stack.push(n);
					}
				}
			}
		}

		if (group.length < MIN_CELLS) continue;
		const ring = expandRing(convexHull(group), OUTLINE_MARGIN_DEG);
		if (ring.length < 3) continue;
		features.push({
			type: "Feature",
			properties: {},
			geometry: {
				type: "Polygon",
				coordinates: [[...ring, ring[0]]],
			},
		});
	}

	const result: GeoJSON.FeatureCollection = {
		type: "FeatureCollection",
		features,
	};
	outlineMemoKey = key;
	outlineMemo = result;
	outlineMemoSrc = new WeakRef(fastKey as object);
	outlineMemoLen = hotspots.length;
	return result;
}
