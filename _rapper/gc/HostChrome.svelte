<script lang="ts">
/**
 * The header and footer bars a child does NOT own.
 *
 * Get Cache draws a nav bar and a tab bar around every mini-app, but those
 * belong to the mounting tier — a child served on its own has neither, so a
 * layout built against the full window is re-fitted the moment it is mounted
 * and the panes jump. This reserves the same bands standalone, marked with the
 * gold rule, so a child is laid out against the height it will really get.
 *
 * A STAND-IN, NEVER AN EXTRA. It is rendered from a child's own
 * routes/+layout.svelte, which SvelteKit builds only when the child serves
 * itself; mounted, the tier's layout runs instead and the real bars appear in
 * these positions. That is the swap — nothing to switch off by hand.
 */
import { page } from "$app/state";
import type { Snippet } from "svelte";
import { hasBottomBar, hasTopBar } from "./rigOrientation";

let {
	children,
	header = "placeholder header",
	footer = "placeholder footer",
}: {
	children?: Snippet;
	/** Text in the reserved band. Empty string leaves it blank. */
	header?: string;
	footer?: string;
} = $props();

// Reserve exactly what the mounted tier will draw. A route the tier gives no
// top bar must not be handed one here either, or the stand-in reserves a band
// that never arrives and the child is laid out against the wrong height —
// which is the one thing this component exists to prevent.
const topBar = $derived(hasTopBar(page.url.pathname));
const bottomBar = $derived(hasBottomBar(page.url.pathname));
</script>

<div class="host" class:no-top={!topBar} class:no-bottom={!bottomBar}>
	{#if topBar}
		<div class="bar top" aria-hidden="true">{header}</div>
	{/if}
	<div class="slot">{@render children?.()}</div>
	{#if bottomBar}
		<div class="bar bottom" aria-hidden="true">{footer}</div>
	{/if}
</div>

<style>
.host {
	display: grid;
	/* Only the page flexes; the reserved bands keep their height whatever the
	   page does, which is the whole point of reserving them. */
	grid-template-rows: auto 1fr auto;
	height: 100%;
	min-height: 0;
}
.host.no-top {
	grid-template-rows: 1fr auto;
}
.host.no-bottom {
	grid-template-rows: auto 1fr;
}
.host.no-top.no-bottom {
	grid-template-rows: 1fr;
}
.slot {
	position: relative;
	min-height: 0;
	overflow: hidden;
}
.bar {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 4.25rem;
	background: #000;
	color: #4a4033;
	font-size: 0.62rem;
	letter-spacing: 0.28em;
	text-transform: uppercase;
	user-select: none;
}
.bar.top {
	border-bottom: 2px solid var(--gc-gold, #e8b93a);
}
.bar.bottom {
	border-top: 2px solid var(--gc-gold, #e8b93a);
}
</style>
