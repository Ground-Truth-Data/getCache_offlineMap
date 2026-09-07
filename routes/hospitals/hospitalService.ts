/**
 * The hospital pass, app-wide. A HOSPITAL_RADIUS_KM disc per ANCHOR — the
 * live fix and the ground touched in 30 days, the same set the fire wall is
 * measured from — from the tiles Worker into the shared hospital cache both
 * maps paint from. Hospitals change glacially, so a disc is fresh for a month.
 * The pass runs when a map asks (`wantHospitals`), when the app says the
 * anchors changed, on coming back online or to the front, and daily. A dead
 * feed pauses the pass for a minute, never the map.
 *
 * The Worker's address comes from tilesHost.ts, configured by the app at boot
 * — this package names no host of its own.
 */

import { hospitalsUrl } from "../../lib/worker/worker-local-dev/tilesHost";
import {
	allDiscs,
	coveredBy,
	HOSPITAL_RADIUS_KM,
	hospitalKey,
	type LngLat,
	onHospitalsWanted,
	writeDisc,
} from "./hospitalCache";

export const HOSPITAL_RETRY_MS = 60_000;
const HOSPITAL_TIMEOUT_MS = 20_000;
const HOSPITAL_TICK_MS = 24 * 60 * 60 * 1000;

/** The Worker's disc as text, validated as a FeatureCollection and nothing more. */
export async function fetchHospitals(
	lng: number,
	lat: number,
): Promise<{ geojson: string; count: number; radiusKm: number }> {
	const url = hospitalsUrl(lng, lat, HOSPITAL_RADIUS_KM);
	if (url === null)
		throw new Error(
			"no tiles host configured — configureTilesHost() must run before fetching hospitals.",
		);
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), HOSPITAL_TIMEOUT_MS);
	let text: string;
	let radiusKm = 0;
	try {
		// The edge cache protects the Worker; a browser copy only ever serves a stale answer under a year-long immutable header.
		const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
		if (!res.ok) throw new Error(`hospitals endpoint responded ${res.status}`);
		text = await res.text();
		radiusKm = Number(res.headers.get("X-Radius-Km"));
	} finally {
		clearTimeout(timer);
	}
	const parsed = JSON.parse(text) as { type?: string; features?: unknown };
	if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features))
		throw new Error(
			"hospitals endpoint returned a malformed FeatureCollection",
		);
	return {
		geojson: text,
		count: parsed.features.length,
		// A Worker that says nothing served its default disc of 200 km.
		radiusKm: Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 200,
	};
}

let pausedUntil = 0;
let running: Promise<number> | null = null;

/** Fetch a disc for every centre no fresh disc covers. Returns how many landed. One pass at a time; a second ask joins the running one. */
export function refreshHospitals(centres: readonly LngLat[]): Promise<number> {
	if (running) return running;
	running = pass(centres).finally(() => {
		running = null;
	});
	return running;
}

async function pass(centres: readonly LngLat[]): Promise<number> {
	if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
	if (Date.now() < pausedUntil) return 0;
	let landed = 0;
	for (const [lng, lat] of centres) {
		if (coveredBy([lng, lat], await allDiscs())) continue;
		try {
			const r = await fetchHospitals(lng, lat);
			await writeDisc({
				key: hospitalKey(lng, lat),
				lng,
				lat,
				radiusKm: r.radiusKm,
				fetchedAt: Date.now(),
				geojson: r.geojson,
			});
			landed++;
			console.info(
				`[hospitals] ${r.count} within ${r.radiusKm} km of ${lat.toFixed(4)},${lng.toFixed(4)} (${(r.geojson.length / 1024).toFixed(1)} KB)`,
			);
		} catch (error) {
			pausedUntil = Date.now() + HOSPITAL_RETRY_MS;
			console.warn(
				`[hospitals] feed failed at ${lat.toFixed(4)},${lng.toFixed(4)} — pass paused ${HOSPITAL_RETRY_MS / 1000}s, cached hospitals kept`,
				error,
			);
			break;
		}
	}
	return landed;
}

export interface HospitalServiceOptions {
	/** Read at every run — the live fix and the recently touched ground, never a camera. */
	anchors: () => readonly LngLat[];
	/** The app's own signal that the anchor set changed (a pin landed); call `refresh`, return the unsubscribe. */
	onAnchorsChanged?: (refresh: () => void) => () => void;
}

let stop: (() => void) | null = null;

export function startHospitalService(opts: HospitalServiceOptions): () => void {
	if (stop)
		return () => {
			/* already running — the first start's stop owns shutdown */
		};
	const all = (): void => {
		void refreshHospitals(opts.anchors());
	};
	const visible = (): void => {
		if (document.visibilityState === "visible") all();
	};
	const offWanted = onHospitalsWanted((centres) => {
		void refreshHospitals(centres);
	});
	const offAnchors = opts.onAnchorsChanged?.(all) ?? (() => undefined);
	window.addEventListener("online", all);
	document.addEventListener("visibilitychange", visible);
	const timer = setInterval(all, HOSPITAL_TICK_MS);
	all();
	stop = () => {
		offWanted();
		offAnchors();
		window.removeEventListener("online", all);
		document.removeEventListener("visibilitychange", visible);
		clearInterval(timer);
		stop = null;
	};
	return stop;
}
