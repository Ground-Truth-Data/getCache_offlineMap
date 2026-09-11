/**
 * What a fetched route is, once it is ours.
 *
 * ⚠️ EVERY ROUTE CARRIES `fetchedAt` AND NOTHING MAY DROP IT. A route drawn
 * without its age is the one dangerous failure in this feature: the line looks
 * identical whether it came back a second ago or last Tuesday, so the age is
 * the only thing separating "follow this" from "this was true once". Same rule
 * the fire cache runs under, for the same reason.
 */

export type LngLat = [number, number];

/** How the line was arrived at — the two are NOT interchangeable to a driver. */
export type RouteKind =
	/** A real road route from a router that knew the road network. */
	| "road"
	/** No road route existed (or the router refused): the straight line, bearing only. */
	| "direct";

export interface Route {
	/** Where the driver asked from. */
	from: LngLat;
	/** Where they asked to go. */
	to: LngLat;
	/** The line itself, [lng, lat] pairs. A `direct` route is exactly two points. */
	coordinates: LngLat[];
	kind: RouteKind;
	/** Metres along the line. */
	metres: number;
	/** Seconds the router predicted; null for a `direct` line, which predicts nothing. */
	seconds: number | null;
	/** Epoch ms when this came back from the router. NEVER omit — see the file header. */
	fetchedAt: number;
	/** Human name of the destination, for the saved-route card. */
	toName?: string;
}

/** How old a route is right now, in ms. */
export function routeAgeMs(r: Route, now = Date.now()): number {
	return Math.max(0, now - r.fetchedAt);
}

/**
 * A route this old is still worth drawing but must be labelled as remembered,
 * not live. Roads do not move, so this is not about the geometry going wrong —
 * it is about a driver's memory of WHEN they asked, which fades in hours.
 */
export const ROUTE_STALE_MS = 60 * 60 * 1000;

export function isRouteStale(r: Route, now = Date.now()): boolean {
	return routeAgeMs(r, now) >= ROUTE_STALE_MS;
}

/**
 * What the banner says about this route. The UI must show this whenever the
 * route is not live — the whole safety of the feature is that a driver knows
 * they are looking at a memory.
 */
export function routeAgeLabel(
	r: Route,
	live: boolean,
	now = Date.now(),
): string {
	if (live) return "Live route";
	const mins = Math.floor(routeAgeMs(r, now) / 60_000);
	const when =
		mins < 1
			? "just now"
			: mins < 60
				? `${mins} min ago`
				: mins < 60 * 48
					? `${Math.floor(mins / 60)}h ago`
					: `${Math.floor(mins / 1440)} days ago`;
	const what = r.kind === "direct" ? "Saved direct line" : "Saved route";
	return `${what} — no signal, fetched ${when}`;
}
