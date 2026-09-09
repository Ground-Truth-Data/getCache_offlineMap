/**
 * tierRoutes.ts — WHERE THIS PAGE LIVES UNDER THE OTHER TIER.
 *
 * THE BUG THIS DELETES
 * The pill used to take a fixed `otherPath` prop — `"/"` on ReTreever, and
 * `VITE_OTHER_MOUNT` = `"/who"` on rapper. Both are BUILD-TIME constants, so
 * whatever page you were on, the pill sent you to the same one. Standing on
 * /what and switching tiers landed you on /who; standing on /offline landed
 * you on the search page. The switch claimed to be "this page, other server"
 * and was actually "some page, other server".
 *
 * WHY A CONSTANT COULD NEVER WORK. `define` substitutes text once, when the
 * bundle is built — before any URL exists. "Which page am I on" is only
 * knowable when a request is answered. The destination was being read from a
 * layer that cannot hold the fact. So it moves to render time: the live
 * pathname goes in, the other tier's pathname comes out.
 *
 * WHY IT IS A MAP AND NOT A PASSTHROUGH
 * The two tiers do not serve the same routes and never will. ReTreever serves
 * /who and /what from one dynamic route; a rapper install carries ONE child,
 * mounted at "/". Carrying the path across verbatim was MEASURED landing on a
 * 404 (see rapper/vite.config.ts). So each parent declares the translation for
 * the routes IT serves, and anything unlisted falls back to the other tier's
 * home — a working page beats a dead pill.
 *
 * WHY THE MAP IS PASSED IN AND NOT WRITTEN HERE
 * This file names no tier, no host, no port and no repo, exactly as ParentPill
 * does. The mapping is a fact about which parent mounted which child, and only
 * the mounting parent knows it — a child that wrote it down would be naming a
 * parent, which noParentNames.test.ts fails. Each parent hands its own table
 * to SharedNav; a child cloned alone hands none and gets no pill.
 */

/**
 * One route this tier serves, and what it corresponds to elsewhere.
 *
 * `repo` rides along because the GitHub links are per-VIEW, not per-mount: a
 * parent serving several children shows the repo for the child you are
 * actually looking at, not whichever one the mount was installed with.
 */
export type TierRoute = {
	/** A pathname on THIS tier. Matched longest-prefix, so a nested route like
	 *  /who/acme resolves through its /who entry without its own line. */
	path: string;
	/** The pathname on the OTHER tier showing the same thing. Omit when the
	 *  other tier has no counterpart — the caller falls back to home. */
	otherPath?: string;
	/** The child repo backing this view, for the GitHub link. */
	repo?: string;
	/**
	 * The ORIGIN serving `otherPath`, when it is not the other tier's default.
	 *
	 * A tier is not always one server. MEASURED 27 Aug 2026: the pill on
	 * `:5174/offline` correctly produced `/app/offline`, then pointed it at
	 * retreever.localhost:5173 — where that path 404s, because /offline is
	 * served on the getcache host and only /who on the retreever one. One
	 * injected origin per tier cannot address a tier that splits by hostname,
	 * so a row that lives on a different host says which.
	 */
	otherOrigin?: string;
};

/**
 * The LAST-RESORT fallback, when a tier declares no landing route of its own.
 * "/" always resolves to something on any server, which is the only property
 * required of it.
 */
export const TIER_HOME = "/";

/**
 * Longest-prefix match, so /who/acme finds the /who entry.
 *
 * Longest rather than first: an entry for /where and one for /where/debug must
 * both be expressible, and declaration order should not decide which wins.
 * Exact "/" only ever matches "/" as a prefix of everything, so it is scored
 * last by construction — its length is 1.
 */
function matchRoute(pathname: string, routes: TierRoute[]): TierRoute | undefined {
	let best: TierRoute | undefined;
	for (const r of routes) {
		const hit = r.path === "/" ? pathname === "/" : pathname === r.path || pathname.startsWith(r.path + "/");
		if (!hit) continue;
		if (!best || r.path.length > best.path.length) best = r;
	}
	return best;
}

/**
 * The other tier's pathname for the page you are on right now.
 *
 * Unlisted route, or a listed one with no counterpart there → the other tier's
 * LANDING route. The pill stays live either way: a switch that silently does
 * nothing reads as broken, and a greyed-out one hides that the other tier is
 * running.
 *
 * WHY `otherHome` IS A PARAMETER AND NOT "/".
 * "/" is where a server answers, not necessarily where its WORK is. rapper
 * serves its one child at "/", so "/" is right for it. ReTreever serves a
 * marketing homepage at "/" and its actual search at /who, so falling back to
 * "/" dropped you on a landing page — a working page, but not the one you were
 * looking at, which is the complaint this whole file exists to answer.
 * Only the tier being LINKED TO knows where its useful landing route is, so
 * the caller passes it; omitted, this degrades to the old "/" behaviour.
 */
export function otherTierPath(
	pathname: string,
	routes: TierRoute[],
	otherHome: string = TIER_HOME,
): string {
	return matchRoute(pathname, routes)?.otherPath ?? otherHome ?? TIER_HOME;
}

