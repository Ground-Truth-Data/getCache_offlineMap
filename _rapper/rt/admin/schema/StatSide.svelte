<!-- A run of number cells sharing one tone. The tone names the score, it
  doesn't rate it — a value-driven tint (green/amber/red) made colour a verdict.
  No media query: wraps by its own width. -->
<script lang="ts" module>
export type Stat = {
	label: string;
	/** Dimmed qualifier after the label. */
	em?: string;
	value: string;
	/** Smaller suffix: `/203`, `%`. */
	unit?: string;
	/** 0…100 bar; null draws none. */
	bar: number | null;
	sub?: string;
	title?: string;
	/** The big lead number. */
	head?: boolean;
};
</script>

<script lang="ts">
let { cells, tone = "#a3a08c" }: { cells: Stat[]; tone?: string } = $props();

const clamp = (v: number | null) => Math.max(0, Math.min(100, v ?? 0));
</script>

<div class="side" style:color={tone}>
	{#each cells as c (c.label)}
		<div class="cell" class:head={c.head} title={c.title}>
			<span class="label">{c.label}{#if c.em} <em>{c.em}</em>{/if}</span>
			<span class="value" class:sm={!c.head}>{c.value}{#if c.unit}<i class="pc">{c.unit}</i>{/if}</span>
			{#if c.bar !== null}<span class="track"><i style="width:{clamp(c.bar)}%"></i></span>{/if}
			{#if c.sub}<span class="sub">{c.sub}</span>{/if}
		</div>
	{/each}
</div>

<style>
	.side {
		display: flex;
		align-items: stretch;
		gap: 1px;
		background: var(--at-line, #262626);
		border: 1px solid var(--at-line, #262626);
		border-radius: 7px;
		overflow: hidden;
	}
	/* Each cell owns its background so the 1px flex gap reads as a divider — survives the wrap. */
	.cell {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 7px 13px 8px;
		background: var(--at-inset, #111);
		min-width: 92px;
	}
	.head {
		min-width: 124px;
	}
	.label {
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.11em;
		text-transform: uppercase;
		color: var(--at-muted, #8f8a76);
		white-space: nowrap;
	}
	.label em {
		font-style: normal;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: none;
		opacity: 0.62;
	}
	.value {
		font-size: 29px;
		font-weight: 800;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.value.sm {
		font-size: 16px;
		opacity: 0.9;
	}
	.sub {
		font-size: 9.5px;
		font-variant-numeric: tabular-nums;
		color: var(--at-muted, #8f8a76);
		white-space: nowrap;
	}
	.pc {
		font-size: 12px;
		font-style: normal;
		font-weight: 600;
		margin-left: 1px;
		opacity: 0.65;
	}
	.track {
		display: block;
		height: 3px;
		border-radius: 2px;
		background: rgb(255 255 255 / 8%);
		overflow: hidden;
	}
	.track i {
		display: block;
		height: 100%;
		border-radius: 2px;
		background: currentcolor;
	}
</style>
