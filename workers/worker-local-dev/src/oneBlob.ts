import { readVarint, skipField, unzigzag, writeVarint } from "./mvtBytes";
import { BLOB_TILE_Z } from "./grid";
import type { TileId } from "./geo";

/** Not 4096: over a 60 km span that is ~15 m per unit and roads stair-step; 16384 gives ~3.7 m. */
export const BLOB_EXTENT = 16384;

export { BLOB_TILE_Z };

function zz(v: number): number {
	return (v >>> 1) ^ -(v & 1);
}

function mercX(lng: number): number {
	return (lng + 180) / 360;
}

function mercY(lat: number): number {
	const s = Math.sin((lat * Math.PI) / 180);
	return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** Normalised mercator bounds of the blob tile. */
export interface BlobFrame {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** The frame must be the tile's OWN box, never the cell's: a cell spans several
 *  addresses, and framing them all to the cell draws its roads once per address, offset. */
export function boxFrame(box: {
	w: number;
	s: number;
	e: number;
	n: number;
}): BlobFrame {
	const mX = (lng: number) => (lng + 180) / 360;
	const mY = (lat: number) => {
		const t = Math.sin((lat * Math.PI) / 180);
		return 0.5 - Math.log((1 + t) / (1 - t)) / (4 * Math.PI);
	};
	return { x0: mX(box.w), y0: mY(box.n), x1: mX(box.e), y1: mY(box.s) };
}

export function tileFrame(tile: TileId): BlobFrame {
	const n = 2 ** tile.z;
	return {
		x0: tile.x / n,
		y0: tile.y / n,
		x1: (tile.x + 1) / n,
		y1: (tile.y + 1) / n,
	};
}

export interface SourceTile {
	tile: TileId;
	data: Uint8Array;
}

// `keys`/`values` are parsed, not copied: a feature's tags index its OWN tile's
// tables, so merging on the first tile's tables renders a highway as a foot trail.
interface LayerParts {
	name: string;
	/** Layer fields other than name/keys/values/features/extent (e.g. version). */
	header: number[];
	features: Uint8Array[];
	keys: string[];
	/** Raw encoded Value messages; any scalar type. */
	values: Uint8Array[];
	extent: number;
}

function splitLayer(layer: Uint8Array): LayerParts {
	const header: number[] = [];
	const features: Uint8Array[] = [];
	const keys: string[] = [];
	const values: Uint8Array[] = [];
	let name = "";
	let extent = 4096;
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
			features.push(layer.subarray(p, p + len));
			p += len;
			continue;
		}
		if (field === 1 && wire === 2) {
			let len: number;
			[len, p] = readVarint(layer, p);
			name = new TextDecoder().decode(layer.subarray(p, p + len));
			p += len;
			continue;
		}
		if (field === 3 && wire === 2) {
			let len: number;
			[len, p] = readVarint(layer, p);
			keys.push(new TextDecoder().decode(layer.subarray(p, p + len)));
			p += len;
			continue;
		}
		if (field === 4 && wire === 2) {
			let len: number;
			[len, p] = readVarint(layer, p);
			values.push(layer.subarray(p, p + len));
			p += len;
			continue;
		}
		if (field === 5 && wire === 0) {
			const [v, after] = readVarint(layer, p);
			extent = v;
			p = after;
			continue;
		}
		const next = skipField(layer, wire, p);
		for (let i = start; i < next; i++) header.push(layer[i]);
		p = next;
	}
	return { name, header, features, keys, values, extent };
}

function valueId(v: Uint8Array): string {
	let s = "";
	for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i]);
	return s;
}

