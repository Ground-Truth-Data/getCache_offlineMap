/**
 * The fetched route on disk, for when the radio is not. Records keep `fetchedAt` and the UI
 * must show it: a remembered route painted as live is the dangerous failure here.
 */

import { makeKeyedIdbStore } from "../../lib/onPhone/store/keyedIdbStore";
import type { LngLat, Route } from "./routeContract";

/** Bump when the stored shape changes; an old record then reads as absent. */
export const ROUTE_CACHE_VERSION = 1;

interface StoredRoute extends Route {
	cacheVersion: number;
}

const idb = makeKeyedIdbStore<StoredRoute>({
	dbName: "rt-route-cache",
	storeName: "routes",
});

/** Keyed by destination, so asking again from a new spot replaces the stale line. */
export function routeKey(to: LngLat): string {
	return `${to[0].toFixed(5)},${to[1].toFixed(5)}`;
}

export async function readRoute(to: LngLat): Promise<Route | null> {
	const rec = await idb.get(routeKey(to));
	if (!rec || rec.cacheVersion !== ROUTE_CACHE_VERSION) return null;
	const { cacheVersion: _v, ...route } = rec;
	return route;
}

export async function writeRoute(r: Route): Promise<void> {
	await idb.put(routeKey(r.to), { ...r, cacheVersion: ROUTE_CACHE_VERSION });
}

export async function deleteRoute(to: LngLat): Promise<void> {
	await idb.delete(routeKey(to));
}

/** Newest first. */
export async function allRoutes(): Promise<Route[]> {
	const all = await idb.getAll();
	return all
		.filter((r) => r.cacheVersion === ROUTE_CACHE_VERSION)
		.map(({ cacheVersion: _v, ...route }) => route)
		.sort((a, b) => b.fetchedAt - a.fetchedAt);
}
