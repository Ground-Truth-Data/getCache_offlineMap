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
import type { Snippet } from "svelte";

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
</script>

<div class="host">
	<div class="bar top" aria-hidden="true">{header}</div>
	<div class="slot">{@render children?.()}</div>
	<div class="bar bottom" aria-hidden="true">{footer}</div>
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
