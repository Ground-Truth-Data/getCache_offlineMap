<!-- A pick-mode tick: empty, ticked ("on"), or some-of ("part") for a row that stands for several.
     With a label it is the "tick everything shown" row. -->
<script lang="ts">
	import Icon from "./Icon.svelte";

	let {
		state,
		label,
		onclick,
	}: { state: "" | "on" | "part"; label?: string; onclick?: () => void } = $props();
</script>

{#snippet box()}
	<span class="tick tick--{state || 'off'}" aria-hidden="true">
		{#if state === "on"}<Icon name="check" size={16} stroke={3.2} />{/if}
	</span>
{/snippet}

{#if label}
	<button type="button" class="tick-row" {onclick}>{@render box()}{label}</button>
{:else}
	{@render box()}
{/if}

<style>
	.tick {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 8px;
		box-shadow: inset 0 0 0 2px #8a7440;
		color: var(--rt-gold-ink);
	}
	.tick--on {
		background: var(--rt-yellow);
		box-shadow: inset 0 0 0 2px var(--rt-yellow);
	}
	.tick--part {
		box-shadow: inset 0 0 0 2px var(--rt-yellow);
	}
	.tick--part::after {
		content: "";
		width: 12px;
		height: 2.5px;
		border-radius: 2px;
		background: var(--rt-yellow);
	}
	.tick-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.25rem 0.75rem 0.6rem;
		background: none;
		border: 0;
		color: var(--rt-cream-dim);
		font-family: var(--rt-font-display);
		font-size: 1.15rem;
		cursor: pointer;
	}
</style>
