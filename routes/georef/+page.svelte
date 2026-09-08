<script lang="ts">
/**
 * /georef — the PDF georeferencer. BLANK ON PURPOSE: the contractor building
 * it owns everything inside this file. The (getcache) shell supplies the
 * phone, top bar and tab bar, so the page itself starts empty.
 *
 * The brief is docs/GEOREFERENCER_SPEC.md — read it before writing here.
 */
</script>

<svelte:head><title>Get Cache | georeference</title></svelte:head>

<div class="georef">
	<p class="hint">Georeferencer — see <code>docs/GEOREFERENCER_SPEC.md</code>.</p>
</div>

<style>
.georef {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
	padding: 1rem;
}
.hint {
	color: var(--rt-text-dim, #8a8f98);
	font-size: 0.8rem;
	text-align: center;
}
</style>
