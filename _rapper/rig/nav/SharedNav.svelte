<script lang="ts">
/**
 * THE SHARED NAV — rapper's shell, as a component the child's layout renders.
 *
 
/**
 * THE ROUTE MAP — how the live URL becomes the other tier's URL.
 *
 * The pill used to take a fixed `otherPath`, so it always landed on the same
 * page no matter where you were. See ./tierRoutes.ts for why a build-time
 * constant could never carry that fact.
 */
import {
	TIER_HOME,
	currentRepo,
	otherTierOrigin,
	otherTierPath,
	probeOtherSide,
	servesOtherSide,
	type OtherSideStatus,
} from "./tierRoutes";
import type { TierRoute } from "./tierRoutes";
/**
 * THE REGISTRY — which child backs the page you are on, looked up by path.
 *
 * The bar used to take `repo` as a prop, written into the mounted child's
 * +layout.svelte. That layout is `kit.files.routes`, so it wraps EVERY page
 * the parent serves: on /offline the bar read "ReTreever_who_what" because
 * who_what's layout was the one loaded. The label named the INSTALL, not the
 * page. A lookup by pathname is the only thing that can be right for both.
 */
import { childByRepo, childForPath, githubUrl, mountPath } from "$rig/childRegistry";

type View = { href: string; label: string; missing?: boolean };

let {
	owner,
	name,
	logo,
	repo,
	routes = [],
	views = [],
	ghIcon,
	pathname = "",
	search = "",
	tier,
	otherTier,
	tierSlot,
	otherHost,
	otherHome,
	selfRepo = "rapper",
}: {
	owner: string;
	name: string;
	logo: string;
	/** Fallback repo for the second GitHub link, used when the live route has
	 *  no child behind it in `routes`. Per-VIEW resolution wins when it can. */
	repo: string;
	views?: View[];
	ghIcon: string;
	/** The pill's four facts, passed straight through. This bar does not know
	 *  which tier it is either — see ParentPill for why a child may not guess. */
	tier: string;
	otherTier: string;
	/** Which half this tier occupies — fixed, so the pill never reorders. */
	tierSlot?: "left" | "right";
	otherHost?: string;
	/** Where the OTHER tier's pill drops you when this page has no counterpart
	 *  there. Told, not assumed: "/" is where a server answers, not where its
	 *  work is. ReTreever answers "/" with a marketing homepage and serves its
	 *  search at /who, so an unmapped route used to land on the landing page.
	 *  Omitted → TIER_HOME, the old behaviour. */
	otherHome?: string;
	/** THIS TIER'S ROUTE TABLE — passed in, never written here. Each parent
	 *  declares the routes IT serves and where they land on the other tier;
	 *  this component names no tier, so it cannot know. Empty (a child cloned
	 *  alone) → every path falls back to home, which is the honest answer. */
	routes?: TierRoute[];
	/** The repo of the tier doing the mounting, for the first GitHub link.
	 *  Told, not assumed: "rapper" was hardcoded here, which named a parent. */
	selfRepo?: string;
	/** The live pathname, so a view can render as the current one. Passed in
	 *  rather than read from $app/state here: this component is also mounted
	 *  by a parent that may not be SvelteKit, and importing $app/state would
	 *  make it refuse to build there. */
	pathname?: string;
	/**
	 * THE QUERY STRING, CARRIED ACROSS THE TIER SWITCH.
	 *
	 * The pill's whole promise is "this page, other server". A url is
	 * (origin, path, query) — resolving only the first two dropped the third,
	 * so switching tiers while looking at ?at=53.9171,-122.7497 landed you on
	 * the other tier's DEFAULT view of the map. Same failure class as the
	 * origin bug above: half the url resolved, half discarded, and the result
	 * looked like the switch had simply ignored you.
	 *
	 * Passed in for the same reason `pathname` is — this component may be
	 * mounted by a parent that is not SvelteKit, so it cannot read $app/state.
	 * Include the leading "?"; empty means no query, which is the common case.
	 */
	search?: string;
} = $props();

const dev = import.meta.env.DEV;

// The pill's halves in FIXED order, derived from this tier's own slot. The
// shared component renders left/right exactly as given, so both parents must
// agree — and they do, because each knows only where IT sits.
const leftTier = $derived(tierSlot === "left" ? tier : otherTier);
const rightTier = $derived(tierSlot === "left" ? otherTier : tier);