/** Rewrite one feature's `tags` from the source layer's tables into the merged layer's. */
function remapTags(
	feature: Uint8Array,
	keyMap: number[],
	valMap: number[],
): Uint8Array {
	const out: number[] = [];
	let p = 0;
	while (p < feature.length) {
		const start = p;
		let tag: number;
		[tag, p] = readVarint(feature, p);
		const field = tag >>> 3;
		const wire = tag & 7;
		if (field === 2 && wire === 2) {
			let len: number;
			[len, p] = readVarint(feature, p);
			const end = p + len;
			const pairs: number[] = [];
			while (p < end) {
				let k: number;
				let v: number;
				[k, p] = readVarint(feature, p);
				[v, p] = readVarint(feature, p);
				pairs.push(keyMap[k] ?? k, valMap[v] ?? v);
			}
			const body: number[] = [];
			for (const n of pairs) writeVarint(body, n);
			writeVarint(out, tag);
			writeVarint(out, body.length);
			for (const b of body) out.push(b);
			continue;
		}
		const next = skipField(feature, wire, p);
		for (let i = start; i < next; i++) out.push(feature[i]);
		p = next;
	}
	return new Uint8Array(out);
}

function splitTile(data: Uint8Array): Uint8Array[] {
	const layers: Uint8Array[] = [];
	let p = 0;
	while (p < data.length) {
		let tag: number;
		[tag, p] = readVarint(data, p);
		const field = tag >>> 3;
		const wire = tag & 7;
		if (field === 3 && wire === 2) {
			let len: number;
			[len, p] = readVarint(data, p);
			layers.push(data.subarray(p, p + len));
			p += len;
		} else {
			p = skipField(data, wire, p);
		}
	}
	return layers;
}

/** Re-home one feature's geometry into the blob's grid and trim it to the cell in
 *  one pass over the packed varints; null when nothing lands inside. */
