/**
 * A blob's name: the nearest town in its own tiles. Thirty rows of
 * coordinates are unreadable; "Oliver · 12 km" is not. The z10 anchor tiles
 * carry every locality the style would ever label inside the blob, down to
 * villages that only show at z11, so the name comes off the disk with no
 * request, offline, once, when the blob lands.
 */

import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { getTile } from "./store";
import { ANCHOR_Z, type Range, tileKey, xToLng, yToLat } from "./tiles";

export interface Place {
	name: string;
	/** great-circle km from the pin */
	km: number;
}

const EARTH_R_KM = 6371;

function haversineKm(
	aLng: number,
	aLat: number,
	bLng: number,
	bLat: number,
): number {
	const r = Math.PI / 180;
	const dLat = (bLat - aLat) * r;
	const dLng = (bLng - aLng) * r;
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_R_KM * Math.asin(Math.sqrt(h));
}

/**
 * A name someone in the bush can actually read back over the radio.
 *
 * The tiles carry `name` in the LOCAL script — a blob near Addis reports its
 * town in Ge'ez, which is unreadable here and unrenderable in a Latin-only
 * glyph set, so it lands as tofu boxes. Latin `name` wins untouched (French,
 * and Cree written in Latin, are exactly what we want); only a name with no
 * Latin letters at all hands over to `name:en`, then `name:latin`. When
 * nothing readable exists the local name still beats no name.
 */
const HAS_LATIN = /\p{Script=Latin}/u;

function readableName(props: Record<string, unknown>): string {
	const str = (k: string): string =>
		typeof props[k] === "string" ? (props[k] as string) : "";
	const local = str("name");
	if (local && HAS_LATIN.test(local)) return local;
	return str("name:en") || str("name:latin") || local;
}

/** Every locality in one tile, as lng/lat points. */
export function localitiesIn(
	data: Uint8Array,
	z: number,
	x: number,
	y: number,
): Array<{ name: string; lng: number; lat: number }> {
	const layer = new VectorTile(
		new Pbf(data) as unknown as ConstructorParameters<typeof VectorTile>[0],
	).layers.places;
	if (!layer) return [];
	const out: Array<{ name: string; lng: number; lat: number }> = [];
	for (let i = 0; i < layer.length; i++) {
		const f = layer.feature(i);
		if (f.type !== 1 || f.properties.kind !== "locality") continue;
		const name = readableName(f.properties);
		if (!name) continue;
		const p = f.loadGeometry()[0]?.[0];
		if (!p) continue;
		out.push({
			name,
			lng: xToLng(x + p.x / layer.extent, z),
			lat: yToLat(y + p.y / layer.extent, z),
		});
	}
	return out;
}

/** The nearest town to the pin among the blob's anchor tiles on disk; null when they hold none. */
export async function nearestPlace(
	range: Range,
	lng: number,
	lat: number,
): Promise<Place | null> {
	let best: Place | null = null;
	for (let x = range.x0; x <= range.x1; x++)
		for (let y = range.y0; y <= range.y1; y++) {
			const buf = await getTile(tileKey({ z: ANCHOR_Z, x, y }));
			if (!buf || buf.byteLength === 0) continue;
			for (const p of localitiesIn(new Uint8Array(buf), ANCHOR_Z, x, y)) {
				const km = haversineKm(lng, lat, p.lng, p.lat);
				if (!best || km < best.km) best = { name: p.name, km };
			}
		}
	return best;
}

/** The row label: the town, and how far when it is not right here. */
export function placeLabel(p: Place): string {
	return p.km < 1.5 ? p.name : `${p.name} · ${Math.round(p.km)} km`;
}
