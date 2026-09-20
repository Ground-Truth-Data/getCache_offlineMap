export const ONLINE_MAP_ROUTE = "/app/map";
export const OFFLINE_MAP_ROUTE = "/app/offlinev10";

export type MapRoute = typeof ONLINE_MAP_ROUTE | typeof OFFLINE_MAP_ROUTE;

import { worldStorageSuffix } from "../shared/sandboxDbNames";

const KEY = "retreever-last-map-route";

// localStorage is shared by every world on the origin, so the key is suffixed per world — a sandbox must never decide the real MAP tab’s target.
function storageKey(): string {
	return KEY + worldStorageSuffix();
}

// rejects anything but a known route — an unvalidated value here would 404 the MAP tab via goto.
function isMapRoute(v: unknown): v is MapRoute {
	return v === ONLINE_MAP_ROUTE || v === OFFLINE_MAP_ROUTE;
}

// THE DEFAULT IS THE OFFLINE MAP, because it is the only map route with a
// store behind it: its host page substitutes both `mapPorts` and the pin
// renderer's host, which `/app/map` does not. A device that has never chosen —
// or chose before that was true — must not land on a map that draws no pins.
const DEFAULT_MAP_ROUTE: MapRoute = OFFLINE_MAP_ROUTE;

// ⚠️ localStorage is NOT reactive — read via this $state cell, not directly, or the UI silently goes stale (measured: the tab kept whichever map was visited first).
// ⚠️ seed eagerly at module scope, not lazily on first read — lazy seeding inside $derived throws state_unsafe_mutation.
let current = $state<MapRoute>(readStored());
// tracks the key the cell was seeded FOR, not a boolean — a plain flag would leak the sandbox’s choice into the real app across the boundary.
let seededFor: string | null = storageKey();

/** Read the persisted value once per page load, to seed the cell. */
function readStored(): MapRoute {
	if (typeof localStorage === "undefined") return DEFAULT_MAP_ROUTE;
	try {
		const raw = localStorage.getItem(storageKey());
		if (isMapRoute(raw)) return raw;
	} catch {
	}
	return DEFAULT_MAP_ROUTE;
}

export function loadLastMapRoute(): MapRoute {
	// PURE READ — never writes; called inside a $derived, and Svelte 5 throws state_unsafe_mutation if a derivation mutates state.
	if (seededFor !== storageKey()) return readStored();
	return current;
}

// drops the in-memory cell so the next read re-seeds — clearing localStorage alone does NOT reset it (the cell isn’t re-read every call); tests must call this.
export function resetLastMapRouteCache(): void {
	seededFor = null;
	current = DEFAULT_MAP_ROUTE;
}

// records the current map route; ignores anything that is not one of the two known routes.
export function saveLastMapRoute(route: MapRoute): void {
	if (!isMapRoute(route)) return;
	// cell first, storage second — order matters: a storage failure must never cost the live UI update.
	seededFor = storageKey();
	current = route;
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(storageKey(), route);
	} catch {
	}
}

// builds a "See on map" URL pointing at the current map; callers pass only their params — both map routes already read them via the shared applyMapRoute contract.
export function seeOnMapUrl(
	params?: URLSearchParams | Record<string, string> | string,
): string {
	const route = loadLastMapRoute();
	if (!params) return route;
	const qs =
		params instanceof URLSearchParams
			? params.toString()
			: new URLSearchParams(params).toString();
	return qs ? `${route}?${qs}` : route;
}

// true when pathname is either map route — the tab bar’s generic startsWith(href) test can’t answer this since /map and /offline are siblings, not nested.
export function isMapPath(pathname: string): boolean {
	return (
		pathname.startsWith(ONLINE_MAP_ROUTE) ||
		pathname.startsWith(OFFLINE_MAP_ROUTE)
	);
}