function remapAndClip(
	geom: Uint8Array,
	src: { x0: number; y0: number; sx: number; sy: number; extent: number },
	frame: BlobFrame,
	/** Sink for the same runs in blob-grid units, so the zoom-out picture needs no second walk. */
	collect?: Array<Array<[number, number]>>,
	type: GeomType = 2,
): number[] | null {
	const lines: Array<Array<[number, number]>> = [];
	let cur: Array<[number, number]> = [];
	let x = 0;
	let y = 0;
	let p = 0;
	// A point is one MoveTo with no LineTo; the line walker below would drop it
	// as a one-vertex run. Kept iff it lies inside the cell.
	if (type === 1) {
		const pts: Array<[number, number]> = [];
		while (p < geom.length) {
			let cmd: number;
			[cmd, p] = readVarint(geom, p);
			const id = cmd & 0x7;
			const count = cmd >> 3;
			if (id !== 1) break;
			for (let i = 0; i < count && p < geom.length; i++) {
				let dx: number;
				let dy: number;
				[dx, p] = readVarint(geom, p);
				[dy, p] = readVarint(geom, p);
				x += zz(dx);
				y += zz(dy);
				const wx = src.x0 + (x / src.extent) * src.sx;
				const wy = src.y0 + (y / src.extent) * src.sy;
				const bx = Math.round(((wx - frame.x0) / (frame.x1 - frame.x0)) * BLOB_EXTENT);
				const by = Math.round(((wy - frame.y0) / (frame.y1 - frame.y0)) * BLOB_EXTENT);
				if (bx >= 0 && bx <= BLOB_EXTENT && by >= 0 && by <= BLOB_EXTENT) pts.push([bx, by]);
			}
		}
		if (!pts.length) return null;
		const out: number[] = [(pts.length << 3) | 1];
		let px = 0;
		let py = 0;
		for (const pt of pts) {
			out.push(unzigzag(pt[0] - px), unzigzag(pt[1] - py));
			px = pt[0];
			py = pt[1];
		}
		return out;
	}
	while (p < geom.length) {
		let cmd: number;
		[cmd, p] = readVarint(geom, p);
		const id = cmd & 0x7;
		const count = cmd >> 3;
		if (id === 7) continue; // ClosePath: rings are re-closed on output
		for (let i = 0; i < count && p < geom.length; i++) {
			let dx: number;
			let dy: number;
			[dx, p] = readVarint(geom, p);
			[dy, p] = readVarint(geom, p);
			x += zz(dx);
			y += zz(dy);
			const wx = src.x0 + (x / src.extent) * src.sx;
			const wy = src.y0 + (y / src.extent) * src.sy;
			const bx = Math.round(((wx - frame.x0) / (frame.x1 - frame.x0)) * BLOB_EXTENT);
			const by = Math.round(((wy - frame.y0) / (frame.y1 - frame.y0)) * BLOB_EXTENT);
			if (id === 1) {
				if (cur.length > 1) lines.push(cur);
				cur = [[bx, by]];
			} else {
				cur.push([bx, by]);
			}
		}
	}
	if (cur.length > 1) lines.push(cur);
	if (!lines.length) return null;

	// Polygons are never trimmed: splitting a ring at the cell edge leaves open
	// arcs that a fill layer closes on themselves. A ring is kept whole iff any
	// vertex lies in the cell.
	if (type === 3) {
		const inCellPt = (pt: [number, number]): boolean =>
			pt[0] >= 0 && pt[0] <= BLOB_EXTENT && pt[1] >= 0 && pt[1] <= BLOB_EXTENT;
		const rings = lines.filter((r) => r.some(inCellPt));
		if (!rings.length) return null;
		const out: number[] = [];
		let px = 0;
		let py = 0;
		for (const ring of rings) {
			out.push((1 << 3) | 1);
			out.push(unzigzag(ring[0][0] - px), unzigzag(ring[0][1] - py));
			px = ring[0][0];
			py = ring[0][1];
			out.push(((ring.length - 1) << 3) | 2);
			for (let i = 1; i < ring.length; i++) {
				out.push(unzigzag(ring[i][0] - px), unzigzag(ring[i][1] - py));
				px = ring[i][0];
				py = ring[i][1];
			}
			out.push((1 << 3) | 7);
		}
		return out;
	}

	// Trim lines to the cell box: source tiles straddle the edge, and the box is
	// snapped to the world so the neighbour cuts the same road at the same line.
	// One vertex of slack outside so a road visibly reaches the edge.
	const runs: Array<Array<[number, number]>> = [];
	const inCell = (pt: [number, number]): boolean =>
		pt[0] >= 0 && pt[0] <= BLOB_EXTENT && pt[1] >= 0 && pt[1] <= BLOB_EXTENT;
	for (const line of lines) {
		let run: Array<[number, number]> = [];
		for (let i = 0; i < line.length; i++) {
			if (inCell(line[i])) {
				if (!run.length && i > 0) run.push(line[i - 1]);
				run.push(line[i]);
			} else if (run.length) {
				run.push(line[i]);
				runs.push(run);
				run = [];
			}
		}
		if (run.length > 1) runs.push(run);
	}
	if (!runs.length) return null;
	if (collect) for (const r of runs) collect.push(r);

	const out: number[] = [];
	let px = 0;
	let py = 0;
	for (const run of runs) {
		out.push((1 << 3) | 1);
		out.push(unzigzag(run[0][0] - px), unzigzag(run[0][1] - py));
		px = run[0][0];
		py = run[0][1];
		if (run.length > 1) {
			out.push(((run.length - 1) << 3) | 2);
			for (let i = 1; i < run.length; i++) {
				out.push(unzigzag(run[i][0] - px), unzigzag(run[i][1] - py));
				px = run[i][0];
				py = run[i][1];
			}
		}
	}
	return out;
}

/** MVT Feature.type: 1 POINT, 2 LINESTRING, 3 POLYGON. */
type GeomType = 1 | 2 | 3;
function featureGeomType(feature: Uint8Array): GeomType {
	let p = 0;
	while (p < feature.length) {
		let tag: number;
		[tag, p] = readVarint(feature, p);
		const field = tag >>> 3;
		const wire = tag & 7;
		if (field === 3 && wire === 0) {
			let t: number;
			[t, p] = readVarint(feature, p);
			return t === 1 || t === 3 ? t : 2;
		}
		p = skipField(feature, wire, p);
	}
	return 2;
}

