/**
 * Ask a router for the way there, ONLINE — this is the only code in the app
 * that computes a route, and it never runs on the phone's own data.
 *
 * The offline map cannot route: its tiles carry road SHAPES and a road's kind,
 * but no junctions, no node ids, and a road crossing a tile boundary is two
 * unrelated lines. Two tracks that appear to meet on screen may not meet on the
 * ground, and nothing in a rendering tile can tell those apart. So the answer
 * is fetched while there is signal and kept, rather than guessed later.
 *
 * ⛔ A REFUSAL IS NOT A FAILURE. Mapbox returns NoRoute for exactly the ground
 * this app exists for — a cutblock at the end of forestry road nobody mapped
 * as drivable. Showing nothing there would be worse than useless, so the
 * fallback is the straight bearing line, clearly marked `direct` so the UI can
 * say it is a heading and not a road.
 */

import { decodePolyline } from "./polyline";
import type { LngLat, Route } from "./routeContract";
import { kmBetween } from "../../lib/shared/kmGeo";

const API = "https://api.mapbox.com/directions/v5/mapbox/driving";

/** Longer than a map tile fetch on purpose: this is asked once, by hand, and a slow answer still beats none. */
const TIMEOUT_MS = 15_000;

export interface RouteOptions {
	token: string;
	toName?: string;
	signal?: AbortSignal;
	/** Seam for tests. */
	fetchFn?: typeof fetch;
	now?: () => number;
}

/** The straight line, when no road route exists. Two points, no duration — it predicts nothing. */
export function directRoute(
	from: LngLat,
	to: LngLat,
	opts: { toName?: string; now?: () => number } = {},
): Route {
	return {
		from,
		to,
		coordinates: [from, to],
		kind: "direct",
		metres: Math.round(kmBetween(from, to) * 1000),
		seconds: null,
		fetchedAt: (opts.now ?? Date.now)(),
		toName: opts.toName,
	};
}

/**
 * Fetch the driving route. Falls back to {@link directRoute} when the router
 * has no road answer — never throws for that case, since it is the expected
 * one in the bush. Throws only when the ASK itself failed (offline, bad token,
 * timeout), because then the caller must tell the driver to try while in range.
 */
export async function fetchRoute(
	from: LngLat,
	to: LngLat,
	opts: RouteOptions,
): Promise<Route> {
	const { token, toName, fetchFn = fetch, now = Date.now } = opts;
	const url =
		`${API}/${from[0]},${from[1]};${to[0]},${to[1]}` +
		`?geometries=polyline6&overview=full&access_token=${encodeURIComponent(token)}`;

	const timer = new AbortController();
	const bail = setTimeout(() => timer.abort(), TIMEOUT_MS);
	// The caller's own abort must still reach the request.
	opts.signal?.addEventListener("abort", () => timer.abort(), { once: true });

	let body: {
		code?: string;
		routes?: Array<{ geometry?: string; distance?: number; duration?: number }>;
	};
	try {
		const res = await fetchFn(url, { signal: timer.signal });
		if (!res.ok) throw new Error(`directions HTTP ${res.status}`);
		body = await res.json();
	} finally {
		clearTimeout(bail);
	}

	const best = body.routes?.[0];
	// NoRoute, NoSegment, an empty list — all mean "no road answer", not "ask failed".
	if (!best?.geometry) return directRoute(from, to, { toName, now });

	const coordinates = decodePolyline(best.geometry, 6);
	if (coordinates.length < 2) return directRoute(from, to, { toName, now });

	return {
		from,
		to,
		coordinates,
		kind: "road",
		metres: Math.round(best.distance ?? 0),
		seconds: best.duration == null ? null : Math.round(best.duration),
		fetchedAt: now(),
		toName,
	};
}
