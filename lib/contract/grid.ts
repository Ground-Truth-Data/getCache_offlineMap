/** ONE pin → ONE request → ONE blob → every road within the radius. */

import { km } from "./geo";

export const GRID_RADIUS_KM = 30;

/** Zoom the blob is ADDRESSED at, not its size (contents are always radiusBox); MapLibre never scales a tile down, so never lower it — SHALLOW_Z is the fix. */
export const BLOB_TILE_Z = 8;

/** One generalized z6 tile per pin for camera z6–z7, own IDB store — never a BLOB_ZOOMS entry, or the main lookup would answer z8 mis-framed. */
export const SHALLOW_Z = 6;

export interface Cell {
	ix: number;
	iy: number;
	/** Not always BLOB_TILE_Z: derive keys and frames from this, never the constant. */
	z: number;
}

export interface CellBox {
	w: number;
	s: number;
	e: number;
	n: number;
}

function mercY(lat: number): number {
	const s = Math.sin((lat * Math.PI) / 180);
	return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function latOfMercY(y: number): number {
	const n = Math.PI * (1 - 2 * y);
	return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function cellOf(lng: number, lat: number): Cell {
	const n = 2 ** BLOB_TILE_Z;
	return {
		ix: Math.floor(((lng + 180) / 360) * n),
		iy: Math.floor(mercY(lat) * n),
		z: BLOB_TILE_Z,
	};
}

export function cellBox(c: Cell): CellBox {
	const n = 2 ** c.z;
	return {
		w: (c.ix / n) * 360 - 180,
		e: ((c.ix + 1) / n) * 360 - 180,
		n: latOfMercY(c.iy / n), // north = SMALLER mercator y
		s: latOfMercY((c.iy + 1) / n),
	};
}

export function cellKey(c: Cell): string {
	return `${c.z}_${c.ix}_${c.iy}`;
}

export function parseCellKey(key: string): Cell | null {
	const m = /^(\d+)_(-?\d+)_(-?\d+)$/.exec(key);
	if (!m) return null;
	return { z: Number(m[1]), ix: Number(m[2]), iy: Number(m[3]) };
}

/** The storage key AND the slippy address MapLibre requests, deliberately one string. */
export function cellTileKey(c: Cell): string {
	return `${c.z}/${c.ix}/${c.iy}`;
}

/** Pin coords + cell: two pins can share a grid square, and one pin's roads must never serve under the other's key. */
export function pinTileKey(lng: number, lat: number, c: Cell): string {
	return `pin/${lng.toFixed(5)},${lat.toFixed(5)}/${cellTileKey(c)}`;
}

export function isPinTileKey(key: string): boolean {
	return key.startsWith("pin/");
}

/** `shallow/` host routes it to the SHALLOW store so it can never answer a main-tier request. */
export function shallowTileKey(lng: number, lat: number, c: Cell): string {
	return `shallow/${lng.toFixed(5)},${lat.toFixed(5)}/${cellTileKey(c)}`;
}

export function isShallowTileKey(key: string): boolean {
	return key.startsWith("shallow/");
}

export function radiusBox(lng: number, lat: number): CellBox {
	const dLat = GRID_RADIUS_KM / 110.574;
	const dLng =
		GRID_RADIUS_KM / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
	return { w: lng - dLng, e: lng + dLng, s: lat - dLat, n: lat + dLat };
}

/** EVERY cell the radius touches (up to 4), the pin's own first; a single tile clips at its edge. */
export function cellsFor(lng: number, lat: number): Cell[] {
	const box = radiusBox(lng, lat);
	const n = 2 ** BLOB_TILE_Z;
	const X = (lo: number) =>
		Math.min(n - 1, Math.max(0, Math.floor(((lo + 180) / 360) * n)));
	const Y = (la: number) =>
		Math.min(n - 1, Math.max(0, Math.floor(mercY(la) * n)));

	const x0 = X(box.w);
	const x1 = X(box.e);
	const y0 = Y(box.n); // north = smaller y
	const y1 = Y(box.s);

	const home = cellOf(lng, lat);
	const out: Cell[] = [];
	const seen = new Set<string>();
	const push = (c: Cell) => {
		const k = cellKey(c);
		if (seen.has(k)) return;
		seen.add(k);
		out.push(c);
	};
	push(home);
	for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
		for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
			push({ ix: x, iy: y, z: BLOB_TILE_Z });
		}
	}
	return out;
}

export function shallowCellsFor(lng: number, lat: number): Cell[] {
	const box = radiusBox(lng, lat);
	const n = 2 ** SHALLOW_Z;
	const X = (lo: number) =>
		Math.min(n - 1, Math.max(0, Math.floor(((lo + 180) / 360) * n)));
	const Y = (la: number) =>
		Math.min(n - 1, Math.max(0, Math.floor(mercY(la) * n)));

	const x0 = X(box.w);
	const x1 = X(box.e);
	const y0 = Y(box.n); // north = smaller y
	const y1 = Y(box.s);

	const out: Cell[] = [];
	const seen = new Set<string>();
	const push = (c: Cell) => {
		const k = cellKey(c);
		if (seen.has(k)) return;
		seen.add(k);
		out.push(c);
	};
	push({ ix: X(lng), iy: Y(lat), z: SHALLOW_Z });
	for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
		for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
			push({ ix: x, iy: y, z: SHALLOW_Z });
		}
	}
	return out;
}

export function tileHoldsRadius(z: number, lat: number): boolean {
	const n = 2 ** z;
	const wDeg = 360 / n;
	const widthKm = km(0, lat, wDeg, lat);
	return widthKm >= GRID_RADIUS_KM * 2;
}
