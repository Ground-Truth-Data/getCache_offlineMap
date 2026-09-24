/**
 * Directions: ask online, keep the answer, draw it offline. `live` rides with every
 * answer and the caller must paint the two differently, or a snapshot gets trusted as live.
 */

import { fetchRoute, type RouteOptions } from "./routeFetch";
import { readRoute, writeRoute } from "./routeCache";
import type { LngLat, Route } from "./routeContract";

export interface RouteAnswer {
	route: Route;
	/** false = off the disk */
	live: boolean;
}

export type RouteFailure = "offline-and-unsaved" | "ask-failed";

export class RouteError extends Error {
	constructor(
		readonly reason: RouteFailure,
		readonly cause?: unknown,
	) {
		super(reason);
		this.name = "RouteError";
	}
}

/** Online → fetch and store. Otherwise the saved route with `live: false`; throws only when there is none. */
export async function getDirections(
	from: LngLat,
	to: LngLat,
	opts: RouteOptions & { onLine?: () => boolean },
): Promise<RouteAnswer> {
	const onLine =
		opts.onLine ??
		(() => typeof navigator === "undefined" || navigator.onLine !== false);

	if (onLine()) {
		try {
			const route = await fetchRoute(from, to, opts);
			await writeRoute(route);
			return { route, live: true };
		} catch (cause) {
			// The radio can drop between the check and the request.
			const saved = await readRoute(to);
			if (saved) return { route: saved, live: false };
			throw new RouteError("ask-failed", cause);
		}
	}

	const saved = await readRoute(to);
	if (saved) return { route: saved, live: false };
	throw new RouteError("offline-and-unsaved");
}

/** A LineString is a corridor, so storing this earns roads-only blobs along the whole route. */
export function routeAsFeature(r: Route): GeoJSON.Feature {
	return {
		type: "Feature",
		geometry: { type: "LineString", coordinates: r.coordinates },
		properties: {
			name: r.toName ? `Route to ${r.toName}` : "Route",
			routeKind: r.kind,
			routeFetchedAt: r.fetchedAt,
			routeMetres: r.metres,
		},
	};
}
