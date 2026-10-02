import type { IconName } from "$gc/iconPaths";
import rtLogo from "$rt/assets/ReTreever_logo_sm.webp";
import foundrLogo from "$rt/assets/foundr_logo_sm2.webp";
import GC_LOGO from "$gc/assets/GC_fly_logo_512px.webp";
import GC_TAB from "$gc/assets/favicon.png";

// Route map for the three-tier admin header: tier 1 parents, tier 2 tools inside the active parent, tier 3 the active tool's tables.

/** `tool` (tier 2, gold), `table` (tier 3, rust), `lookup` (tier 4, sage). `view` re-lays-out the same path (`?view=`), so AdminHeader can't light it by pathname like the others. */
export type AdminLinkKind = "tool" | "table" | "lookup" | "view";

export type AdminLink = {
	label: string;
	href: string;
	/** Reads `?site=` — the header appends the focused project to it. */
	scopedToSite?: boolean;
	/** Hover text. Carries the REAL table identifier once `label` is humanised. */
	title?: string;
	/** Defaults to "table" for a tool's `tables` array — see AdminTool. */
	kind?: AdminLinkKind;
	/** `view` links only. `IconName`, not string: a typo fails the build instead of rendering an empty <svg>. */
	icon?: IconName;
};

/** The 🎬 button, tier 1: the operator panel, which lives with the stage on the Get Cache host (AdminHeader resolves it there). */
export type StageTool = {
	key: "getcache";
	/** Alt text only: the logo is the label. */
	label: string;
	logo: string;
	href: string;
	title: string;
};

export const STAGE_TOOLS: StageTool[] = [
	{
		key: "getcache",
		label: "Get Cache",
		logo: GC_LOGO,
		href: "/stage_controls?of=getcache",
		title: "Get Cache controls — drives the phone frame at /stage on the Get Cache host",
	},
];

/** Tier 2: an app you operate, which may own tables (tier 3). `site` rides on the tool because SQLite and Blobs read per-origin browser storage. */
export type AdminTool = {
	key: string;
	label: string;
	href: string;
	/** URL prefix that means "this tool is active". Defaults to `href`. */
	match?: string;
	title?: string;
	/** Host the pages live on; omitted = admin. `getcache` is the app's own deployment — the header resolves hrefs against it. */
	site?: "admin" | "getcache";
	/** An absolute URL on another server, opened in a new tab (the offline preview debugger on :5174). */
	external?: string;
	/** Hide this tool unless running a local dev server. */
	devOnly?: boolean;
	/** Tier 3. Rendered only while this tool is the active one. */
	tables?: AdminLink[];
	/** Rendered on its own line, `tables` shown whenever the parent is active. */
	ownRow?: boolean;
	/** The pages read `?site=`; the header appends the focused project. */
	scopedToSite?: boolean;
};

export type AdminParent = {
	// The header lights a pill by key equality, so the no-parent case must
	// carry a key no parent has.
	key: "retreever" | "getcache" | "foundr" | "none";
	label: string;
	logo: string;
	home: string;
	tools: AdminTool[];
};

// The table vocabulary is declared THREE times, deliberately: the phone
// (getCache, schemaV2.ts), superCrud (a Deno function) and this dashboard
// cannot share a module. A table renamed there is renamed here by hand.

// Central's getCacheMobile tables — superCrud's MIRRORED_TABLES.
export const MIRRORED_TABLES = [
	"mapEntity",
	"featureEntity",
	"surveyEntity",
	"plotEntity",
	"landEntity",
	"cacheEntity",
	"bagUpEntity",
	"tallyEntity",
	"packageEntity",
	"mapTable",
	"featureTable",
	"surveyTable",
	"plotTable",
	"landTable",
	"cacheTable",
	"bagUpTable",
	"tallyTable",
	"packageTable",
	"appStateTable",
	"contactTable",
	"cropTable",
	"offlineCoverageTable",
	"organizationTable",
	"userProfileTable",
] as const;

