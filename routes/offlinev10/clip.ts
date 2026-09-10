/**
 * Clip a raw MVT tile to rectangles, so nothing outside the gold border
 * reaches the map: a parent tile above the cut is wider than the blob. Walks
 * the protobuf and rewrites each feature's geometry; everything else — ids,
 * tags, the keys/values tables — is copied byte for byte. Never GeoJSON.
 */

/** A rectangle as fractions of the tile (0..1 across, y down). */
export interface Rect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

type Pt = [number, number];

function readVarint(buf: Uint8Array, pos: number): [number, number] {
	let result = 0;
	let shift = 0;
	let p = pos;
	for (;;) {
		const b = buf[p++];
		result += (b & 0x7f) * 2 ** shift;
		if ((b & 0x80) === 0) break;
		shift += 7;
	}
	return [result, p];
}

function writeVarint(out: number[], value: number): void {
	let v = value;
	while (v > 0x7f) {
		out.push((v & 0x7f) | 0x80);
		v = Math.floor(v / 128);
	}
	out.push(v);
}

function skipField(buf: Uint8Array, wire: number, pos: number): number {
	let p = pos;
	if (wire === 0) [, p] = readVarint(buf, p);
	else if (wire === 2) {
		let len: number;
		[len, p] = readVarint(buf, p);
		p += len;
	} else if (wire === 5) p += 4;
	else if (wire === 1) p += 8;
	return p;
}

const zz = (v: number): number => (v >> 1) ^ -(v & 1);
const unzz = (v: number): number => (v << 1) ^ (v >> 31);

function writeBytesField(
	out: number[],
	field: number,
	bytes: ArrayLike<number>,
): void {
	writeVarint(out, (field << 3) | 2);
	writeVarint(out, bytes.length);
	for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
}

/** Every MoveTo/LineTo run in a geometry, as absolute tile-unit points; ClosePath ends a ring. */
function decodeGeometry(geom: Uint8Array): Pt[][] {
	const parts: Pt[][] = [];
	let cur: Pt[] = [];
	let x = 0;
	let y = 0;
	let p = 0;
	while (p < geom.length) {
		let cmd: number;
		[cmd, p] = readVarint(geom, p);
		const id = cmd & 0x7;
		const count = cmd >> 3;
		if (id === 7) continue;
		for (let i = 0; i < count && p < geom.length; i++) {
			let dx: number;
			let dy: number;
			[dx, p] = readVarint(geom, p);
			[dy, p] = readVarint(geom, p);
			x += zz(dx);
			y += zz(dy);
			if (id === 1) {
				if (cur.length) parts.push(cur);
				cur = [[x, y]];
			} else cur.push([x, y]);
		}
	}
	if (cur.length) parts.push(cur);
	return parts;
}

/** Round to tile units and drop repeated vertices; a ring also drops a closing repeat of its first. */
function tidy(pts: Pt[], ring: boolean): Pt[] {
	const out: Pt[] = [];
	for (const [x, y] of pts) {
		const px = Math.round(x);
		const py = Math.round(y);
		const last = out[out.length - 1];
		if (last && last[0] === px && last[1] === py) continue;
		out.push([px, py]);
	}
	if (ring && out.length > 1) {
		const a = out[0];
		const b = out[out.length - 1];
		if (a[0] === b[0] && a[1] === b[1]) out.pop();
	}
	return out;
}

function ringArea2(r: Pt[]): number {
	let a = 0;
	for (let i = 0, j = r.length - 1; i < r.length; j = i++)
		a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
	return a;
}

/** Sutherland–Hodgman against one rectangle; orientation is preserved. */
function clipRing(ring: Pt[], r: Rect): Pt[] {
	type Edge = (p: Pt) => boolean;
	const edges: Array<[Edge, (a: Pt, b: Pt) => Pt]> = [
		[(p) => p[0] >= r.x0, (a, b) => cross(a, b, 0, r.x0)],
		[(p) => p[0] <= r.x1, (a, b) => cross(a, b, 0, r.x1)],
		[(p) => p[1] >= r.y0, (a, b) => cross(a, b, 1, r.y0)],
		[(p) => p[1] <= r.y1, (a, b) => cross(a, b, 1, r.y1)],
	];
	let out = ring;
	for (const [inside, at] of edges) {
		if (!out.length) break;
		const input = out;
		out = [];
		let prev = input[input.length - 1];
		for (const cur of input) {
			if (inside(cur)) {
				if (!inside(prev)) out.push(at(prev, cur));
				out.push(cur);
			} else if (inside(prev)) out.push(at(prev, cur));
			prev = cur;
		}
	}
	return out;
}

