/**
 * Pages wrong for dev instruments even in dev — a wiki page is prose about the
 * app. Asked of the URL, not a prop: a dock deep in a child's page cannot know
 * whether it is served alone or rendered inside another page.
 */

/** A URL segment here takes every dev instrument off that page. */
export const NOT_ON = ["wiki", "admin", "contact", "stage"];

export function devChromeShows(url: URL): boolean {
	const segments = new Set(url.pathname.split("/"));
	return !NOT_ON.some((word) => segments.has(word));
}