// Every table on the phone — the mirrored ones plus the local-only ones (eventLogTable, selfIdTable, touchRegister).
export const DEVICE_TABLES = [
	"appStateTable",
	"bagUpEntity",
	"bagUpTable",
	"cacheEntity",
	"cacheTable",
	"contactTable",
	"cropTable",
	"eventLogTable",
	"featureEntity",
	"featureTable",
	"landEntity",
	"landTable",
	"mapEntity",
	"mapTable",
	"offlineCoverageTable",
	"organizationTable",
	"packageEntity",
	"packageTable",
	"plotEntity",
	"plotTable",
	"selfIdTable",
	"surveyEntity",
	"surveyTable",
	"tallyEntity",
	"tallyTable",
	"touchRegister",
	"userProfileTable",
] as const;

// The pill caption IS the SQL identifier, casing included.
const tableLabel = (t: string): string => t;

// Spelled once: pill hrefs, the bare /retreever_dash redirect and sites.ts's host-boundary list must agree.
const RETREEVER_DASH = "/retreever_dash";
const RETREEVER_TOOL = `${RETREEVER_DASH}/tool`;
export const RETREEVER_TABLE = `${RETREEVER_DASH}/table`;
export const RETREEVER_HOME = `${RETREEVER_TOOL}/orgs`;

/** Foundr's namespace. Same shape as ReTreever's, for the same reason. */
export const FOUNDR_DASH = "/foundr_dash";
export const FOUNDR_TOOL = `${FOUNDR_DASH}/tool`;
export const FOUNDR_TABLE = `${FOUNDR_DASH}/table`;
export const FOUNDR_HOME = `${FOUNDR_TOOL}/mlfindr`;
const FOUNDR_REPORT = `${FOUNDR_DASH}/report`;

/** Get Cache's namespace, and where a login that states no destination lands. */
export const GETCACHE_DASH = "/getcache_dash";

/** Carries where the gate interrupted you, across /login and the Google round trip. */
export const NEXT_PARAM = "next";

/**
 * `next` is attacker-supplied. Only a same-site absolute path survives: `//host`
 * and `/\host` are protocol-relative to a browser, and coming back to /login or
 * /logout would loop or sign the user straight back out.
 */
export const safeNext = (raw: string | null | undefined): string | null => {
	if (!raw || raw[0] !== "/") return null;
	if (raw[1] === "/" || raw[1] === "\\") return null;
	if (/[\u0000-\u001f]/.test(raw)) return null;
	const path = raw.split("?")[0];
	return path === "/login" || path === "/logout" ? null : raw;
};

/** The query param that names the focused Foundr project (a Platform key, a–z). */
export const SITE_PARAM = "site";

/** A Foundr site (= a Platform key): exactly one lowercase a–z character. */
export const isSiteChar = (s: string): boolean => /^[a-z]$/.test(s);

/** `href` carrying the focused project, or bare when none is picked. */
export const withSiteParam = (href: string, site: string | null): string =>
	site ? `${href}?${SITE_PARAM}=${site}` : href;

/** The missMeta form, opened on one attribute of the focused project. */
export const foundrMissMetaHref = (site: string, attribute: string): string => {
	const base = withSiteParam(`${FOUNDR_TOOL}/missmeta`, site);
	return `${base}${base.includes("?") ? "&" : "?"}attr=${encodeURIComponent(attribute)}`;
};

/** `?site=` off a URL; anything not a site char reads as "no site picked". */
export const parseSiteParam = (url: URL): string | null => {
	const raw = url.searchParams.get(SITE_PARAM);
	return raw && isSiteChar(raw) ? raw : null;
};

/** One row of the dropdown — a Platform row, shortened. */
export type FoundrProject = {
	id: string;
	name: string;
	/** Null when the row has no URL; the link is then not rendered. */
	url: string | null;
};

/** Per-project reports, each a file in `Foundr/scripts/siteSpecificScripts/{s}/{s}{suffix}`. */
export type FoundrReport = { key: string; label: string; suffix: string };
export const FOUNDR_REPORTS: FoundrReport[] = [
	{ key: "raw", label: "2Raw.json", suffix: "2Raw.json" },
	{ key: "jsonpaths", label: "2jsonPaths", suffix: "2JSONPath.ts" },
];