const otherPath = $derived(otherTierPath(pathname, routes, otherHome));


function viewUrl(href: string): string {
	const [path, own = ""] = href.split("?");
	const merged = new URLSearchParams(search);
	for (const [k, v] of new URLSearchParams(own)) merged.set(k, v);
	const q = merged.toString();
	return q ? `${path}?${q}` : path;
}

/** Which view is CURRENT — path AND the view's own params must both match. */
function isCurrentView(href: string): boolean {
	const [path, own = ""] = href.split("?");
	if (path !== pathname) return false;
	const live = new URLSearchParams(search);
	const ownParams = new URLSearchParams(own);
	// A view with no params of its own is current only when NO other view's
	// param is set — so "offline" is not lit while "?debug" is on.
	if ([...ownParams].length === 0) {
		return !viewButtons.some((o) => {
			const [op, oq = ""] = o.href.split("?");
			return op === path && oq && [...new URLSearchParams(oq)].every(([k]) => live.has(k));
		});
	}
	return [...ownParams].every(([k]) => live.has(k));
}

/**
 * THE ORIGIN FOLLOWS THE DESTINATION, NOT THE PAGE YOU ARE ON.
 *
 * THE BUG THIS DELETES
 * This was `otherTierOrigin(pathname, ...)` — the origin looked up by the
 * SOURCE path. That is right whenever the page maps across, because source and
 * destination are then the same row. It is wrong for every FALLBACK: standing
 * on "/" of an offline-map install, the destination is /offline (which lives on
 * the getcache host) but "/" matches no row, so the lookup returned nothing and
 * the link was built on the retreever origin — retreever.localhost:5173/offline,
 * which 404s. MEASURED 27 Aug 2026.
 *
 * A url is a pair, (origin, path). Resolving each half from a different key is
 * what let them disagree, so both now come from the destination: the path is
 * `otherPath`, and the origin is whichever row SERVES that path.
 */
const otherOrigin = $derived(
	otherTierOrigin(otherPath, routes.map((r) => ({ ...r, path: r.otherPath ?? r.path }))),
);

const declaredUnavailable = $derived.by(() => {
	if (tierSlot === "right") return false;
	if (routes.length === 0) return false;
	if (childForPath(pathname)) return false;
	return !servesOtherSide(pathname, routes);
});


let probed = $state<OtherSideStatus>("unknown");

$effect(() => {
	const host = otherHost;
	const dest = otherPath;
	
	if (tierSlot === "right") return;
	if (!host || declaredUnavailable) return;
	let live = true;
	probed = "unknown";
	probeOtherSide(host, dest).then((r) => {
		if (live) probed = r;
	});
	return () => {
		live = false;
	};
});

/** Either source saying no is enough: they answer different questions. */
const unavailable = $derived(declaredUnavailable || probed === "missing");


const MOUNTED = (import.meta.env as Record<string, string | undefined>)
	.VITE_MOUNTED_CHILD;
const mountedChild = $derived(MOUNTED ? childByRepo(MOUNTED) : undefined);

const viewChild = $derived(mountedChild ?? childForPath(pathname));

const landing = $derived(viewChild ? mountPath(viewChild) : "/");
const viewRepo = $derived(
	viewChild?.repo ?? currentRepo(pathname, routes) ?? repo,
);
const viewName = $derived(viewChild?.name ?? name);

/**
 * THE NAV BUTTONS — from the registry, for the child serving THIS page.
 *
 * They arrived as a `views` prop, written into each child's own
 * routes/+layout.svelte. That file is `kit.files.routes`, so it wraps every
 * page the tier serves: who_what's list rendered a "search" button on
 * /offline, linking into a child that was not even mounted. Emptying those
 * lists fixed the wrong button and left NO buttons — MEASURED 27 Aug 2026,
 * zero nav buttons on :5174/offline.
 *
 * Resolved by pathname, like the name and the repo link beside it, so the bar
 * shows the views of whatever you are actually looking at. The prop is kept as
 * a fallback for a child cloned with no registry reachable.
 */
const viewButtons: View[] = $derived(viewChild?.views ?? views);

const offMountedChild = $derived.by(() => {
	if (!mountedChild || !pathname) return false;
	const paths = mountedChild.paths ?? [];
	if (paths.length === 0) return false;
	return !paths.some((raw) => {
		const p = mountPath(mountedChild, raw);
		return pathname === p || (raw !== "/" && pathname.startsWith(p + "/"));
	});
});

