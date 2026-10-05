<!-- The row above a SchemaCanvas: every colour it paints, and its zoom. -->
<script lang="ts">
import { BAND_LABEL } from "./schemaBands";

let {
	canvas,
}: { canvas: { fit: () => void; zoomBy: (f: number) => void } | null } = $props();

/** Every colour on screen is in the legend; key bands lead, the two kinds of nothing last. */
const LEGEND = [
	"empty-key",
	"partial-key",
	"partial",
	"full",
	"empty",
] as const;

/** The empty-table ring; its rows are ordinary empties, covered above. */
const CARD_LEGEND = [
	{ cls: "card-empty", label: "whole table empty" },
] as const;
</script>

<div class="head-row">
	<div class="legend">
		{#each LEGEND as band (band)}
			<span class="key"><i class="sw band-{band}"></i>{BAND_LABEL[band]}</span>
		{/each}
		{#each CARD_LEGEND as c (c.cls)}
			<span class="key"><i class="sw {c.cls}"></i>{c.label}</span>
		{/each}
	</div>
	<div class="tools">
		<button onclick={() => canvas?.zoomBy(1 / 1.3)} title="Zoom out">−</button>
		<button onclick={() => canvas?.zoomBy(1.3)} title="Zoom in">+</button>
		<button class="fit" onclick={() => canvas?.fit()}>Fit</button>
	</div>
</div>

<style>
	.head-row {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
		margin-bottom: 10px;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-left: auto;
	}
	.tools button {
		min-width: 30px;
		padding: 4px 9px;
		border: 1px solid var(--at-line, #262626);
		border-radius: 5px;
		background: var(--at-inset, #111);
		color: var(--at-fg, #fafafa);
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}
	.tools button:hover {
		border-color: var(--at-gold, #eab627);
	}
	.tools .fit {
		color: var(--at-gold, #eab627);
		font-weight: 700;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 14px;
		flex: 1 1 auto;
		min-width: 0;
		font-size: 10.5px;
		color: var(--at-muted, #8f8a76);
	}
	.key {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.sw {
		width: 11px;
		height: 11px;
		border-radius: 2px;
		border: 1px solid rgb(255 255 255 / 12%);
	}
	/* Repeats SchemaCanvas's palette; legendCovers.test.ts holds the two together. */
	.sw.band-empty-key {
		background: rgb(192 57 43 / 55%);
	}
	.sw.band-partial-key {
		background: rgb(244 211 94 / 34%);
	}
	.sw.band-empty {
		background: rgb(200 165 9 / 62%);
	}
	.sw.band-partial {
		background: rgb(244 211 94 / 11%);
	}
	.sw.band-full {
		background: rgb(90 170 110 / 13%);
	}

	/* No fill: an empty card is ringed, never tinted. */
	.sw.card-empty {
		background: transparent;
		border-color: rgb(224 90 72);
		box-shadow: 0 0 0 1px rgb(224 90 72 / 45%);
	}
</style>
