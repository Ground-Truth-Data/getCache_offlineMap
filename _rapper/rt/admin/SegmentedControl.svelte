<!--
  One row of mutually-exclusive options, the selected one filled gold.
  RADIOS, NOT BUTTONS: a segmented control IS a radio group, and native radios
  bring keyboard support, screen-reader announcement and form semantics that
  would otherwise be hand-built badly on <button>. The radio is visually
  hidden; the <label> is the segment you see.
-->
<script lang="ts">
type Option = { value: string; label: string };
type Props = {
	/** In display order — the FIRST is the group's default. */
	options: Option[];
	value: string;
	/** Announced to screen readers — every radio group needs a name. */
	label: string;
	/** Unique per group on the page; radios of one group share a name. */
	name: string;
	onchange?: (value: string) => void;
};
let { options, value = $bindable(), label, name, onchange }: Props = $props();

function pick(v: string) {
	value = v;
	onchange?.(v);
}
</script>

<div class="seg" role="radiogroup" aria-label={label}>
	{#each options as opt (opt.value)}
		<label class="seg-item" class:sel={value === opt.value}>
			<input
				type="radio"
				{name}
				value={opt.value}
				checked={value === opt.value}
				onchange={() => pick(opt.value)}
			/>
			{opt.label}
		</label>
	{/each}
</div>

<style>
	/* No gap between segments, one shared border — the group must read as a single control. */
	.seg {
		display: inline-flex;
		border: 1px solid var(--at-line-strong, rgba(255, 255, 255, 0.2));
		border-radius: 8px;
		overflow: hidden;
	}
	/* PADDING IS THE ROW'S BIGGEST COST: eleven segments in the Filters row means every horizontal pixel is spent 11x. 10px keeps a clear hit area and buys back ~88px, letting the column builder finish on the same line. */
	.seg-item {
		font-size: 12.5px;
		font-weight: 700;
		color: var(--at-muted, #8f8b80);
		padding: 7px 10px;
		cursor: pointer;
		white-space: nowrap;
		user-select: none;
		transition: background 120ms ease, color 120ms ease;
	}
	.seg-item:hover:not(.sel) {
		color: var(--at-fg, #f3f1e9);
	}
	/* Same gold as every other gold control, but NOT the outer glow/bevel —
	   those lift a button off the surface, and a segment is set INTO a
	   bordered group; the inset highlight alone reads as raised within the
	   track. Dark ink: gold is LIGHT on this palette, white fails contrast. */
	.seg-item.sel {
		background: linear-gradient(
			180deg,
			var(--rt-gold-1, #f5d565) 0%,
			var(--rt-gold-2, #e8b923) 100%
		);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
		color: var(--rt-gold-ink, #1c0d04);
		text-shadow: 0 1px 0 var(--rt-press-lo), 0 -1px 0 var(--rt-press-hi);
	}
	/* Hidden with clip, not display:none, so it stays focusable and reachable. */
	.seg-item input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	/* Focus must be visible on the SEGMENT since the input is clipped out of sight. */
	.seg-item:has(input:focus-visible) {
		outline: 2px solid var(--at-gold, #eab627);
		outline-offset: -2px;
	}
</style>
