import { isUsableFix } from "./liveAnchor";
import type { LngLat } from "./kmGeo";

/** Written by the blue-dot controller (userLocation.svelte.ts). */
const LAST_FIX_KEY = "rt-last-fix";

/** Six hours: we're asking "which blob", not drawing a dot. */
const STORED_FIX_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Null if absent, corrupt, stale or unusable. */
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
