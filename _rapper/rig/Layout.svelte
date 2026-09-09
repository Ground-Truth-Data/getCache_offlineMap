<script lang="ts">
/**
 * RAPPER'S LAYOUT. rapper has no routes/+layout.svelte of its own — SvelteKit
 * builds only the mounted child's — so every child's +layout.svelte renders
 * this: nav on top, the page below it. The height the nav takes is declared
 * HERE (--host-chrome) and read by the nav, the docks and the tray, so "the
 * page begins where the nav ends" is decided once.
 *
 * Product-neutral: it knows nothing about phones. A phone app wraps its own
 * children in $gc/PhoneRig inside this.
 */
import "$parent/src/app.unique.css";
import { page } from "$app/state";
import SharedNav from "./nav/SharedNav.svelte";
import EphemeralTray from "./dev/EphemeralTray.svelte";
import type { TierRoute } from "./nav/tierRoutes";
import ghIconUrl from "./assets/github-logo.png";
import type { Snippet } from "svelte";

type Child = { name: string; owner: string; repo: string; views?: { href: string; label: string }[] };

let {
	child,
	logo,
	icon,
	children,
}: { child: Child; logo: string; icon?: string; children?: Snippet } = $props();

const dev = import.meta.env.DEV;

// Injected by rapper's vite.config.ts `define`; a solo clone gets undefined
// for all of them and the pill renders nothing. Never a hardcoded parent name.
const ENV = import.meta.env as Record<string, string | undefined>;
const THIS_TIER = ENV.VITE_RAPPER_TIER ?? "";
const OTHER_TIER = ENV.VITE_OTHER_TIER ?? "";
const OTHER_ORIGIN = ENV.VITE_OTHER_ORIGIN;
const OTHER_HOME = ENV.VITE_OTHER_HOME;
const THIS_SLOT = (ENV.VITE_TIER_SLOT ?? "right") as "left" | "right";

// A malformed table is a typo in a dev tool; it must never white-screen the app.
function readRoutes(raw: string | undefined): TierRoute[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
const TIER_ROUTES = readRoutes(ENV.VITE_TIER_ROUTES);
</script>

<svelte:head>
	<title>{`${child.owner} — ${child.name}`}</title>
	<!-- The tab icon is the PRODUCT's app icon when it has one; the nav logo
	     (a wide transparent wordmark) reads as a smudge at 16px. -->
	<link rel="icon" href={icon ?? logo} />
	{#if dev}
		<!-- The nav's height, declared only in dev so production reserves nothing. 64px bar + 3px gold rule. -->
		<style>
			:root { --host-chrome: 67px; }
		</style>
	{/if}
</svelte:head>

{#if dev}
	<SharedNav
		owner={child.owner}
		name={child.name}
		{logo}
		repo={child.repo}
		views={child.views ?? []}
		ghIcon={ghIconUrl}
		pathname={page.url.pathname}
		search={page.url.search}
		tier={THIS_TIER}
		otherTier={OTHER_TIER}
		tierSlot={THIS_SLOT}
		otherHost={OTHER_ORIGIN}
		otherHome={OTHER_HOME}
		routes={TIER_ROUTES}
		selfRepo={THIS_TIER || undefined}
	/>
{/if}

<!-- THE DEV TRAY, ON EVERY PAGE. rapper has no routes/+layout of its own, so
     this layout IS the one place every child page passes through — the same
     argument the nav above already makes. One mount replaced a per-page mount
     in each child, which was a list to forget in two directions: a page with
     no tray, and the card shipping into production because an unconditional
     mount is a live reference the bundler must keep. Renders nothing outside
     `vite dev`. -->
<EphemeralTray />

<main>
	{@render children?.()}
</main>

<style>
	/* body is the column: nav, then the page. A positioned, sized <main> is
	   what a child that fills its slot (position:absolute; inset:0) fills. */
	:global(body) {
		margin: 0;
		height: 100dvh;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	main {
		flex: 1;
		min-height: 0;
		position: relative;
		overflow: hidden;
	}
</style>