export const foundrReportPath = (key: string): string =>
	`${FOUNDR_REPORT}/${key}`;
export const foundrReportHref = (key: string, site: string | null): string =>
	withSiteParam(foundrReportPath(key), site);

/** Every ReTreever (Prisma) model, labelled with the real SQL table name (no model has `@@map`). Declared by hand — a shape heuristic mislabels the core tables. */
const RETREEVER_ENTITIES = [
	"OrganizationTable",
	"ProjectTable",
	"ClaimTable",
	"StakeholderTable",
	"PlatformTable",
	"LandTable",
	"CropTable",
	"PlantingTable",
	"SpeciesTable",
	"PolygonTable",
	"SurveyTable",
	"SourceTable",
	"MiscTable",
	"ProjectScoreByFieldTable",
	"LinkCandidateTable",
	"UserProfile",
] as const;

/** Fixed vocabularies another table points at. Exported so the table viewer can tell a lookup from an entity. */
/** The entities whose viewer narrows to one Foundr site — ReTreever's retreeverTables.ts `platformScope`, pinned equal by adminRoutes.test.ts. */
export const PLATFORM_SCOPED: ReadonlySet<string> = new Set([
	"OrganizationTable",
	"ProjectTable",
	"ClaimTable",
	"StakeholderTable",
	"PlatformTable",
	"LandTable",
	"CropTable",
	"PlantingTable",
	"PolygonTable",
	"SurveyTable",
	"SourceTable",
	"MiscTable",
	"ProjectScoreByFieldTable",
]);

export const RETREEVER_LOOKUPS = [
	"RestorationTypeTable",
	"TreatmentTypeTable",
	"StakeholderCategoryTable",
	"ScoreMatrixTable",
	"GlobalDefaultsTable",
] as const;

const retreeverTablePills = (base: string): AdminLink[] => [
	...RETREEVER_ENTITIES.map((t) => ({
		label: t,
		href: `${base}/${t.toLowerCase()}`,
		title: `${t} — Prisma model (SQL table name)`,
		kind: "table" as const,
		// Only under Foundr does the viewer read the project.
		scopedToSite:
			base === FOUNDR_TABLE && PLATFORM_SCOPED.has(t),
	})),
	...RETREEVER_LOOKUPS.map((t) => ({
		label: t,
		href: `${base}/${t.toLowerCase()}`,
		title: `${t} — reference table (fixed vocabulary)`,
		kind: "lookup" as const,
	})),
];

const mirroredTablePills = (base: string): AdminLink[] =>
	MIRRORED_TABLES.map((t) => ({
		label: tableLabel(t),
		href: `${base}/${t}`,
		title: t,
		kind: "table" as const,
	}));

const deviceTablePills = (base: string): AdminLink[] =>
	DEVICE_TABLES.map((t) => ({
		label: tableLabel(t),
		href: `${base}/${t}`,
		title: t,
		kind: "table" as const,
	}));

