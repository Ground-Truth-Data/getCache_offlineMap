/**
 * WHICH WAY UP THE PHONE IS, FOR A GIVEN ROUTE — asked once, answered here.
 *
 * Three separate layouts mount <PhoneRig> (ReTreever's (getcache) layout,
 * rapper's (gc) layout, and each child's standalone layout), and the page that
 * wants the turn is a DESCENDANT of whichever one is running, so it cannot
 * pass a prop up. Left to the layouts, the same route would be listed three
 * times and drift the first time one of them was edited — which is exactly how
 * the debug-route frame rule already reads in ReTreever.
 *
 * A route is listed because its CONTENT is wide, not because of anything about
 * the tier serving it, so the answer is a property of the path and belongs in
 * one table that every mount consults.
 */

/**
 * Routes that read better with the phone turned a quarter turn.
 *
 * /app/georef puts a PDF sheet and the satellite side by side and asks you to
 * match points between them. Stacked in a portrait frame they are each half a
 * phone wide, which is smaller than the features being matched.
 */
const LANDSCAPE_ROUTES = new Set(["/app/georef", "/georef"]);

/**
 * Both spellings of every route are listed: a child served standalone mounts
 * its pages at the bare path, and the same page mounted by a tier gains the
 * /app prefix. One table, so a route cannot be landscape in one tier and
 * portrait in another.
 */
export function isLandscapeRoute(pathname: string): boolean {
	return LANDSCAPE_ROUTES.has(normalise(pathname));
}

/**
 * Routes that take the whole screen, with no bars over or under them.
 *
 * The bars are navigation, and a route here is one where the content needs the
 * height more than the page needs a way out: /app/georef fits a sheet and the
 * satellite side by side into a landscape phone, where the two bands together
 * are a third of the screen.
 *
 * This is the STAND-IN's answer as much as the tier's — HostChrome reserves
 * exactly what the mounting tier will draw, so a route that gets no bar
 * mounted must reserve none standalone either, or the child is laid out
 * against a height it will not get.
 */
const NO_CHROME_ROUTES = new Set(["/app/georef", "/georef"]);

export function hasTopBar(pathname: string): boolean {
	return !NO_CHROME_ROUTES.has(normalise(pathname));
}

export function hasBottomBar(pathname: string): boolean {
	return !NO_CHROME_ROUTES.has(normalise(pathname));
}

const normalise = (pathname: string) => pathname.replace(/\/+$/, "") || "/";
