// ⛔ Must never cause a permission prompt: every path is gated on gpsIsGranted(), which only inspects.
// ⚠️ Not getCurrentGps() from captureGps.ts — it calls requestPermissions() first, which PROMPTS.
import { Geolocation } from "@capacitor/geolocation";
import { isUsableFix } from "./liveAnchor";
import type { LngLat } from "./kmGeo";

async function gpsIsGranted(): Promise<boolean> {
	try {
		const p = await Geolocation.checkPermissions();
		return p.location === "granted" || p.coarseLocation === "granted";
	} catch {
		// codestyle-allow-swallow: no permissions API (dt-web) = not granted.
		return false;
	}
}

/** Written by the blue-dot controller (userLocation.svelte.ts). */
const LAST_FIX_KEY = "rt-last-fix";

/** Six hours: we're asking "which blob", not drawing a dot. */
const STORED_FIX_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** A BATTERY budget, not a coverage guarantee: a moving vehicle can cross several blobs between polls. */
const LIVE_FIX_MIN_INTERVAL_MS = 15 * 60 * 1000;

/** Low accuracy ON PURPOSE — a km-scale containment test needs no GPS-radio lock. */
const POLL_OPTS = { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 };

let lastPollTs = 0;

/** Null if absent, corrupt, stale or unusable — the caller then bakes nothing new. */
export function readStoredFix(now: number = Date.now()): LngLat | null {
	try {
		if (typeof localStorage === "undefined") return null;
		const raw = localStorage.getItem(LAST_FIX_KEY);
		if (!raw) return null;
		const p = JSON.parse(raw) as { lng?: unknown; lat?: unknown; ts?: unknown };
		const pos: LngLat = [Number(p?.lng), Number(p?.lat)];
		if (!isUsableFix(pos)) return null;
		const ts = Number(p?.ts);
		if (!Number.isFinite(ts) || now - ts > STORED_FIX_MAX_AGE_MS) return null;
		return pos;
	} catch {
		// codestyle-allow-swallow: a corrupt entry means "unknown position", not an error worth surfacing.
		return null;
	}
}

/** The SAME key + shape the blue-dot controller writes, so either writer seeds the other's reads. */
function writeStoredFix(pos: LngLat, ts: number): void {
	try {
		if (typeof localStorage === "undefined") return;
		localStorage.setItem(
			LAST_FIX_KEY,
			JSON.stringify({ lng: pos[0], lat: pos[1], ts }),
		);
	} catch {
		// codestyle-allow-swallow: losing the cache costs one extra poll later, never correctness.
	}
}

/** Permission FIRST, then the free stored fix, then — rarely — one poll. */
export async function getLiveFix(): Promise<LngLat | null> {
	if (!(await gpsIsGranted())) return null;

	const stored = readStoredFix();
	if (stored) return stored;

	const now = Date.now();
	if (now - lastPollTs < LIVE_FIX_MIN_INTERVAL_MS) return null;
	lastPollTs = now;
	try {
		const p = await Geolocation.getCurrentPosition(POLL_OPTS);
		const pos: LngLat = [p.coords.longitude, p.coords.latitude];
		if (!isUsableFix(pos)) return null;
		// Persist it, or a user who never opens the online map hits the throttle with storage empty and bakes nothing.
		writeStoredFix(pos, now);
		return pos;
	} catch {
		// codestyle-allow-swallow: no fix (indoors, cold start, timeout) is ordinary — the pass carries on with feature anchors; live anchor is an ADDITION, never a prerequisite.
		return null;
	}
}

/** Test seam — resets the poll rate limiter. */
export function __resetLiveFixThrottle(): void {
	lastPollTs = 0;
}
