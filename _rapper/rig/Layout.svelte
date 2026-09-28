<script lang="ts">
// --host-chrome is declared here and read by the nav, the docks and the tray.
// Product-neutral: a phone app wraps its own children in $gc/PhoneRig.
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

// Injected by rapper's vite.config.ts `define`; undefined in a solo clone. Never hardcoded.
const ENV = import.meta.env as Record<string, string | undefined>;
const THIS_TIER = ENV.VITE_RAPPER_TIER ?? "";
const OTHER_TIER = ENV.VITE_OTHER_TIER ?? "";
const OTHER_ORIGIN = ENV.VITE_OTHER_ORIGIN;
const OTHER_HOME = ENV.VITE_OTHER_HOME;
const THIS_SLOT = (ENV.VITE_TIER_SLOT ?? "right") as "left" | "right";

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
	<link rel="icon" href={icon ?? logo} />
	{#if dev}
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

<EphemeralTray />

<main>
	{@render children?.()}
</main>

<style>
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
