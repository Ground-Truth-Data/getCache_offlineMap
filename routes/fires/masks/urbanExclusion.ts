/**
 * A detection inside or within URBAN_BUFFER_KM of a mapped urban area is EXCLUDED, not flagged:
 * the only place in this layer that hides data. City fires are not a tree planter's business.
 */

import { bboxInRegion, type RegionBox } from "../../../lib/shared/assetRegion";

export type Ring = readonly (readonly number[])[];

export interface UrbanPoly {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly ring: Ring;
}

/** Every extra km eats real bush. */
export const URBAN_BUFFER_KM = 5;

const KM_PER_DEG_LAT = 110.57;

/** Even-odd point-in-polygon. */
export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
	let inside = false;
	const n = ring.length;
	for (let i = 0; i < n; i++) {
		const [x1, y1] = ring[i];
		const [x2, y2] = ring[(i + 1) % n];
		if (
			y1 > lat !== y2 > lat &&
			lng < ((x2 - x1) * (lat - y1)) / (y2 - y1 || 1e-12) + x1
		) {
			inside = !inside;
		}
	}
	return inside;
}

/** To the nearest VERTEX, not edge. */
export function kmToRing(lng: number, lat: number, ring: Ring): number {
	const kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180);
	let best = Number.POSITIVE_INFINITY;
	for (const p of ring) {
		const dx = (p[0] - lng) * kmPerDegLng;
		const dy = (p[1] - lat) * KM_PER_DEG_LAT;
		const d = Math.hypot(dx, dy);
		if (d < best) best = d;
	}
	return best;
}

export function prepareUrban(
	features: readonly { geometry: { type: string; coordinates: unknown } }[],
	/** null keeps the whole world: a wrongly windowed asset silently stops excluding city hotspots */
	region: RegionBox | null = null,
): UrbanPoly[] {
	const out: UrbanPoly[] = [];
	for (const f of features) {
		if (f.geometry?.type !== "Polygon") continue;
		const ring = (f.geometry.coordinates as number[][][])[0];
		if (!Array.isArray(ring) || ring.length < 3) continue;
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const p of ring) {
			if (p[0] < minX) minX = p[0];
			if (p[0] > maxX) maxX = p[0];
			if (p[1] < minY) minY = p[1];
			if (p[1] > maxY) maxY = p[1];
		}
		if (region && !bboxInRegion(region, minX, minY, maxX, maxY)) continue;
		out.push({ minX, minY, maxX, maxY, ring });
	}
	return out;
}

/** False with no polygons: a missing asset must never hide fires. */
export function isUrban(
	lng: number,
	lat: number,
	polys: readonly UrbanPoly[],
	bufferKm: number = URBAN_BUFFER_KM,
): boolean {
	if (polys.length === 0) return false;
	const padY = bufferKm / KM_PER_DEG_LAT;
	const padX = padY / Math.max(0.15, Math.cos((lat * Math.PI) / 180));
	for (const p of polys) {
		if (
			lng < p.minX - padX ||
			lng > p.maxX + padX ||
			lat < p.minY - padY ||
			lat > p.maxY + padY
		) {
			continue;
		}
		if (pointInRing(lng, lat, p.ring)) return true;
		if (bufferKm > 0 && kmToRing(lng, lat, p.ring) <= bufferKm) return true;
	}
	return false;
}
