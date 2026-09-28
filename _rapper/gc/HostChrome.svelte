<script lang="ts">
/**
 * Reserves the nav and tab-bar bands a mounting tier draws, so a child served
 * alone is laid out against the height it will really get. Rendered only from
 * a child's own routes/+layout.svelte; mounted, the tier's real bars take
 * these positions.
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

// Reserve exactly what the mounted tier will draw, or the child is laid out
// against the wrong height.
const topBar = $derived(hasTopBar(page.url));
const bottomBar = $derived(hasBottomBar(page.url));
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
