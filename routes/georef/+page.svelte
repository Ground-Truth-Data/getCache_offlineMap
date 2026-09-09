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

<!-- Opaque, not transparent: the shell's wallpaper sits behind the phone, and
     a see-through page reads as a broken screen rather than an empty one. -->
<div class="georef">
	<p class="title">Georeferencer</p>
	<p class="hint">This screen is yours to build.</p>
	<p class="brief">docs/GEOREFERENCER_SPEC.md</p>
</div>

<style>
.georef {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.35rem;
	height: 100%;
	padding: 1rem;
	background: #0c0d0f;
	color: var(--rt-text-dim, #8a8f98);
	text-align: center;
}
.title {
	color: var(--gc-gold, #e8b93a);
	font-size: 1rem;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}
.hint {
	font-size: 0.85rem;
}
.brief {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 0.72rem;
	opacity: 0.65;
}
</style>
