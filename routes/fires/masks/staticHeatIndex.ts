/**
 * Loads the persistent-heat-source mask lazily, once, and never fatally: a missing mask flags
 * nothing. Rebuild yearly via scripts/buildStaticHeatMask.py.
 */

const ASSET_URL = "/mobileAssets/static-heat-sources.json";

let cache: Set<string> | null = null;
let inFlight: Promise<Set<string>> | null = null;

export async function loadStaticMask(): Promise<Set<string>> {
	if (cache !== null) return cache;
	if (inFlight !== null) return inFlight;
	inFlight = (async () => {
		try {
			const res = await fetch(ASSET_URL);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const keys = (await res.json()) as string[];
			if (!Array.isArray(keys)) throw new Error("mask is not an array");
			cache = new Set(keys);
			return cache;
		} catch (err) {
			// codestyle-allow-swallow: not a swallow — console.warn below is the visible signal; empty mask fails OPEN (safe for a wildfire layer).
			console.warn(
				"[fire] industrial-source mask unavailable — showing all detections",
				err,
			);
			cache = new Set();
			return cache;
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}

/** Empty before the load, which flags nothing. */
export function peekStaticMask(): Set<string> {
	return cache ?? new Set();
}

export function warmStaticMask(): void {
	if (cache === null && inFlight === null) void loadStaticMask();
}

export function __resetStaticMaskForTest(): void {
	cache = null;
	inFlight = null;
}
