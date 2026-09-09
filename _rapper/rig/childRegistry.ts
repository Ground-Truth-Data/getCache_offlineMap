/**
 * childRegistry.ts — EVERY CHILD, ONE RECORD EACH. The lookup table.
 *
 * Which repo backs a view is a fact about the pathname, only known per
 * request, so it lives in one table keyed by path and every consumer looks it
 * up instead of writing a name down. EDIT THIS FILE when a child is added,
 * renamed, or starts serving a new path — it is the one place.
 *
 * Names no tier, host, port or parent repo (noParentNames.test.ts) — the
 * parent's identity stays in the parent's config, so this file can be read by
 * either tier verbatim.
 */

/** One child repo, and everything anyone needs to know about it. */
export type ChildRecord = {
	/** The repo name, exactly as it appears on GitHub. Also the display label. */
	repo: string;
	/** The GitHub org that owns it. */
	org: string;
	/** Short human name for the bar. */
	name: string;
	/** The product this child belongs to — the bar's title beside the logo. */
	owner: string;
	/** Logo filename inside sharedAssets/ — a NAME, not a path, so the importer
	 *  resolves it against whichever parent is mounting. */
	logo: string;
	/** Tab-icon filename, resolved like `logo`. Only when the product has an
	 *  app icon distinct from its wordmark; absent means the logo is the icon. */
	icon?: string;
	/** Every pathname this child serves, longest-prefix matched. Mirrors the
	 *  child's routes/ folder — childRegistry.test.ts checks the two agree. */
	paths: string[];
	/** TRUE for a MOUNTING TIER rather than a mounted child. A tier belongs in
	 *  the lookup (the bar links to it like any repo) but is excluded from
	 *  every path-driven answer: whatever it serves came from the child it
	 *  mounted, and that child has its own row. Hence no `paths` either. */
	tier?: boolean;
	/**
	 * Served under APP_PREFIX by every parent (`/app/offlinev10`). `paths` still
	 * spell the child's own routes/ folder, which is flat — mountPath() joins them.
	 */
	app?: true;
	/** Where this child STARTS when mounted alone. Declared, never inferred —
	 *  which view an app opens on is a product decision, not path order.
	 *  Read by the child's "/" reroute hook, the nav logo link, and the url
	 *  the dev server prints. Absent on a tier. */
	defaultPath?: string;
	/** Paths the child serves that NO parent mirrors — its standalone preview.
	 *  Listed so a lookup still identifies the child, excluded from the tier
	 *  table so the pill never points at a parent 404. */
	soloPaths?: string[];
	/** THE NAV BUTTONS — this child's own views, named. `paths` says WHAT is
	 *  served; this says what to CALL each one and which deserve a button.
	 *  Keyed by child, resolved by which child owns the live pathname, so the
	 *  bar shows the buttons of the thing actually on screen. */
	views?: NavView[];
};

/** One button in the bar: where it goes, and what it says. */
export type NavView = {
	/** Pathname on the mounting tier. Must be one this child really serves —
	 *  navViews.test.ts checks each against `paths`. */
	href: string;
	/** The button text. Lowercase, terse: this is dev chrome, not product UI. */
	label: string;
};

/** Where every tier mounts the Get Cache app — one prefix, every environment. */
export const APP_PREFIX = "/app";

export const CHILDREN: ChildRecord[] = [
	{
		// The two TIERS first — they MOUNT the children below them.
		repo: "rapper",
		org: "Ground-Truth-Data",
		name: "rapper",
		owner: "rapper",
		logo: "rapper.webp",
		paths: [],
		tier: true,
	},
	{
		repo: "ReTreever",
		org: "Ground-Truth-Data",
		name: "ReTreever",
		owner: "ReTreever",
		logo: "ReTreever_logo_sm.webp",
		paths: [],
		tier: true,
	},
	{
		repo: "ReTreever_who_what",
		org: "Ground-Truth-Data",
		name: "who_what",
		owner: "ReTreever",
		logo: "ReTreever_logo_sm.webp",
		paths: ["/", "/who", "/what"],
		defaultPath: "/who",
		// "/" is this child's own landing url when mounted alone — hooks.ts
		// reroutes it to /who; solo so no parent is offered its own homepage.
		soloPaths: ["/"],
		views: [
			{ href: "/who", label: "who" },
			{ href: "/what", label: "what" },
		],
	},
	{
		repo: "getCache_OfflineMap",
		app: true,
		org: "Ground-Truth-Data",
		name: "offline map",
		owner: "Get Cache",
		logo: "GC_fly_logo_transparent.webp",
		icon: "favicon.png",
		paths: ["/", "/offlinev10", "/georef"],
		defaultPath: "/offlinev10",
		soloPaths: ["/"],
		// No nav views: every control this map has lives ON the map itself.
		views: [],
	},
	{
		repo: "getCache_OnlineMap",
		app: true,
		org: "Ground-Truth-Data",
		name: "online map",
		owner: "Get Cache",
		logo: "GC_fly_logo_transparent.webp",
		icon: "favicon.png",
		paths: ["/", "/map", "/demo"],
		defaultPath: "/map",
		soloPaths: ["/", "/demo"],
		// No nav views, same rule as the offline map.
		views: [],
	},
	{
		repo: "ReTreever_where",
		org: "Ground-Truth-Data",
		name: "where",
		owner: "ReTreever",
		logo: "ReTreever_logo_sm.webp",
		// /where/orgs and /where/projects come from ONE dynamic route
		// ([view=whereView]) — childRegistry.test.ts allows them by name.
		paths: ["/", "/where", "/where/orgs", "/where/projects"],
		defaultPath: "/where",
		soloPaths: ["/"],
		views: [
			{ href: "/where", label: "where" },
			{ href: "/where/orgs", label: "orgs" },
			{ href: "/where/projects", label: "projects" },
		],
	},
];

