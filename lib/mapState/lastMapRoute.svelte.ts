export const ONLINE_MAP_ROUTE = "/app/map";
export const OFFLINE_MAP_ROUTE = "/app/offlinev10";

export type MapRoute = typeof ONLINE_MAP_ROUTE | typeof OFFLINE_MAP_ROUTE;

import { worldStorageSuffix } from "../shared/sandboxDbNames";

const KEY = "retreever-last-map-route";

// Suffixed per world — a sandbox must never decide the real MAP tab's target.
function storageKey(): string {
	return KEY + worldStorageSuffix();
}

// An unvalidated value would 404 the MAP tab via goto.
function isMapRoute(v: unknown): v is MapRoute {
	return v === ONLINE_MAP_ROUTE || v === OFFLINE_MAP_ROUTE;
}

// The offline map is the only map route with a store behind it; `/app/map`
// draws no pins.
const DEFAULT_MAP_ROUTE: MapRoute = OFFLINE_MAP_ROUTE;

// ⚠️ localStorage is NOT reactive — read via this $state cell, or the UI silently goes stale.
// ⚠️ Seed eagerly at module scope — lazy seeding inside $derived throws state_unsafe_mutation.
let current = $state<MapRoute>(readStored());
// The key it was seeded FOR, not a flag — a flag leaks the sandbox's choice into the real app.
let seededFor: string | null = storageKey();

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
	// PURE READ — called inside a $derived, where a write throws state_unsafe_mutation.
	if (seededFor !== storageKey()) return readStored();
	return current;
}

// Clearing localStorage alone does NOT reset the cell; tests must call this.
export function resetLastMapRouteCache(): void {
	seededFor = null;
	current = DEFAULT_MAP_ROUTE;
}

export function saveLastMapRoute(route: MapRoute): void {
	if (!isMapRoute(route)) return;
	// Cell first: a storage failure must never cost the live UI update.
	seededFor = storageKey();
	current = route;
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(storageKey(), route);
	} catch {
	}
}

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

// The tab bar's startsWith(href) can't answer this: the two routes are siblings, not nested.
export function isMapPath(pathname: string): boolean {
	return (
		pathname.startsWith(ONLINE_MAP_ROUTE) ||
		pathname.startsWith(OFFLINE_MAP_ROUTE)
	);
}