export const ADMIN_PARENTS: AdminParent[] = [
	{
		key: "retreever",
		label: "ReTreever",
		logo: rtLogo,
		home: RETREEVER_HOME,
		tools: [
			// `match` is the table prefix: there is no /tool/supabase screen,
			// the CRUD row IS the tool.
			{
				key: "supabase",
				label: "Supabase",
				href: `${RETREEVER_TABLE}/${RETREEVER_ENTITIES[0].toLowerCase()}`,
				match: RETREEVER_TABLE,
				title: "The ReTreever (Prisma) database — every table, raw",
				tables: retreeverTablePills(RETREEVER_TABLE),
			},
			{
				key: "orgs",
				label: "Orgs",
				href: `${RETREEVER_TOOL}/orgs`,
				title: "Parents and unlinked children in one alphabetical list",
			},
			{
				key: "platforms",
				label: "Platforms",
				href: `${RETREEVER_TOOL}/platforms`,
			},
			{ key: "claims", label: "Claims", href: `${RETREEVER_TOOL}/claims` },
			{
				key: "stakeholders",
				label: "Stakeholders",
				href: `${RETREEVER_TOOL}/stakeholders`,
			},
			{
				key: "users",
				label: "Users",
				href: `${RETREEVER_TOOL}/users`,
				title:
					"The admin allowlist — who can sign in, and where it is declared",
			},
		],
	},
	{
		key: "getcache",
		label: "Get Cache",
		logo: GC_LOGO,
		home: "/getcache_dash",
		// Named for where the rows are read from: Supabase is a server query,
		// the other two read per-origin browser storage.
		tools: [
			{
				key: "supabase",
				label: "Supabase",
				href: "/getcache_dash",
				match: "/getcache_dash",
				title: "Get Cache in the cloud — Supabase, every user, a server query",
				tables: [
					// Cloud-only screens, not tables: head of the CRUD row rather
					// than four tools out of one.
					{ label: "Snapshots", href: "/getcache_dash", kind: "tool" },
					{
						label: "Users",
						href: "/getcache_dash/userTable",
						kind: "tool",
					},
					{
						label: "Analytics",
						href: "/getcache_dash/analytics",
						kind: "tool",
					},
					// superCrud load attempts, not "what has each user backed up".
					{
						label: "ETL Runs",
						href: "/getcache_dash/snapshots",
						kind: "tool",
					},
					...mirroredTablePills("/getcache_dash/table"),
				],
			},
			{
				key: "blobs",
				label: "Blobs",
				// On admin.localhost this opens admin's own empty jar; `site`
				// sends the pill to getcache.
				site: "getcache",
				href: "/app/debug/blobs",
				match: "/app/debug/blobs",
				title: "Baked map tiles and binary blobs in this origin's IndexedDB",
				// Views ride in `?view=` so switching never re-mounts the
				// inspector; bare /app/debug/blobs is Cards, the component default.
				tables: [
					{ label: "Report", href: "/app/debug/blobs", kind: "tool" },
					{
						label: "Table",
						href: "/app/debug/blobs?view=table",
						kind: "view",
						icon: "table",
						title: "Every area as one flat, sortable row",
					},
					{
						label: "Cards",
						href: "/app/debug/blobs?view=cards",
						kind: "view",
						icon: "cards",
						title: "One card per pin — drill into a single area",
					},
					{
						label: "Gallery",
						href: "/app/debug/blobs?view=gallery",
						kind: "view",
						icon: "image",
						title: "See the baked satellite photos themselves",
					},
				],
			},
			{
				key: "sqlite",
				label: "SQLite",
				// OPFS is per origin: on admin every table reads "No rows".
				site: "getcache",
				href: "/app/sqlite/cacheTable",
				match: "/app/sqlite",
				title: "This browser's live Get Cache database — every table",
				tables: deviceTablePills("/app/sqlite"),
			},
			{
				key: "file",
				label: "File",
				// Admin-hosted: a dropped file has no origin to live with.
				href: "/getcache_dash/file",
				title: "A Get Cache .sqlite3 dropped here — every table, opened in this browser",
				tables: deviceTablePills("/getcache_dash/file"),
			},
		],
	},
	{
		key: "foundr",
		label: "Foundr",
		logo: foundrLogo,
		home: FOUNDR_HOME,
		tools: [
			// Not `scopedToSite`: draws the whole corpus with no project picked,
			// narrows if one is.
			{
				key: "schema",
				label: "schema",
				href: `${FOUNDR_TOOL}/schema`,
				title:
					"Every table and column, coloured by how much of it is actually populated",
			},
			{
				key: "overview",
				label: "overview",
				href: `${FOUNDR_TOOL}/overview`,
				title:
					"Corpus-wide: how much of every site's raw scrape has a home in the schema",
			},
			{
				key: "missmap",
				scopedToSite: true,
				label: "missMap",
				href: `${FOUNDR_TOOL}/missmap`,
				title: "The focused site's missMeta — what is left, and a run button",
			},
			// A tool, not a report: the form that writes `{s}3MissMeta.json`.
			{
				key: "missmeta",
				scopedToSite: true,
				label: "missMeta",
				href: `${FOUNDR_TOOL}/missmeta`,
				title:
					"The focused site's mapping decisions — the form that writes {s}3MissMeta.json",
			},
			{
				key: "mlfindr",
				scopedToSite: true,
				label: "MLFindr",
				href: `${FOUNDR_TOOL}/mlfindr`,
				title: "Foundr's ranked candidate worklist — reads Foundr/mlFindr/data",
			},
			// Chris's benchmark: a person against mlFindr and Jev on decided paths.
			{
				key: "bench",
				label: "benchmark",
				href: `${FOUNDR_TOOL}/bench`,
				title:
					"Name the column for decided paths, a minute each, then see how you did against mlFindr and Jev",
			},
			{
				key: "orchestrator",
				scopedToSite: true,
				label: "orchestrator",
				href: `${FOUNDR_TOOL}/orchestrator`,
				title:
					"Launch Foundr's ETL pipeline and watch its output — local dev only",
			},
			{
				key: "progress",
				label: "progress",
				href: `${FOUNDR_TOOL}/progress`,
				title:
					"What each platform has yielded so far, against what its index says is there",
			},
			// The same screen as ReTreever's Platforms pill; the project dropdown
			// reads this table.
			{
				key: "platforms",
				label: "Platforms",
				href: `${FOUNDR_TOOL}/platforms`,
				title:
					"The platform table — Foundr's scrape targets, one row per platform",
			},
			{
				key: "orgs",
				label: "Orgs",
				href: `${FOUNDR_TOOL}/orgs`,
				title: "Parents and unlinked children in one alphabetical list",
			},
			// The same database from this side; `ownRow` so the tables show on
			// every Foundr screen.
			{
				key: "supabase",
				label: "Supabase",
				href: `${FOUNDR_TABLE}/${RETREEVER_ENTITIES[0].toLowerCase()}`,
				match: FOUNDR_TABLE,
				title: "The ReTreever (Prisma) database — every table, raw",
				ownRow: true,
				tables: retreeverTablePills(FOUNDR_TABLE),
			},
		],
	},
];

