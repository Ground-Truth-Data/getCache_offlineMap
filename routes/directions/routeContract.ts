/** A route drawn without its age looks identical whether it came back a second ago or last Tuesday: nothing may drop `fetchedAt`. */

export type LngLat = [number, number];

export type RouteKind =
	| "road"
	/** no road route existed: the straight line, bearing only */
	| "direct";

export interface Route {
	from: LngLat;
	to: LngLat;
	/** a `direct` route is exactly two points */
	coordinates: LngLat[];
	kind: RouteKind;
	metres: number;
	/** null for a `direct` line */
	seconds: number | null;
	fetchedAt: number;
	toName?: string;
}

export function routeAgeMs(r: Route, now = Date.now()): number {
	return Math.max(0, now - r.fetchedAt);
}

/** Past this a route is drawn as remembered, not live: a driver's memory of WHEN they asked fades in hours. */
export const ROUTE_STALE_MS = 60 * 60 * 1000;

export function isRouteStale(r: Route, now = Date.now()): boolean {
	return routeAgeMs(r, now) >= ROUTE_STALE_MS;
}

/** The UI must show this whenever the route is not live. */
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