function remapFeature(
	feature: Uint8Array,
	src: { x0: number; y0: number; sx: number; sy: number; extent: number },
	frame: BlobFrame,
): Uint8Array | null {
	const out: number[] = [];
	let p = 0;
	let wrote = false;
	const type = featureGeomType(feature);
	while (p < feature.length) {
		const start = p;
		let tag: number;
		[tag, p] = readVarint(feature, p);
		const field = tag >>> 3;
		const wire = tag & 7;
		if (field === 4 && wire === 2) {
			let len: number;
			[len, p] = readVarint(feature, p);
			const vals = remapAndClip(feature.subarray(p, p + len), src, frame, undefined, type);
			if (!vals) return null;
			const body: number[] = [];
			for (const v of vals) writeVarint(body, v);
			writeVarint(out, tag);
			writeVarint(out, body.length);
			for (const b of body) out.push(b);
			wrote = true;
			p += len;
		} else {
			const next = skipField(feature, wire, p);
			for (let i = start; i < next; i++) out.push(feature[i]);
			p = next;
		}
	}
	return wrote ? new Uint8Array(out) : null;
}

/** Build one blob: every source tile's features re-homed into one tile framed to `frame`. */
export function buildBlobTile(
	sources: SourceTile[],
	frame: BlobFrame,
): { bytes: Uint8Array; features: number; dropped: number } {
	const byName = new Map<string, LayerParts>();
	let features = 0;
	let dropped = 0;

	for (const s of sources) {
		if (!s.data || s.data.byteLength === 0) continue;
		const n = 2 ** s.tile.z;
		const src0x = s.tile.x / n;
		const src0y = s.tile.y / n;
		const span = 1 / n;

		for (const raw of splitTile(s.data)) {
			const parts = splitLayer(raw);
			let dst = byName.get(parts.name);
			if (!dst) {
				dst = {
					name: parts.name,
					header: parts.header,
					features: [],
					keys: [],
					values: [],
					extent: BLOB_EXTENT,
				};
				byName.set(parts.name, dst);
			}

			const keyMap: number[] = parts.keys.map((k) => {
				let i = dst.keys.indexOf(k);
				if (i === -1) {
					i = dst.keys.length;
					dst.keys.push(k);
				}
				return i;
			});
			const valMap: number[] = parts.values.map((v) => {
				const id = valueId(v);
				let i = dst.values.findIndex((e) => valueId(e) === id);
				if (i === -1) {
					i = dst.values.length;
					dst.values.push(v);
				}
				return i;
			});
			const srcBox = {
				x0: src0x,
				y0: src0y,
				sx: span,
				sy: span,
				extent: parts.extent,
			};
			for (const f of parts.features) {
				const re = remapFeature(remapTags(f, keyMap, valMap), srcBox, frame);
				if (re) {
					dst.features.push(re);
					features++;
				} else {
					dropped++;
				}
			}
		}
	}

	const out: number[] = [];
	for (const layer of byName.values()) {
		if (!layer.features.length) continue;
		const body: number[] = [];
		const nameBytes = new TextEncoder().encode(layer.name);
		writeVarint(body, (1 << 3) | 2);
		writeVarint(body, nameBytes.length);
		for (const b of nameBytes) body.push(b);
		for (const k of layer.keys) {
			const kb = new TextEncoder().encode(k);
			writeVarint(body, (3 << 3) | 2);
			writeVarint(body, kb.length);
			for (const b of kb) body.push(b);
		}
		for (const v of layer.values) {
			writeVarint(body, (4 << 3) | 2);
			writeVarint(body, v.length);
			for (let i = 0; i < v.length; i++) body.push(v[i]);
		}
		for (const b of layer.header) body.push(b);
		writeVarint(body, (5 << 3) | 0);
		writeVarint(body, BLOB_EXTENT);
		for (const f of layer.features) {
			writeVarint(body, (2 << 3) | 2);
			writeVarint(body, f.length);
			for (let i = 0; i < f.length; i++) body.push(f[i]);
		}
		writeVarint(out, (3 << 3) | 2);
		writeVarint(out, body.length);
		for (const b of body) out.push(b);
	}
	return { bytes: new Uint8Array(out), features, dropped };
}