/** Where segment a→b crosses axis-aligned line coord[axis] = v. */
function cross(a: Pt, b: Pt, axis: 0 | 1, v: number): Pt {
	const t = (v - a[axis]) / (b[axis] - a[axis]);
	const o = axis === 0 ? 1 : 0;
	const w = a[o] + (b[o] - a[o]) * t;
	return axis === 0 ? [v, w] : [w, v];
}

/** Liang–Barsky: the part of a→b inside r, or null. */
function clipSegment(a: Pt, b: Pt, r: Rect): [Pt, Pt] | null {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	let t0 = 0;
	let t1 = 1;
	const checks: Array<[number, number]> = [
		[-dx, a[0] - r.x0],
		[dx, r.x1 - a[0]],
		[-dy, a[1] - r.y0],
		[dy, r.y1 - a[1]],
	];
	for (const [p, q] of checks) {
		if (p === 0) {
			if (q < 0) return null;
			continue;
		}
		const t = q / p;
		if (p < 0) {
			if (t > t1) return null;
			if (t > t0) t0 = t;
		} else {
			if (t < t0) return null;
			if (t < t1) t1 = t;
		}
	}
	return [
		[a[0] + dx * t0, a[1] + dy * t0],
		[a[0] + dx * t1, a[1] + dy * t1],
	];
}

function clipLine(line: Pt[], r: Rect): Pt[][] {
	const runs: Pt[][] = [];
	let run: Pt[] = [];
	for (let i = 1; i < line.length; i++) {
		const seg = clipSegment(line[i - 1], line[i], r);
		if (!seg) {
			if (run.length) runs.push(run);
			run = [];
			continue;
		}
		const [a, b] = seg;
		const last = run[run.length - 1];
		if (!last || last[0] !== a[0] || last[1] !== a[1]) {
			if (run.length) runs.push(run);
			run = [a];
		}
		run.push(b);
	}
	if (run.length) runs.push(run);
	return runs;
}

function encodeParts(parts: Pt[][], type: number): number[] {
	const out: number[] = [];
	let px = 0;
	let py = 0;
	const emit = (pt: Pt) => {
		out.push(unzz(pt[0] - px), unzz(pt[1] - py));
		px = pt[0];
		py = pt[1];
	};
	if (type === 1) {
		out.push((parts.length << 3) | 1);
		for (const [pt] of parts) emit(pt);
		return out;
	}
	for (const part of parts) {
		out.push((1 << 3) | 1);
		emit(part[0]);
		out.push(((part.length - 1) << 3) | 2);
		for (let i = 1; i < part.length; i++) emit(part[i]);
		if (type === 3) out.push((1 << 3) | 7);
	}
	return out;
}

/** The feature's geometry clipped to the rectangles (tile units), or null when nothing is left. */
function clipGeometry(
	geom: Uint8Array,
	type: number,
	rects: Rect[],
): number[] | null {
	const parts = decodeGeometry(geom);
	const kept: Pt[][] = [];
	if (type === 1) {
		for (const part of parts)
			for (const pt of part)
				if (
					rects.some(
						(r) =>
							pt[0] >= r.x0 && pt[0] <= r.x1 && pt[1] >= r.y0 && pt[1] <= r.y1,
					)
				)
					kept.push([pt]);
	} else if (type === 2) {
		for (const r of rects)
			for (const line of parts)
				for (const run of clipLine(line, r)) {
					const t = tidy(run, false);
					if (t.length > 1) kept.push(t);
				}
	} else if (type === 3) {
		for (const r of rects)
			for (const ring of parts) {
				const t = tidy(clipRing(ring, r), true);
				if (t.length > 2 && Math.abs(ringArea2(t)) >= 1) kept.push(t);
			}
	} else return null;
	return kept.length ? encodeParts(kept, type) : null;
}

