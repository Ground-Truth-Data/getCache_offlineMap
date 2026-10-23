<script lang="ts">
import type { Snippet } from "svelte";

/** Three gold chevrons rolling toward a swipe, 2.4 s on in every 6 s. The host
    positions `.chevron-sign`; `children` is the resting glyph, which steps aside
    for the beat. Phase is the wall clock, so every instance on the page beats
    together whenever it was switched on. */
let { on = false, children }: { on?: boolean; children?: Snippet } = $props();

const PERIOD_MS = 6000;
const phase = $derived(on ? -(Date.now() % PERIOD_MS) : 0);
</script>

<span class="chevron-wave" class:on style:--chevron-phase="{phase}ms">
	{#if children}<span class="rest">{@render children()}</span>{/if}
	<span class="chevron-sign" aria-hidden="true"><i></i><i></i><i></i></span>
</span>

<style>
	.chevron-wave,
	.rest {
		display: contents;
	}
	.chevron-sign {
		position: absolute;
		top: 50%;
		display: flex;
		translate: 0 -50%;
		filter: drop-shadow(0 0 2px rgba(243, 198, 30, 0.8));
		opacity: 0;
		pointer-events: none;
	}
	.chevron-sign i {
		width: 13px;
		height: 17px;
		margin: 0 -2px;
		background: #f3c61e;
		mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 13'%3E%3Cpath d='M3 2 7.5 6.5 3 11' fill='none' stroke='%23000' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
		opacity: 0.15;
	}
	.on .chevron-sign {
		animation: sign-show 6s var(--chevron-phase) infinite;
	}
	.on .chevron-sign i {
		animation: chevron-wave 1.2s var(--chevron-phase) ease-in-out infinite;
	}
	.on .chevron-sign i:nth-child(2) { animation-delay: calc(var(--chevron-phase) + 0.15s); }
	.on .chevron-sign i:nth-child(3) { animation-delay: calc(var(--chevron-phase) + 0.3s); }
	.on .rest > :global(*) {
		animation: rest-yield 6s var(--chevron-phase) infinite;
	}
	@keyframes chevron-wave {
		0%, 100% { translate: -4px 0; opacity: 0.15; }
		40% { translate: 4px 0; opacity: 1; }
		70% { opacity: 0.15; }
	}
	@keyframes sign-show {
		0%, 40%, 100% { opacity: 0; }
		2.4%, 36.8% { opacity: 1; }
	}
	@keyframes rest-yield {
		0%, 40%, 100% { opacity: 1; }
		2.4%, 36.8% { opacity: 0; }
	}
</style>
