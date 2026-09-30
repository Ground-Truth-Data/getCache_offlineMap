// Two sites share one server; this is the only place that says which is which. `pages` are public URLs (the sitemap); `app` is served but never advertised.

import rtLogo from "$rt/assets/ReTreever_logo_sm.webp";

export type SiteId = "retreever" | "admin";

/** A schema.org node, emitted verbatim as JSON-LD by <SiteMeta>. Only confirmed facts go in. */
export type SchemaNode = Record<string, unknown>;

export type SiteSeo = {
	/** Absolute origin, no trailing slash. og:image is fetched with no page context, so image paths are prefixed with this. */
	origin: string;
	description: string;
	/** 1200x630 PNG/JPG under static/, background baked in — WhatsApp will not render WebP and composites transparency onto white. */
	ogImage: string;
	tagline: string;
	/** Keep this site out of search results and link previews. */
	noindex?: true;
	/** Structured data. Google penalises data that disagrees with the page, so an unconfirmed field is left out, never guessed. */
	schema?: SchemaNode;
};

export type Site = {
	id: SiteId;
	/** What a human calls it — 404 messages and menus. */
	label: string;
	/** Lowercase, matched exactly. */
	hosts: readonly string[];
	/** The dev hostname to suggest when someone lands on the wrong address. */
	devHost: string;
	/** The favicon. On admin, `adminTabIcon` overrides it by the lit pill, since one admin host shows three products. */
	icon: string;
	home: string;
	pages: readonly string[];
	app: readonly string[];
	/** pages + app. Derived, never written. */
	owns: readonly string[];
	seo: SiteSeo;
};

// `/` is settled by `home`, so it is not a claim.
const site = (s: Omit<Site, "owns">): Site => ({
	...s,
	owns: [...s.pages.filter((p) => p !== "/"), ...s.app],
});

const RETREEVER_ORIGIN = "https://retreever.org";
const GETCACHE_ORIGIN = "https://getcache.org";

// TO FILL IN — omitted until confirmed:
//   sameAs        LinkedIn / X / GitHub / YouTube URLs. The strongest knowledge-panel signal.
//   foundingDate  "YYYY" or "YYYY-MM-DD".
//   legalName     only if the registered name differs from "ReTreever".

export const SITES: readonly Site[] = [
	site({
		id: "retreever",
		label: "ReTreever",
		hosts: ["retreever.org", "www.retreever.org", "retreever.localhost"],
		devHost: "retreever.localhost",
		icon: rtLogo,
		home: "/",

		pages: ["/", "/why", "/where", "/retreeve", "/legal"], // /who, /what are [param] routes with no single URL
		app: ["/who", "/what"],

		seo: {
			origin: RETREEVER_ORIGIN,
			description:
				"ReTreever builds tools that record reforestation work where it happens — from the planting block to the invoice. Makers of Get Cache, the offline field app for tree planters.",
			ogImage: "/og/retreever-og.png",
			tagline: "Every tree, accounted for.",
			schema: {
				"@context": "https://schema.org",
				"@type": "Organization",
				"@id": `${RETREEVER_ORIGIN}/#organization`,
				name: "ReTreever",
				url: RETREEVER_ORIGIN,
				logo: `${RETREEVER_ORIGIN}/og/retreever-og.png`,
				description:
					"ReTreever builds software for the reforestation industry: field data capture, planting records and reporting, from the block to the invoice.",
				knowsAbout: [
					"Reforestation",
					"Tree planting",
					"Silviculture",
					"Forestry data collection",
					"Offline-first field software",
				],
				// The app's own card lives on getcache.org; the same @id there links the two domains into one operation.
				brand: {
					"@type": "MobileApplication",
					"@id": `${GETCACHE_ORIGIN}/#app`,
					name: "Get Cache",
					url: GETCACHE_ORIGIN,
				},
			},
		},
	}),

	site({
		id: "admin",
		label: "Admin",
		// Bare `localhost` is deliberately absent: a site is a name, and localhost is the absence of one.
		hosts: ["admin.retreever.org", "admin.localhost"],
		devHost: "admin.localhost",
		icon: rtLogo,
		home: "/login",

		pages: [],
		// Nothing in these paths says "admin", so the hostname is the only lock.
		app: [
			"/login",
			"/logout",
			"/retreever_dash",
			"/getcache_dash",
			"/foundr_dash",
			"/docs", // lowercase so it stays off urlCase's exemption list
		],

		seo: {
			origin: "https://admin.retreever.org",
			description: "Internal dashboard.",
			ogImage: "",
			tagline: "",
			noindex: true,
		},
	}),
];

