/**
 * WHERE DEV INSTRUMENTS DO NOT GO.
 *
 * The tray and the docks are dev furniture, and `import.meta.env.DEV` already
 * keeps them out of every build. This is the second question, the one that
 * only matters in dev: some pages are wrong to put instruments on even while
 * developing them — a wiki page is a page of PROSE about the app, and a rail
 * of readouts over the phone it is describing is noise on the thing being read.
 *
 * IT IS ASKED OF THE URL, not passed as a prop, for the same reason
 * rigOrientation is: a dock is mounted deep inside a child's own page, and
 * that child has no idea whether it is being served on its own or rendered as
 * a poster inside someone else's page. Only the address knows.
 *
 * ReTreever has its own richer list for the TRAY (src/lib/core/ephemeralCard.ts)
 * which also knows about sites and owners. This is the part the shared tree can
 * answer on its own — rapper cannot import from ReTreever — and it is the part
 * a child's dock needs.
 */

/** A URL segment here takes every dev instrument off that page. */
export const NOT_ON = ["wiki", "admin", "contact", "stage"];

export function devChromeShows(url: URL): boolean {
	const segments = new Set(url.pathname.split("/"));
	return !NOT_ON.some((word) => segments.has(word));
}
