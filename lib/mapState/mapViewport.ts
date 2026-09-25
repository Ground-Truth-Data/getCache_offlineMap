// ⚠️ Structural type, not mapboxgl.Map/MaplibreMap: MapLibre's maxPitch is 60 vs Mapbox's 85, so a pitch above 60 is CLAMPED, not thrown.
type CameraMap = {
	getCenter(): { lng: number; lat: number };
	getZoom(): number;
	getBearing(): number;
	getPitch(): number;
	setBearing(bearing: number): unknown;
	setPitch(pitch: number): unknown;
	on(type: "moveend", listener: () => void): unknown;
	off(type: "moveend", listener: () => void): unknown;
};

import { sandboxWorld, worldStorageSuffix } from "../shared/sandboxDbNames";

const CAMERA_KEY = "retreever-map-camera";
const FRAMED_KEY = "retreever-map-framed-key";

/** Suffixed per world: roaming the practice map must never move the real app's camera. */
function cameraKey(): string {
	return CAMERA_KEY + worldStorageSuffix();
}
function framedKey(): string {
	return FRAMED_KEY + worldStorageSuffix();
}

/** Online and offline MUST share one home so the crow toggle lands in the same place. */
export { MAP_HOME_CENTER } from "../shared/homeCentre";

export const SANDBOX_HOME_CENTER: [number, number] = [-76.32622, 45.25341];
export const SANDBOX_HOME_ZOOM = 12.8;

export interface SavedCamera {
	center: [number, number];
	zoom: number;
	bearing: number;
	pitch: number;
}

function finite(n: unknown): n is number {
	return typeof n === "number" && Number.isFinite(n);
}

/** Where a feature with no known location lands — never resume, persist or auto-frame on it. */
export function isNullIsland(lng: number, lat: number): boolean {
	return Math.abs(lng) < 0.5 && Math.abs(lat) < 0.5;
}

export function loadCamera(): SavedCamera | null {
	// The practice sandbox only: a named world is a blank phone, not the seeded map.
	const fallback: SavedCamera | null = sandboxWorld() === "1"
		? {
				center: SANDBOX_HOME_CENTER,
				zoom: SANDBOX_HOME_ZOOM,
				bearing: 0,
				pitch: 0,
			}
		: null;
	if (typeof localStorage === "undefined") return fallback;
	try {
		const raw = localStorage.getItem(cameraKey());
		if (!raw) return fallback;
		const v = JSON.parse(raw);
		if (
			Array.isArray(v?.center) &&
			finite(v.center[0]) &&
			finite(v.center[1]) &&
			!isNullIsland(v.center[0], v.center[1]) &&
			finite(v.zoom) &&
			finite(v.bearing) &&
			finite(v.pitch)
		) {
			return {
				center: [v.center[0], v.center[1]],
				zoom: v.zoom,
				bearing: 0,
				pitch: 0,
			};
		}
	} catch {
	}
	return null;
}

function saveCamera(map: CameraMap): void {
	if (typeof localStorage === "undefined") return;
	try {
		const c = map.getCenter();
		const cam: SavedCamera = {
			center: [c.lng, c.lat],
			zoom: map.getZoom(),
			// NORTH IS UP — never persist bearing/pitch: one accidental twist would rotate the map on every remount.
			bearing: 0,
			pitch: 0,
		};
		if (!finite(cam.center[0]) || !finite(cam.center[1]) || !finite(cam.zoom)) {
			return;
		}
		if (isNullIsland(cam.center[0], cam.center[1])) return;
		localStorage.setItem(cameraKey(), JSON.stringify(cam));
	} catch {
	}
}

export function attachCameraPersistence(map: CameraMap): () => void {
	const onMoveEnd = (): void => saveCamera(map);
	map.on("moveend", onMoveEnd);
	return () => {
		map.off("moveend", onMoveEnd);
	};
}

/** ⚠️ A one-way assertion, never a restore of a saved bearing/pitch — restoring brings the map back rotated. */
export function applyCameraOrientation(map: CameraMap, _cam: SavedCamera): void {
	// camera-allow-raw: literal 0, not a computed value — nothing for safeMap to validate
	map.setBearing(0);
	// camera-allow-raw: as above
	map.setPitch(0);
}

export function loadFramedMapKey(): string | null {
	if (typeof localStorage === "undefined") return null;
	try {
		return localStorage.getItem(framedKey());
	} catch {
		return null;
	}
}

export function saveFramedMapKey(key: string | null): void {
	if (typeof localStorage === "undefined" || !key) return;
	try {
		localStorage.setItem(framedKey(), key);
	} catch {
	}
}

/** URL camera beats the persisted one, which beats home. Both maps resolve through this so the crow toggle lands where you were. */
export function openingCamera(
	url: { center: [number, number]; zoom?: number } | undefined,
	saved: SavedCamera | null,
	home: { center: [number, number]; zoom: number },
): { center: [number, number]; zoom: number } {
	if (url) {
		return { center: url.center, zoom: url.zoom ?? saved?.zoom ?? home.zoom };
	}
	if (saved) return { center: saved.center, zoom: saved.zoom };
	return home;
}
