<script lang="ts">
import "./devCard.css";
/**
 * EPHEMERAL DOCK — a dev-only side column for page-specific instruments.
 *
 * The TRAY is what every page shares (tier pill, debug toggle). A page's own
 * panels — the offline map's memory/blobs/config rails — belong to one page
 * and are big, so they go in a dock instead. Empty dock, no dock: `:empty`
 * hides it, so a page that has not toggled its panels on shows nothing.
 *
 * THE BOX IS <SideCard>, not this file. Where a panel sits beside the phone
 * is one question with one answer — span the viewport edge to the frame, even
 * margins, measured from the frame's real box — and that answer used to live
 * here, gated behind `{#if dev}`. A public page needing the same geometry
 * therefore had to rewrite it, which is exactly what the wiki pages did and
 * got wrong. Escaping to <body> moved there too — a card that has not escaped
 * sits on top of the phone, so it is part of the box, not of the dev gate.
 * What stays here is genuinely dev-only: the gate, and the `bind:host` handle
 * a page uses to move its own nodes in.
 */
import type { Snippet } from "svelte";
import SideCard from "$gc/SideCard.svelte";

let {
	side = "left",
	/** Extra offset below the host nav — e.g. the tray's height, so a dock
	 * can sit under the tray on the same side. */
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
</script>

{#if dev}
	<SideCard {side} {top} bind:el={host} class="dock" data-ephemeral-dock>
		{@render children?.()}
	</SideCard>
{/if}

<style>
/* Only what a DOCK adds to a side panel: the instrument-rail look, and the
   rule that an empty one disappears. The box is SideCard's. */
:global(.dock) {
	z-index: 8900;
	color: #d8d4c8;
	font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
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
