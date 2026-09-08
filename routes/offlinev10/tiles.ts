/**
 * Slippy-tile math for a blob cut on the tile grid. Pure, no DOM.
 *
 * A blob is every ANCHOR_Z tile the pin's 30 km box touches, the WHOLE
 * pyramid under each of them down to MAX_Z, and the parents above them up to
 * MIN_Z. From ANCHOR_Z down every zoom covers the same ground, so the
 * footprint drawn on the map is the footprint on disk. V10 cuts on z10
 * (~26 km tiles at lat 49): 9–16 of them per blob, ~80–105 km across, a few
 * MB. A parent tile is wider than the blob (z0 is the world), so it is
 * stored raw and clipped to the border when read — see protocol.ts.
 */

export const RADIUS_KM = 30;
/** Shallowest zoom on disk: the top of the pyramid. z0..z9 is ~15 tiles, ~100 KB each, shared between blobs. */
export const MIN_Z = 0;
export const MAX_Z = 13;
/** The grid the blob is cut on; the border is these tiles' edge. */
export const ANCHOR_Z = 10;

export interface Tile {
	z: number;
	x: number;
	y: number;
}

export interface Box {
	w: number;
	s: number;
	e: number;
	n: number;
}

/** A blob: an inclusive rectangle of ANCHOR_Z tiles. */
export interface Range {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

const EARTH_KM = 40075.016686;
const MAX_LAT = 85.0511;

export function tileKey(t: Tile): string {
	return `${t.z}/${t.x}/${t.y}`;
}

export function parseKey(k: string): Tile {
	const [z, x, y] = k.split("/").map(Number);
	return { z, x, y };
}

export function lngToX(lng: number, z: number): number {
	return Math.floor(((lng + 180) / 360) * 2 ** z);
}

export function latToY(lat: number, z: number): number {
	const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
	return Math.floor(
		((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
	);
}

export function xToLng(x: number, z: number): number {
	return (x / 2 ** z) * 360 - 180;
}

export function yToLat(y: number, z: number): number {
	const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
	return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Web-mercator world fraction, 0..1 on both axes, y down. */
export function toMerc(lng: number, lat: number): [number, number] {
	const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
	return [
		(lng + 180) / 360,
		(1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2,
	];
}

export function tileBox(t: Tile): Box {
	return {
		w: xToLng(t.x, t.z),
		e: xToLng(t.x + 1, t.z),
		n: yToLat(t.y, t.z),
		s: yToLat(t.y + 1, t.z),
	};
}

/** The pin's box: RADIUS_KM in every direction, longitude stretched by 1/cos(lat). */
export function regionBox(lng: number, lat: number, radiusKm = RADIUS_KM): Box {
	const dLat = (radiusKm / EARTH_KM) * 360;
	const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
	const dLng = dLat / cos;
	return {
		w: lng - dLng,
		e: lng + dLng,
		s: Math.max(-MAX_LAT, lat - dLat),
		n: Math.min(MAX_LAT, lat + dLat),
	};
}

export function boxesIntersect(a: Box, b: Box): boolean {
	return a.w < b.e && a.e > b.w && a.s < b.n && a.n > b.s;
}

/** The ANCHOR_Z tiles the pin's box touches — the blob's address and its border. */
export function regionRange(lng: number, lat: number): Range {
	const box = regionBox(lng, lat);
	const max = 2 ** ANCHOR_Z - 1;
	const clamp = (v: number) => Math.max(0, Math.min(max, v));
	return {
		x0: clamp(lngToX(box.w, ANCHOR_Z)),
		x1: clamp(lngToX(box.e, ANCHOR_Z)),
		y0: clamp(latToY(box.n, ANCHOR_Z)),
		y1: clamp(latToY(box.s, ANCHOR_Z)),
	};
}

export function rangeKey(r: Range): string {
	return `${ANCHOR_Z}/${r.x0}-${r.x1}/${r.y0}-${r.y1}`;
}

/** The ground the blob covers — one rectangle, since a tile range is always contiguous. */
export function rangeBox(r: Range): Box {
	return {
		w: xToLng(r.x0, ANCHOR_Z),
		e: xToLng(r.x1 + 1, ANCHOR_Z),
		n: yToLat(r.y0, ANCHOR_Z),
		s: yToLat(r.y1 + 1, ANCHOR_Z),
	};
}

/** Is this tile part of the blob — under an anchor tile, or a parent whose ground reaches one? */
export function rangeContains(r: Range, t: Tile): boolean {
	if (t.z < MIN_Z || t.z > MAX_Z) return false;
	if (t.z >= ANCHOR_Z) {
		const d = 2 ** (t.z - ANCHOR_Z);
		const x = Math.floor(t.x / d);
		const y = Math.floor(t.y / d);
		return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
	}
	const s = 2 ** (ANCHOR_Z - t.z);
	return (
		t.x * s <= r.x1 &&
		(t.x + 1) * s > r.x0 &&
		t.y * s <= r.y1 &&
		(t.y + 1) * s > r.y0
	);
}

/** Every tile the blob needs, shallow levels first so the map paints coarse-to-fine as they land. */
export function rangeTiles(r: Range): Tile[] {
	const out: Tile[] = [];
	for (let z = MIN_Z; z < ANCHOR_Z; z++) {
		const s = 2 ** (ANCHOR_Z - z);
		for (let x = Math.floor(r.x0 / s); x <= Math.floor(r.x1 / s); x++)
			for (let y = Math.floor(r.y0 / s); y <= Math.floor(r.y1 / s); y++)
				out.push({ z, x, y });
	}
	for (let z = ANCHOR_Z; z <= MAX_Z; z++) {
		const s = 2 ** (z - ANCHOR_Z);
		for (let x = r.x0 * s; x < (r.x1 + 1) * s; x++)
			for (let y = r.y0 * s; y < (r.y1 + 1) * s; y++) out.push({ z, x, y });
	}
	return out;
}

export function regionTiles(lng: number, lat: number): Tile[] {
	return rangeTiles(regionRange(lng, lat));
}

/** The blob's tiles that are NOT among the keys on disk — empty when the blob is whole. */
export function missingKeys(r: Range, have: Set<string>): string[] {
	const out: string[] = [];
	for (const t of rangeTiles(r)) {
		const k = tileKey(t);
		if (!have.has(k)) out.push(k);
	}
	return out;
}

export function boxToPolygon(b: Box): GeoJSON.Polygon {
	return {
		type: "Polygon",
		coordinates: [
			[
				[b.w, b.s],
				[b.e, b.s],
				[b.e, b.n],
				[b.w, b.n],
				[b.w, b.s],
			],
		],
	};
}
