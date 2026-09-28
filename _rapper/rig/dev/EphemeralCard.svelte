<script lang="ts">
import "./devCard.css";
/**
 * The dev-only tray every tier shares: the tier pill plus whatever a page
 * hands in, as children or by portalling DOM into `bind:host`. A tray, not a
 * nav — it draws no links and takes no position in the page.
 */
import type { Snippet } from "svelte";
import { page } from "$app/state";
import ParentPill from "./ParentPill.svelte";
import { TIER_HOME, otherTierOrigin, otherTierPath } from "../nav/tierRoutes";

let {
	title = "",
	/** The content element, for components that portal their DOM in. */
	host = $bindable<HTMLElement | undefined>(undefined),
	onfold,
	children,
}: {
	title?: string;
	host?: HTMLElement;
	onfold?: () => void;
	children?: Snippet;
} = $props();

const dev = import.meta.env.DEV;

// The tier facts arrive as VITE_* defines from whichever vite.config is
// running (dev server only); a build has none, so the pill is absent.
const ENV_T = import.meta.env as Record<string, string | undefined>;
const T_TIER = ENV_T.VITE_RAPPER_TIER ?? "";
const T_OTHER = ENV_T.VITE_OTHER_TIER ?? "";
const T_SLOT = (ENV_T.VITE_TIER_SLOT ?? "right") as "left" | "right";
const T_OTHER_ORIGIN = ENV_T.VITE_OTHER_ORIGIN;
const T_OTHER_HOME = ENV_T.VITE_OTHER_HOME;
let T_ROUTES: any[] = [];
try {
	T_ROUTES = JSON.parse(ENV_T.VITE_TIER_ROUTES ?? "[]");
} catch {
	T_ROUTES = [];
}
const tLeft = $derived(T_SLOT === "left" ? T_TIER : T_OTHER);
const tRight = $derived(T_SLOT === "left" ? T_OTHER : T_TIER);
const tOtherPath = $derived(otherTierPath(page.url.pathname, T_ROUTES, T_OTHER_HOME));
const tOtherOrigin = $derived(
	otherTierOrigin(tOtherPath, T_ROUTES.map((r: any) => ({ ...r, path: r.otherPath ?? r.path }))),
);
const tHref = $derived(
	T_OTHER_ORIGIN
		// The hash is appended at click time by ParentPill: a derived hash is stale.
		? (tOtherOrigin ?? T_OTHER_ORIGIN) + (tOtherPath ?? TIER_HOME) + page.url.search
		: undefined,
);

</script>

{#if dev}
	<section class="dev-card ephemeral" data-ephemeral>
		<header class="bar">
			<button type="button" class="fold" onclick={onfold} aria-label="Hide dev tray">▾</button>
			<span class="tag">dev</span>
			{#if title}<span class="title">{title}</span>{/if}
		</header>
		<div class="content" bind:this={host}>
			{#if T_TIER}
				<div class="pill"><ParentPill leftLabel={tLeft} rightLabel={tRight} current={T_TIER} href={tHref} /></div>
			{/if}
			{@render children?.()}
		</div>
	</section>
{/if}

<style>
.ephemeral {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.bar {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 0 0 auto;
}
.fold {
	all: unset;
	cursor: pointer;
	width: 18px;
	text-align: center;
	color: #e8b923;
}
.tag {
	padding: 1px 7px;
	border-radius: 999px;
	background: #e8b923;
	color: #111;
	font-weight: 700;
	letter-spacing: 0.04em;
}
.title { color: #999; }
.pill { flex: 0 0 auto; }
.content {
	display: flex;
	flex-direction: column;
	gap: 10px;
	overflow: auto;
	min-height: 0;
}
/* Anything portalled here was styled for somewhere else; neutralise its placement rules only. */
.content > :global(*) {
	position: static;
	flex: 0 0 auto;
	width: auto;
	max-height: none;
}
</style>