/** Built from the record, so the org appears once in the whole codebase. */
const GH = "https://github.com/Ground-Truth-Data";

const selfChild = $derived(childByRepo(selfRepo));
const selfRepoUrl = $derived(
	selfChild ? githubUrl(selfChild) : `${GH}/${selfRepo}`,
);

const viewRepoUrl = $derived(
	viewChild ? githubUrl(viewChild) : `${GH}/${viewRepo}`,
);
</script>

{#if dev}
	<header>
		<span class="left">
		
			<a class="home" href={landing} aria-label="Back to {viewName}">
				<img src={logo} alt={owner} class="logo" />
				<span class="title">{owner}</span>
			</a>
			<span class="child-name">{viewName}</span>
			{#if offMountedChild}
				<!-- The URL is not one this install serves. Said out loud, because
				     the bar otherwise looks identical on a 404 and a live page. -->
				<span class="off-mount" title="This rapper serves {mountedChild?.repo} — no route here">
					not served here
				</span>
			{/if}
		</span>

		<nav class="views">
			{#each viewButtons as v (v.label)}
				{#if v.missing}
					<span class="btn dead" title="No route for this in rapper yet">
						{v.label}
					</span>
				{:else}
				
					<a href={viewUrl(v.href)} class="btn" class:on={isCurrentView(v.href)}>
						{v.label}
					</a>
				{/if}
			{/each}
		</nav>

		<span class="right">
			<a class="btn gh" href={selfRepoUrl} target="_blank" rel="noreferrer">
				<img src={ghIcon} alt="" /> {selfRepo}
			</a>
			<!-- The CHILD repo for the view you are on. Derived from the live
			     pathname, so walking from /who to /offline changes it. -->
			{#if viewRepo && viewRepo !== selfRepo}
				<a class="btn gh" href={viewRepoUrl} target="_blank" rel="noreferrer">
					<img src={ghIcon} alt="" /> {viewRepo}
				</a>
			{/if}
		</span>
	</header>
{/if}


<style>
	/* A dead-end URL under this install. Terracotta = context, not commit:
	   it reports a fact, it is not something to click. */
	.off-mount {
		margin-left: 0.5rem;
		padding: 0.15rem 0.45rem;
		border: 1px solid #7c4a32;
		border-radius: 3px;
		color: #c97b52;
		font-size: 0.7rem;
		white-space: nowrap;
	}

	header {
		position: sticky;
		top: 0;
		flex: none;
		z-index: 10000;
		height: var(--host-chrome, 67px);
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0 1.1rem;
		/* Same chrome as the real navbars: near-black bar, gold rule under it.
		   Hard-coded rather than tokenised — the bar must look identical when a
		   parent's tokens are absent, which is the state it exists to show. */
		background: #0b0b0b;
		border-bottom: 3px solid #f5a119;
		font: 500 13px/1 "JetBrains Mono", ui-monospace, monospace;
		color: #c9c9d1;
	}
	.left,
	.right {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex: 1;
	}
	.right {
		justify-content: flex-end;
	}
	/* The logo/title pair is a link now; it must still LOOK like the wordmark
	   it was, so the anchor contributes nothing but a cursor and a hit area. */
	.home {
		display: inline-flex;
		align-items: center;
		gap: inherit;
		text-decoration: none;
		color: inherit;
	}

	.logo {
		height: 48px;
		width: auto;
		display: block;
	}
	.title {
		font-size: 28px;
		font-weight: 700;
		letter-spacing: 0.01em;
		color: #f0b60a;
		white-space: nowrap;
	}
	.child-name {
		color: #6b6b78;
		font-size: 13px;
		white-space: nowrap;
	}
	.views {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.38rem 0.7rem;
		border: 1px solid #33333d;
		border-radius: 5px;
		background: #1a1a20;
		color: #d8d8e0;
		text-decoration: none;
		white-space: nowrap;
	}
	.btn:hover {
		background: #26262e;
		border-color: #45454f;
	}
	.btn.on {
		background: #f0b60a;
		border-color: #f0b60a;
		color: #17170f;
		font-weight: 700;
	}
	/* A view rapper cannot serve yet: shown so you know it exists, dead so
	   you never click through to a 404. */
	.btn.dead {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.btn.gh img {
		height: 15px;
		width: 15px;
		display: block;
		/* The mark is solid black; invert it to read on a dark bar. */
		filter: invert(1);
	}
</style>
