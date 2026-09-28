<script lang="ts">
import "./devCard.css";
/**
 * A dev-only side column for one page's own instruments (the tray is what
 * every page shares). The box is <SideCard>; only the gate and the
 * `bind:host` handle live here. `:empty` hides an empty dock.
 */
import type { Snippet } from "svelte";
import { page } from "$app/state";
import SideCard from "$gc/SideCard.svelte";
import { devChromeShows } from "$gc/devChrome";

let {
	side = "left",
	/** Extra offset below the host nav, e.g. the tray's height. */
	top = "0px",
	host = $bindable<HTMLElement | undefined>(undefined),
	children,
}: {
	side?: "left" | "right";
	top?: string;
	host?: HTMLElement;
	children?: Snippet;
} = $props();

const dev = import.meta.env.DEV;

// A page that mounts another page inherits its instruments; the child cannot
// know it is a poster, so the URL is asked here, once for every dock.
const shows = $derived(dev && devChromeShows(page.url));
</script>

{#if shows}
	<SideCard {side} {top} bind:el={host} class="dock" data-ephemeral-dock>
		{@render children?.()}
	</SideCard>
{/if}

<style>
:global(.dock) {
	z-index: 8900;
	color: #d8d4c8;
	font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
	/* A rail of readouts, not a card of sentences. */
	--card-pad: 12px 14px;
}
:global(.dock:empty) { display: none; }
/* The dock owns placement, the item keeps its look. */
:global(.dock) > :global(*) {
	position: static;
	flex: 0 0 auto;
	width: auto;
	max-height: none;
}
</style>
