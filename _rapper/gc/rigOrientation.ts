/**
 * Which way up the phone is for a route, in one table every mount consults:
 * three layouts mount <PhoneRig> and the page wanting the turn is a descendant
 * of whichever is running. Both spellings are listed — bare when a child is
 * served standalone, /app-prefixed when a tier mounts it.
 */

const LANDSCAPE_ROUTES = new Set(["/app/georef", "/georef"]);

export function isLandscapeRoute(url: RouteInput): boolean {
	return LANDSCAPE_ROUTES.has(normalise(pathOf(url)));
}

// Routes with no bars over or under them. HostChrome reserves exactly what the
// mounting tier draws, so a route that gets no bar must reserve none standalone.
const NO_CHROME_ROUTES = new Set(["/app/georef", "/georef"]);

export function hasTopBar(url: RouteInput): boolean {
	return hasChrome(url);
}

export function hasBottomBar(url: RouteInput): boolean {
	return hasChrome(url);
}

// The app embedded inside itself draws a second set of bars unless told; the
// URL is the only signal that crosses into an embedded document.
export const EMBED_PARAM = "embed";

export type RouteInput = string | URL;

export const isEmbedded = (url: RouteInput): boolean =>
	typeof url !== "string" && url.searchParams.get(EMBED_PARAM) === "1";

const pathOf = (url: RouteInput) =>
	typeof url === "string" ? url : url.pathname;

const hasChrome = (url: RouteInput) =>
	!isEmbedded(url) && !NO_CHROME_ROUTES.has(normalise(pathOf(url)));

const normalise = (pathname: string) => pathname.replace(/\/+$/, "") || "/";
