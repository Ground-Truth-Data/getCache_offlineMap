/** Roads as a picture: pure functions, no I/O, no map object. A grid address cannot centre on a point; only bounds reach zero error. */
import type { Box } from "./pinBox";

/** Keep in sync with packBuilder. */
export const PNG_KEY_PREFIX = "png/";

export function isRoadPictureKey(key: string): boolean {
	return key.startsWith(PNG_KEY_PREFIX);
}

/** The key is a GPS point, not a grid address: a `z/x/y` key throws away the pin. */
export function pinOfRoadPictureKey(
	key: string,
): { lng: number; lat: number } | null {
	if (!isRoadPictureKey(key)) return null;
	const [lng, lat] = key.slice(PNG_KEY_PREFIX.length).split(",").map(Number);
	if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
	return { lng, lat };
}

/** Must match the Worker's spelling exactly: 5 decimals, no spaces. */
export function roadPictureKey(lng: number, lat: number): string {
	return `${PNG_KEY_PREFIX}${lng.toFixed(5)},${lat.toFixed(5)}`;
}

/** [NW, NE, SE, SW]; a wrong order mirrors or rotates the image rather than erroring. */
export function imageCoordinates(
	box: Box,
): [[number, number], [number, number], [number, number], [number, number]] {
	return [
		[box.w, box.n],
		[box.e, box.n],
		[box.e, box.s],
		[box.w, box.s],
	];
}

/** Null rather than NaN coordinates: a NaN camera red-screens the map. */
export function boxFromManifest(raw: unknown): Box | null {
	if (!raw || typeof raw !== "object") return null;
	const b = raw as Record<string, unknown>;
	const { w, s, e, n } = b;
	if (
		typeof w !== "number" ||
		typeof s !== "number" ||
		typeof e !== "number" ||
		typeof n !== "number"
	)
		return null;
	if (![w, s, e, n].every(Number.isFinite)) return null;
	if (!(e > w) || !(n > s)) return null;
	return { w, s, e, n };
}

export interface RoadPicture {
	key: string;
	box: Box;
}

export function roadPictureFromManifest(manifest: {
	tiles: Array<{ k: string }>;
	box?: unknown;
}): RoadPicture | null {
	const entry = manifest.tiles.find((t) => isRoadPictureKey(t.k));
	if (!entry) return null;
	const box = boxFromManifest(manifest.box);
	// Never guess the box: a guessed one drew roads 89 km from the pin.
	if (!box) return null;
	return { key: entry.k, box };
}
