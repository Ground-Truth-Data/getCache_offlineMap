/** Pure functions over stored keys; roads are keyed by pin so two pins never serve each other's roads. */
import { isPinTileKey, isShallowTileKey, SHALLOW_Z } from "../../contract/grid";
import { blobHasZoom } from "../../contract/roadBlob";

export interface PinTile {
	key: string;
	lng: number;
	lat: number;
	address: string;
}

export function parsePinTileKey(key: string): PinTile | null {
	if (!isPinTileKey(key)) return null;
	// pin / "<lng>,<lat>" / z / x / y
	const parts = key.split("/");
	if (parts.length !== 5) return null;
	const [lngStr, latStr] = parts[1].split(",");
	const lng = Number(lngStr);
	const lat = Number(latStr);
	if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
	const address = `${parts[2]}/${parts[3]}/${parts[4]}`;
	return { key, lng, lat, address };
}

export function parseShallowTileKey(key: string): PinTile | null {
	if (!isShallowTileKey(key)) return null;
	const parts = key.split("/");
	if (parts.length !== 5) return null;
	const [lngStr, latStr] = parts[1].split(",");
	const lng = Number(lngStr);
	const lat = Number(latStr);
	if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
	const address = `${parts[2]}/${parts[3]}/${parts[4]}`;
	return { key, lng, lat, address };
}

export function tileCentre(
	z: number,
	x: number,
	y: number,
): { lng: number; lat: number } {
	const n = 2 ** z;
	const lng = ((x + 0.5) / n) * 360 - 180;
	const t = Math.PI - (2 * Math.PI * (y + 0.5)) / n;
	const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t)));
	return { lng, lat };
}

/** Squared-degree distance, ordering only. */
function d2(aLng: number, aLat: number, bLng: number, bLat: number): number {
	// Longitude degrees shrink with latitude.
	const k = Math.cos((aLat * Math.PI) / 180);
	const dx = (aLng - bLng) * k;
	const dy = aLat - bLat;
	return dx * dx + dy * dy;
}

function containsAddress(
	z: number,
	x: number,
	y: number,
	address: string,
): boolean {
	const [szRaw, sxRaw, syRaw] = address.split("/");
	const sz = Number(szRaw);
	let sx = Number(sxRaw);
	let sy = Number(syRaw);
	if (!Number.isFinite(sz) || !Number.isFinite(sx) || !Number.isFinite(sy)) {
		return false;
	}
	// A deeper request is answered by the tile that contains it: MapLibre
	// overzooms tiles it has, not addresses it never got.
	if (sz < z) {
		let ax = x;
		let ay = y;
		for (let level = z; level > sz; level--) {
			ax = Math.floor(ax / 2);
			ay = Math.floor(ay / 2);
		}
		return sx === ax && sy === ay;
	}
	for (let level = sz; level > z; level--) {
		sx = Math.floor(sx / 2);
		sy = Math.floor(sy / 2);
	}
	return sx === x && sy === y;
}

/** Every owner of an address, nearest first: two pins sharing a tile is normal, and both draw. */
export function keysForAddress(
	stored: Iterable<string>,
	z: number,
	x: number,
	y: number,
): string[] {
	const centre = tileCentre(z, x, y);
	const hits: Array<{ key: string; d: number }> = [];
	for (const key of stored) {
		const pt = parsePinTileKey(key);
		if (!pt) continue;
		// A stored zoom outside the pyramid is foreign data and answers nothing.
		if (!blobHasZoom(Number(pt.address.split("/")[0]))) continue;
		if (!containsAddress(z, x, y, pt.address)) continue;
		hits.push({ key, d: d2(centre.lng, centre.lat, pt.lng, pt.lat) });
	}
	hits.sort((a, b) => a.d - b.d);
	return hits.map((h) => h.key);
}

/** The single nearest owner. Never for rendering: one owner of a shared address is half a map. */
export function keyForAddress(
	stored: Iterable<string>,
	z: number,
	x: number,
	y: number,
): string | null {
	return keysForAddress(stored, z, x, y)[0] ?? null;
}

/** keysForAddress over `shallow/…` keys; membership is z === SHALLOW_Z, not blobHasZoom. */
export function shallowKeysForAddress(
	stored: Iterable<string>,
	z: number,
	x: number,
	y: number,
): string[] {
	const centre = tileCentre(z, x, y);
	const hits: Array<{ key: string; d: number }> = [];
	for (const key of stored) {
		const pt = parseShallowTileKey(key);
		if (!pt) continue;
		if (Number(pt.address.split("/")[0]) !== SHALLOW_Z) continue;
		if (!containsAddress(z, x, y, pt.address)) continue;
		hits.push({ key, d: d2(centre.lng, centre.lat, pt.lng, pt.lat) });
	}
	hits.sort((a, b) => a.d - b.d);
	return hits.map((h) => h.key);
}
