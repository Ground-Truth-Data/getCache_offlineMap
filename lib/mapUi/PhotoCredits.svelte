<!-- The attributions of the satellite photos on the map, shown while they are up. -->
<script lang="ts">
let { credits }: { credits: string[] } = $props();
</script>

{#if credits.length}
	<p class="photo-credits">{credits.join(" · ")}</p>
{/if}

<style>
.photo-credits {
	position: absolute;
	left: 8px;
	right: 8px;
	bottom: calc(env(safe-area-inset-bottom) + 4px);
	z-index: 2;
	margin: 0;
	font-size: 10px;
	color: rgb(255 255 255 / 0.85);
	text-shadow: 0 0 2px #000;
	pointer-events: none;
}
</style>