/**
 * The origin serving this page on the other tier, when the row names one.
 *
 * Undefined means "the tier's default origin", which the caller already has.
 * See TierRoute.otherOrigin for why a tier can need more than one.
 */
export function otherTierOrigin(
	pathname: string,
	routes: TierRoute[],
): string | undefined {
	return matchRoute(pathname, routes)?.otherOrigin;
}

/**
 * The child repo backing the page you are on right now, or undefined when this
 * route has no child behind it (a parent's own page). The caller drops the
 * link rather than pointing at a repo that does not hold this view.
 */
export function currentRepo(pathname: string, routes: TierRoute[]): string | undefined {
	return matchRoute(pathname, routes)?.repo;
}

/**
 * THE `?rtvrFrom=` STAMP IS DELETED — the cause was fixed instead.
 *
 * There was a pair of helpers here, stampOrigin/readOrigin, that wrote the
 * page you were leaving into the destination's query string so the far side
 * could send you back to it. They existed because rapper served BOTH of the
 * who_what child's views from "/": two views, one url, a many-to-one mapping
 * with no inverse, so returning always guessed /who.
 *
 * The child now serves /who and /what itself. Each row is a bijection, the
 * return trip is an ordinary table lookup, and there is nothing left to carry
 * beside the url. Carrying state next to a url that can already express it was
 * the bug; deleting the carrier is the fix, not an additional layer on it.
 *
 * If a future child again mounts several views on one path, the answer is to
 * give it real paths — not to bring this back.
 */

/**
 * DOES THE OTHER TIER SERVE THIS PAGE AT ALL?
 *
 * `otherTierPath` deliberately always returns something, because a pill that
 * points nowhere reads as broken. But that same helpfulness hides a real
 * difference: "rapper shows this at /" and "rapper does not show this, here is
 * its home instead" come back as identical strings, so the caller cannot tell
 * a MAPPING from a SUBSTITUTION and silently sends you somewhere you did not
 * ask for.
 *
 * This answers the question the path cannot. False → the caller greys the pill
 * out rather than performing a swap it never announced.
 *
 * A stamped origin (readOrigin) always wins over this: if the other tier told
 * us where we came from, that page demonstrably exists there.
 */
export function servesOtherSide(pathname: string, routes: TierRoute[]): boolean {
	return matchRoute(pathname, routes)?.otherPath !== undefined;
}

/**
 * WHAT THE OTHER TIER ACTUALLY SERVES — asked, not asserted.
 *
 * THE BUG THIS DELETES
 * `servesOtherSide` above answers from a TABLE, and a table can only describe
 * a tier in general. A rapper install carries exactly ONE child, chosen at
 * install time, so the running server serves a strict SUBSET of what the table
 * lists. MEASURED 27 Aug 2026: the table declared /map, /map/debug, /offline
 * and /offline/debug, the pill rendered live links for all four, and the rapper
 * on :5174 — a who_what install — answered every one of them with a 404.
 *
 * The table was not wrong. It was answering a different question. "Which of my
 * routes COULD map across" is a fact about the source; "does the thing on the
 * other end have this page" is a fact about a process that is running right
 * now, and no build-time artifact can hold it. Adding rows, or hand-syncing a
 * second table against whichever child is installed, is the same duplication
 * one layer along — it drifts the first time somebody swaps the child.
 *
 * So this asks. HEAD the url on the other tier and read the status. The server
 * that answers IS the authority on what it serves, which is a thing no table
 * can be. Both dev servers already send `Access-Control-Allow-Origin: *`, so
 * the cross-origin request is readable.
 *
 * DEV ONLY, and that is structural rather than promised: the sole caller sits
 * behind `import.meta.env.DEV`, so this function is unreachable — and tree-
 * shaken — in a production build. It must never become a runtime dependency of
 * anything a user loads.
 *
 * Failure is UNKNOWN, never false: if the other tier is not running, or the
 * fetch is blocked, the honest answer is "cannot tell", and the caller keeps
 * the pill live rather than greying out a destination that may be fine. A
 * control that disables itself because a probe failed is worse than one that
 * occasionally lands on a 404 you can see and read.
 */
export type OtherSideStatus = "serves" | "missing" | "unknown";

export async function probeOtherSide(
	origin: string,
	path: string,
	fetchImpl: typeof fetch = fetch,
): Promise<OtherSideStatus> {
	try {
		const res = await fetchImpl(origin + path, {
			method: "HEAD",
			// The probe must not disturb what it measures: no cookies, and no
			// cached verdict from before the child was swapped.
			credentials: "omit",
			cache: "no-store",
		});
		if (res.status === 404) return "missing";
		if (res.ok) return "serves";
		// A 5xx means the route EXISTS and is broken — a different problem, and
		// not one the pill should hide by greying out. /where 500s on ReTreever
		// today and is still somewhere you may want to go.
		return res.status >= 500 ? "serves" : "unknown";
	} catch {
		// The other tier is not running, or refused the request. Unknowable.
		return "unknown";
	}
}
