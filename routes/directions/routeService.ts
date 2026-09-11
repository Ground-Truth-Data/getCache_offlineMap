/**
 * Directions, app-wide: ask online, keep the answer, draw it offline.
 *
 * Nobody looks for directions in airplane mode — they ask in town, with bars,
 * before they drive out. So the ask is ALWAYS an online ask, and going offline
 * does not change what the driver does, only where the answer comes from.
 *
 * ⚠️ THE SWITCH IS AUTOMATIC, SAYING SO IS NOT OPTIONAL. Handing back a saved
 * route silently is how a snapshot gets trusted as live, so `live` rides with
 * every answer and the caller must paint the two differently. The code cannot
 * make the UI honest, but it can make dishonesty require ignoring a field.
 */

import { fetchRoute, type RouteOptions } from "./routeFetch";
import { readRoute, writeRoute } from "./routeCache";
import type { LngLat, Route } from "./routeContract";

export interface RouteAnswer {
	route: Route;
	/** True only when this came back from the router JUST NOW. False = off the disk. */
	live: boolean;
}

export type RouteFailure =
	/** No signal and nothing saved for this destination — the only true dead end. */
	| "offline-and-unsaved"
	/** The ask reached the network and still failed (bad token, server down). */
	| "ask-failed";

export class RouteError extends Error {
	constructor(
		readonly reason: RouteFailure,
		readonly cause?: unknown,
	) {
		super(reason);
		this.name = "RouteError";
	}
}

/**
 * The way there. Online → fetch, store, hand back `live: true`. Offline or the
 * router unreachable → the saved route with `live: false`, and only when there
 * is none does this throw.
 */
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
			// The radio can drop between the check and the request — a saved
			// route is a better answer than an error, so the throw waits.
			const saved = await readRoute(to);
			if (saved) return { route: saved, live: false };
			throw new RouteError("ask-failed", cause);
		}
	}

	const saved = await readRoute(to);
	if (saved) return { route: saved, live: false };
	throw new RouteError("offline-and-unsaved");
}

/**
 * The route as a feature the app can store — which is what makes it bake its
 * own map. A LineString is a corridor (see blobService), so writing this earns
 * roads-only blobs spread along the whole route, capped at ten by `anchorsOf`.
 * The route quite literally saves the ground it crosses.
 */
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
