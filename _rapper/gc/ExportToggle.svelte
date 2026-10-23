<!-- The Export button beside a filter: outlined, gold while its pick mode is on. -->
<script lang="ts">
	import Icon from "./Icon.svelte";

	let {
		on = false,
		label,
		onclick,
	}: { on?: boolean; label: string; onclick: (e: MouseEvent) => void } = $props();
</script>

<!-- No aria-pressed: the theme paints a pressed button as solid gold. -->
<button type="button" class="xbtn" class:on {onclick}>
	<Icon name="upload" size={18} />{label}
</button>

<style>
	.xbtn {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0 0.9rem;
		border: 1.5px solid var(--rt-bg-input-alt);
		border-radius: 0.9rem;
		background: transparent;
		color: var(--rt-cream-dim);
		font-family: var(--rt-font-display);
		font-size: 1.15rem;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.on {
		border: 2px solid var(--rt-yellow);
		background: rgba(243, 198, 30, 0.1);
		color: var(--rt-yellow);
	}
</style>
