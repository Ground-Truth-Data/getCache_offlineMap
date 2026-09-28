// Each parent passes its own translation table in; this file names no tier, host or
// repo, so a child cloned alone hands none and gets no pill.

export type TierRoute = {
	/** Matched longest-prefix. */
	path: string;
	/** Omit when this route has no equivalent on the other tier. */
	otherPath?: string;
	repo?: string;
	/** Only when a tier splits by hostname. */
	otherOrigin?: string;
};

export const TIER_HOME = "/";

/** Longest-prefix match, so /who/acme finds the /who entry. */
function matchRoute(pathname: string, routes: TierRoute[]): TierRoute | undefined {
	let best: TierRoute | undefined;
	for (const r of routes) {
		const hit = r.path === "/" ? pathname === "/" : pathname === r.path || pathname.startsWith(r.path + "/");
		if (!hit) continue;
		if (!best || r.path.length > best.path.length) best = r;
	}
	return best;
}

/** Unlisted falls back to `otherHome`, which only the tier being linked to knows. */
export function otherTierPath(
	pathname: string,
	routes: TierRoute[],
	otherHome: string = TIER_HOME,
): string {
	return matchRoute(pathname, routes)?.otherPath ?? otherHome ?? TIER_HOME;
}

/** undefined = the tier's default. */
export function otherTierOrigin(
	pathname: string,
	routes: TierRoute[],
): string | undefined {
	return matchRoute(pathname, routes)?.otherOrigin;
}

export function currentRepo(pathname: string, routes: TierRoute[]): string | undefined {
	return matchRoute(pathname, routes)?.repo;
}

/** Whether the table maps this page across, as opposed to substituting home. */
export function servesOtherSide(pathname: string, routes: TierRoute[]): boolean {
	return matchRoute(pathname, routes)?.otherPath !== undefined;
}

export type OtherSideStatus = "serves" | "missing" | "unknown";

// A rapper install serves one child, a subset of what the table lists. Dev only — the
// sole caller is behind `import.meta.env.DEV`. Failure is "unknown", never "missing",
// so the pill stays live rather than greying out a destination that may be fine.
export async function probeOtherSide(
	origin: string,
	path: string,
	fetchImpl: typeof fetch = fetch,
): Promise<OtherSideStatus> {
	try {
		const res = await fetchImpl(origin + path, {
			method: "HEAD",
			credentials: "omit",
			cache: "no-store",
		});
		if (res.status === 404) return "missing";
		if (res.ok) return "serves";
		return res.status >= 500 ? "serves" : "unknown";
	} catch {
		return "unknown";
	}
}
