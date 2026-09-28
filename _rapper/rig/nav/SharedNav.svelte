<script lang="ts">
// rapper's shell, rendered by the child's layout. Dev only.
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
	/** Fallback repo for the second GitHub link when the live route has no child in `routes`. */
	repo: string;
	views?: View[];
	ghIcon: string;
	/** Passed through: this bar does not know which tier it is. */
	tier: string;
	otherTier: string;
	/** Fixed, so the pill never reorders. */
	tierSlot?: "left" | "right";
	otherHost?: string;
	/** "/" is where a server answers, not where its work is. */
	otherHome?: string;
	routes?: TierRoute[];
	selfRepo?: string;
	/** Not read from $app/state: a non-SvelteKit parent also mounts this. */
	pathname?: string;
	/** With its leading "?", carried across the tier switch. */
	search?: string;
} = $props();

const dev = import.meta.env.DEV;

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

function isCurrentView(href: string): boolean {
	const [path, own = ""] = href.split("?");
	if (path !== pathname) return false;
	const live = new URLSearchParams(search);
	const ownParams = new URLSearchParams(own);
	// A view with no params is current only when no other view's param is set.
	if ([...ownParams].length === 0) {
		return !viewButtons.some((o) => {
			const [op, oq = ""] = o.href.split("?");
			return op === path && oq && [...new URLSearchParams(oq)].every(([k]) => live.has(k));
		});
	}
	return [...ownParams].every(([k]) => live.has(k));
}

// Origin and path both resolve from the DESTINATION — a fallback route builds the link on the wrong host.
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

// The prop is the fallback for a child cloned with no registry reachable.
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
				<!-- Said out loud: the bar otherwise looks identical on a 404 and a live page. -->
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
			{#if viewRepo && viewRepo !== selfRepo}
				<a class="btn gh" href={viewRepoUrl} target="_blank" rel="noreferrer">
					<img src={ghIcon} alt="" /> {viewRepo}
				</a>
			{/if}
		</span>
	</header>
{/if}


<style>
	/* Terracotta = context: it reports a fact, it is not something to click. */
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
		/* Hard-coded, not tokenised: the bar must look identical when a parent's tokens are absent. */
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
	/* A view rapper cannot serve yet: shown, but never a click-through to a 404. */
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