/**
 * The child serving this pathname, longest-prefix so /offlinev10/debug beats
 * /offlinev10. Undefined for a path no child claims — a parent's own page.
 */
export function childForPath(pathname: string): ChildRecord | undefined {
	// `paths` mirror the child's own routes/ folder, which is flat; both tiers
	// MOUNT the Get Cache children under /app. Strip the mount, keep the truth.
	if (pathname === APP_PREFIX || pathname.startsWith(APP_PREFIX + "/")) {
		pathname = pathname.slice(APP_PREFIX.length) || "/";
	}
	let best: ChildRecord | undefined;
	let bestLen = -1;
	for (const c of CHILDREN) {
		// A tier MOUNTS routes, it does not serve them — see ChildRecord.tier.
		if (c.tier) continue;
		for (const p of c.paths) {
			const hit = pathname === p || pathname.startsWith(p + "/");
			if (hit && p.length > bestLen) {
				best = c;
				bestLen = p.length;
			}
		}
	}
	return best;
}

/** Where a parent actually serves one of a child's paths: `/app/offlinev10` for a Get Cache child, `/who` for a ReTreever one. */
export function mountPath(child: ChildRecord, path: string = child.defaultPath ?? "/"): string {
	if (!child.app) return path;
	return path === "/" ? APP_PREFIX : APP_PREFIX + path;
}

/** A child by repo name, for the cases that genuinely know which one. */
export function childByRepo(repo: string): ChildRecord | undefined {
	return CHILDREN.find((c) => c.repo === repo);
}

/** The GitHub URL for a repo — built, never written down. */
export function githubUrl(child: ChildRecord): string {
	return `https://github.com/${child.org}/${child.repo}`;
}

/** The one tier that IS an npm package (`@retreever/create-rapper`). */
const PACKAGE_TIER = "rapper";

/**
 * THE SCAFFOLD COMMAND FOR ONE CHILD — built, never written down.
 *
 * The flag is the repo name, verbatim. create.mjs matches it against the
 * child folder names case- and separator-insensitively, exact match first, so
 * the full name always resolves and can never collide with a sibling; a
 * shorter unique fragment still works typed by hand. createCommand.test.ts
 * (ReTreever) re-runs create.mjs's matcher over every printed flag.
 *
 * Flag order is load-bearing: `--min-release-age=0` is npm's and must sit
 * BEFORE the package name — after it, `npm create` ignores the flag and the
 * 7-day guard hides a just-published version from its own scaffold
 * (ENOVERSIONS); the child flag sits AFTER the `--` or npm eats it and the
 * scaffold falls back to the interactive picker.
 *
 * rapper gets the bare command (it IS the package; no flag → the picker,
 * which is right when no child was named). ReTreever returns null — it
 * publishes no package.
 */
export function createCommand(child: ChildRecord, dir = "rapper"): string | null {
	if (child.repo === PACKAGE_TIER) {
		return `npm create --min-release-age=0 @retreever/rapper@latest ${dir}`;
	}
	if (child.tier) return null;
	return `npm create --min-release-age=0 @retreever/rapper@latest ${dir} -- --${child.repo}`;
}

/** Every child that can be scaffolded, in table order — the menu. */
export function installableChildren(): ChildRecord[] {
	return CHILDREN.filter((c) => !c.tier);
}
