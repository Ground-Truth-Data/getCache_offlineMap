import type { Reroute } from "@sveltejs/kit";

// Keep DEFAULT in sync with this child's defaultPath in $rig/childRegistry.ts.
// An unlisted path collapses to DEFAULT, so fetch("/api/…") would get the map page's HTML with a 200.
const SERVED: string[] = ["/georef"];
const DEFAULT = "/offlinev10";

// Both tiers mount this child under /app; a solo install serves it flat.
const APP_PREFIX = "/app";

export const reroute: Reroute = ({ url }) => {
	const p = url.pathname.startsWith(APP_PREFIX + "/")
		? url.pathname.slice(APP_PREFIX.length)
		: url.pathname;
	const known = [DEFAULT, ...SERVED].some((k) => p === k);
	return known ? p : DEFAULT;
};