function clipFeature(feature: Uint8Array, rects: Rect[]): number[] | null {
	const raw: number[] = [];
	let type = 0;
	let geom: Uint8Array | null = null;
	let p = 0;
	while (p < feature.length) {
		const start = p;
		let tag: number;
		[tag, p] = readVarint(feature, p);
		const field = tag >>> 3;
		const wire = tag & 7;
		if (field === 3 && wire === 0) {
			[type, p] = readVarint(feature, p);
			continue;
		}
		if (field === 4 && wire === 2) {
			let len: number;
			[len, p] = readVarint(feature, p);
			geom = feature.subarray(p, p + len);
			p += len;
			continue;
		}
		p = skipField(feature, wire, p);
		for (let i = start; i < p; i++) raw.push(feature[i]);
	}
	if (!geom) return null;
	const clipped = clipGeometry(geom, type, rects);
	if (!clipped) return null;
	const out = raw;
	writeVarint(out, (3 << 3) | 0);
	writeVarint(out, type);
	const packed: number[] = [];
	for (const v of clipped) writeVarint(packed, v);
	writeBytesField(out, 4, packed);
	return out;
}

function layerExtent(layer: Uint8Array): number {
	let p = 0;
	while (p < layer.length) {
		let tag: number;
		[tag, p] = readVarint(layer, p);
		if (tag >>> 3 === 5 && (tag & 7) === 0) return readVarint(layer, p)[0];
		p = skipField(layer, tag & 7, p);
	}
	return 4096;
}

/** The layer with its features clipped, or null when none survive. */
function clipLayer(layer: Uint8Array, rects: Rect[]): number[] | null {
	const extent = layerExtent(layer);
	const scaled = rects.map((r) => ({
		x0: r.x0 * extent,
		y0: r.y0 * extent,
		x1: r.x1 * extent,
		y1: r.y1 * extent,
	}));
	const out: number[] = [];
	let features = 0;
	let p = 0;
	while (p < layer.length) {
		const start = p;
		let tag: number;
		[tag, p] = readVarint(layer, p);
		const field = tag >>> 3;
		const wire = tag & 7;
		if (field === 2 && wire === 2) {
			let len: number;
			[len, p] = readVarint(layer, p);
			const f = clipFeature(layer.subarray(p, p + len), scaled);
			p += len;
			if (f) {
				writeBytesField(out, 2, f);
				features++;
			}
			continue;
		}
		p = skipField(layer, wire, p);
		for (let i = start; i < p; i++) out.push(layer[i]);
	}
	return features ? out : null;
}

/**
 * The same rectangles, cut so none overlaps another — the union unchanged.
 *
 * ⛔ Overlap is not cosmetic here: clipping runs ONCE PER RECT and keeps every
 * result, so ground two blobs share is emitted twice. A semi-transparent fill
 * (park, lake) then composites against itself and the shared strip reads as a
 * darker rectangle with hard edges — three blobs, three coats.
 *
 * Sweep both axes: every rect edge becomes a grid line, and each grid cell is
 * emitted once if any rect covers it. Rect counts here are single digits (one
 * per blob covering this tile), so the O(n²) grid is free.
 */
export function disjoint(rects: Rect[]): Rect[] {
	if (rects.length < 2) return rects;
	const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
	const ys = [...new Set(rects.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);
	const out: Rect[] = [];
	for (let i = 0; i < xs.length - 1; i++) {
		for (let j = 0; j < ys.length - 1; j++) {
			const x0 = xs[i];
			const x1 = xs[i + 1];
			const y0 = ys[j];
			const y1 = ys[j + 1];
			// Midpoint decides membership — a cell is wholly inside a rect or
			// wholly outside it, because every rect edge is a grid line.
			const mx = (x0 + x1) / 2;
			const my = (y0 + y1) / 2;
			if (rects.some((r) => mx > r.x0 && mx < r.x1 && my > r.y0 && my < r.y1))
				out.push({ x0, y0, x1, y1 });
		}
	}
	return out;
}

/** The tile with every layer clipped to the rectangles; layers left empty are dropped. */
export function clipTile(data: Uint8Array, rects: Rect[]): Uint8Array {
	const cuts = disjoint(rects);
	const out: number[] = [];
	let p = 0;
	while (p < data.length) {
		const start = p;
		let tag: number;
		[tag, p] = readVarint(data, p);
		if (tag >>> 3 === 3 && (tag & 7) === 2) {
			let len: number;
			[len, p] = readVarint(data, p);
			const layer = clipLayer(data.subarray(p, p + len), cuts);
			p += len;
			if (layer) writeBytesField(out, 3, layer);
			continue;
		}
		p = skipField(data, tag & 7, p);
		for (let i = start; i < p; i++) out.push(data[i]);
	}
	return Uint8Array.from(out);
}
