<!-- Up and down, both gold while the list keeps its default order (last touched);
  once a column sorts, the winning arrow stays gold and the other dims. -->
<script lang="ts">
let { dir = 0 }: { dir?: 1 | -1 | 0 } = $props();
</script>

<svg class="sa" class:asc={dir > 0} class:desc={dir < 0} viewBox="0 0 8 12" aria-hidden="true">
	<path class="up" d="M4 0 8 5H0z" /><path class="dn" d="M4 12 0 7h8z" />
</svg>

<style>
	.sa {
		flex: none;
		width: 8px;
		height: 12px;
		vertical-align: middle;
		fill: var(--rt-yellow);
	}
	.asc .dn,
	.desc .up {
		fill: #565a48;
	}
</style>
