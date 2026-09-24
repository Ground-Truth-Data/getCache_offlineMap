/**
 * The only code that computes a route, and only online: rendering tiles carry road shapes
 * but no junctions, so the phone cannot route on its own data. A NoRoute from the router is
 * the expected answer at a cutblock, not a failure: it falls back to the straight bearing line.
 */

import { decodePolyline } from "./polyline";
import type { LngLat, Route } from "./routeContract";
import { kmBetween } from "../../lib/shared/kmGeo";

const API = "https://api.mapbox.com/directions/v5/mapbox/driving";

/** Asked once, by hand; a slow answer beats none. */
const TIMEOUT_MS = 15_000;

export interface RouteOptions {
	token: string;
	toName?: string;
	signal?: AbortSignal;
	fetchFn?: typeof fetch;
	now?: () => number;
}

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

/** Falls back to {@link directRoute} when the router has no road answer; throws only when the ask itself failed. */
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