// Paths every site serves — the plumbing a page needs, not pages. Blocking one breaks the allowed one: 404 `/_app` and every page renders as unstyled HTML.
const SHARED_PATHS: readonly string[] = [
	"/_app",
	"/api",
	"/js",
	"/pub-Rtvr",
	"/homeAssets",
];

const onSegmentBoundary = (pathname: string, prefix: string): boolean =>
	pathname === prefix || pathname.startsWith(`${prefix}/`);

const matchesAny = (pathname: string, prefixes: readonly string[]): boolean =>
	prefixes.some((p) => onSegmentBoundary(pathname, p));

/** A LAN IP or a tunnel: a phone on the network has no second name to be sent to, so it is never refused. */
export const isTunnelOrDevice = (hostname: string): boolean =>
	/^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
	hostname.endsWith(".ngrok-free.app") ||
	hostname.endsWith(".ngrok.io") ||
	hostname.endsWith(".trycloudflare.com") ||
	hostname === "dev.retreever.org";

export const siteOf = (hostname: string): Site | null => {
	const h = hostname.toLowerCase();
	return SITES.find((s) => s.hosts.includes(h)) ?? null;
};

export const ownerOf = (pathname: string): Site | null => {
	if (matchesAny(pathname, SHARED_PATHS)) return null;
	return SITES.find((s) => matchesAny(pathname, s.owns)) ?? null;
};

export const isSharedPath = (pathname: string): boolean =>
	matchesAny(pathname, SHARED_PATHS) || /\.[a-z0-9]+$/i.test(pathname);

/** An absolute URL on another site — a bare href resolves against the current
 * host. Dev vs prod is read off the current hostname. */
export const urlOnSite = (
	id: SiteId,
	pathname: string,
	current: URL,
): string => {
	if (isTunnelOrDevice(current.hostname)) return pathname;

	const site = SITES.find((s) => s.id === id);
	if (!site) return pathname;

	const isDev = current.hostname.endsWith(".localhost");
	const host = isDev ? site.devHost : site.hosts[0];
	const port = isDev && current.port ? `:${current.port}` : "";
	return `${current.protocol}//${host}${port}${pathname}`;
};

/** Get Cache is its own deployment (`fetch/getCache`), never served here; admin links across to it. Its dev server holds :5173. */
export const getcacheUrl = (pathname: string, current: URL): string =>
	current.hostname.endsWith(".localhost")
		? `http://getcache.localhost:5173${pathname}`
		: `${GETCACHE_ORIGIN}${pathname}`;

export const mayServe = (hostname: string, pathname: string): boolean => {
	if (isTunnelOrDevice(hostname)) return true;

	const site = siteOf(hostname);
	if (!site) return false;

	if (pathname === "/" || pathname === "" || isSharedPath(pathname)) return true;
	const owner = ownerOf(pathname);
	return !owner || owner.id === site.id;
};

// A 404 that names hosts or the owning site maps the server for whoever knocks.
export const wrongSiteMessage = (): string => "Not found\n";

// Self-contained — inline CSS, no scripts — a host serving nothing cannot be trusted to serve this page's assets.
export const wrongSitePage = (): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Page not found</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#1a1a1a; color:#e8e8e8; padding:2rem;
         font:16px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif }
  .card { text-align:center }
  .code { font-size:4rem; font-weight:700; letter-spacing:-.02em; margin:0;
          color:#6b6b6b }
  h1 { font-size:1.5rem; font-weight:600; margin:.25rem 0 0 }
</style></head>
<body><div class="card">
  <p class="code">404</p>
  <h1>Page not found</h1>
</div></body></html>`;