/** Login and unknown paths: no tools, so tiers 2/3 render empty and no pill lights. */
const NO_PARENT: AdminParent = {
	key: "none",
	label: "",
	logo: "",
	home: RETREEVER_HOME,
	tools: [],
};

/** The prefix a tool is matched on — `match` when given, else its href. */
const matchOf = (t: AdminTool): string => t.match ?? t.href;

/** Which parent pill lights up. Fall-through is NO_PARENT: the wrong pill lit is worse than none. */
export function activeParent(pathname: string): AdminParent {
	for (const parent of ADMIN_PARENTS) {
		for (const tool of parent.tools) {
			if (pathname.startsWith(matchOf(tool))) return parent;
		}
	}
	// The bare dash addresses redirect, but the header renders BEFORE the
	// redirect lands — without these the pill blinks off for one paint.
	if (pathname.startsWith(RETREEVER_DASH)) return ADMIN_PARENTS[0];
	if (pathname.startsWith("/getcache_dash")) return ADMIN_PARENTS[1];
	if (pathname.startsWith(FOUNDR_DASH)) return ADMIN_PARENTS[2];
	return NO_PARENT;
}

/** The admin tab icon follows the lit pill; Get Cache's is its G¢ app icon, not the pill's dragonfly logo. "" with none lit. */
export function adminTabIcon(pathname: string): string {
	const parent = activeParent(pathname);
	return parent.key === "getcache" ? GC_TAB : parent.logo;
}

/** The longest matching prefix, not the first: `/getcache_dash` is a prefix of every Get Cache page. Null when no tool owns the path. */
export function activeTool(pathname: string): AdminTool | null {
	let best: AdminTool | null = null;
	for (const parent of ADMIN_PARENTS) {
		for (const tool of parent.tools) {
			const m = matchOf(tool);
			if (!pathname.startsWith(m)) continue;
			if (!best || m.length > matchOf(best).length) best = tool;
		}
	}
	return best;
}

/** The active tool's tables; none renders no third row. */
export function activeTables(pathname: string): AdminLink[] {
	return activeTool(pathname)?.tables ?? [];
}
