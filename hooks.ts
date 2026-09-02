import type { Reroute } from "@sveltejs/kit";

// ⚠️ keep DEFAULT in step with this child's defaultPath in $rig/childRegistry.ts — nav and the printed url read it.
// ⚠️ list dev endpoints in SERVED — an unlisted path collapses to DEFAULT, so fetch("/api/…") gets the map page's HTML with a 200.
const SERVED: string[] = ["/api/parentGuard"];
const DEFAULT = "/offline";

// Both tiers mount this child under /app; a solo install serves it flat. The
// same link (`/app/offline`) must land in both, so the prefix is stripped here.
const APP_PREFIX = "/app";

export const reroute: Reroute = ({ url }) => {
	const p = url.pathname.startsWith(APP_PREFIX + "/")
		? url.pathname.slice(APP_PREFIX.length)
		: url.pathname;
	const known = [DEFAULT, ...SERVED].some((k) => p === k);
	return known ? p : DEFAULT;
};
