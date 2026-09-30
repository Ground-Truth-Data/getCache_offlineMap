<!--
  The ONE page title for every admin screen; a page passes content rather
  than restating chrome. Title, meta, search and actions share ONE row —
  vertical space is scarce on a table screen, every band above the grid
  pushes data under the fold.
-->
<script lang="ts">
import type { Snippet } from "svelte";


type Props = {
	/** The screen's name. */
	title: string;
	/** Machine name (a real table name), rendered in mono beside the title. */
	ident?: string;
	/** One line on what this screen is for — internal tools opened once a month, where the column headers don't say. */
	sub?: string;
	/** A search field for this screen's data, riding the title row. */
	search?: Snippet;
	/** Right-aligned count or timestamp. */
	meta?: string;
	/** Richer meta than a string — same slot, same quiet styling. */
	metaSlot?: Snippet;
	/** Screen-level buttons, right side of the title row. */
	actions?: Snippet;
};
let { title, ident, search, sub, meta, metaSlot, actions }: Props = $props();
</script>

<div class="admin-pagehead">
	<div class="admin-pagehead-row">
		<h1>
			{title}{#if ident}<code class="admin-pagehead-ident">{ident}</code>{/if}
		</h1>
		<!-- Not `margin-left:auto` on the meta: `metaSlot` is truthy even rendering nothing, and the empty <span> would still eat the auto margin. -->
		<span class="admin-pagehead-gap"></span>
		{#if meta || metaSlot}
			<span class="admin-pagehead-meta">
				{#if metaSlot}{@render metaSlot()}{:else}{meta}{/if}
			</span>
		{/if}
		<!-- After the spacer so it lands at the RIGHT end of the row — before it, title and search crowd the left half. -->
		{#if search}
			<div class="admin-pagehead-search">{@render search()}</div>
		{/if}
		{#if actions}
			<div class="admin-pagehead-actions">{@render actions()}</div>
		{/if}
	</div>
	{#if sub}<p>{sub}</p>{/if}
</div>

<style>
	/* DON'T import adminTable.css from this component to "share" the look — it 500s the Tailwind pages that mount this. Scoped styles ship with the component; tokens carry literal fallbacks. */
	/* 8px, not 22: every pixel here is a pixel of row count, and the grid's own header plane already separates the two — a wide gap was paying twice for one edge. */
	.admin-pagehead {
		margin-bottom: 8px;
	}
	/* baseline, not center: title and count are both TEXT, reading as one line only on a shared baseline. */
	.admin-pagehead-row {
		display: flex;
		align-items: baseline;
		gap: 14px;
		flex-wrap: wrap;
	}
	.admin-pagehead h1 {
		font-size: 20px;
		font-weight: 800;
		color: var(--at-fg, #fafafa); /* stated, not inherited — some page wrappers set their own color */
		margin: 0;
		flex-shrink: 0;
		line-height: 1.2;
	}
	/* Mono: an identifier to type into psql, not prose. Rust: meta ABOUT the screen, not the screen's own name. */
	.admin-pagehead-ident {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
		font-weight: 500;
		color: var(--at-accent, #c97a4a);
		margin-left: 8px;
	}
	/* Degrades by SHRINKING to `min-width` before the row's flex-wrap drops it to its own line. Container-relative, not a media query, so it reads the space actually in the row. */
	.admin-pagehead-search {
		display: flex;
		align-items: center;
		gap: 8px;
		/* DOES NOT GROW — the spacer to its left claims the leftover, or a growing box fights it and straddles the middle. Basis `auto`, not a length, since a button here doesn't shrink. */
		flex: 0 1 auto;
		min-width: 14ch;
	}
	/* Without this the box keeps its intrinsic width and the row wraps far too early. */
	.admin-pagehead-search :global(input) {
		width: 100%;
		min-width: 0;
		/* 13px matches the meta and the pager; the inherited 15.2px made the field the tallest thing in the row, so it, not the title, set the band's height. */
		font-size: 13px;
	}
	/* MUST be `width`, not `flex-basis`: the slot is already `0 1 auto`-sized to its contents, so a basis here measures identically to no rule. Sized here, not in SearchInput, which is shared with the Inbox and knows nothing of an admin toolbar. */
	.admin-pagehead-search > :global(.rt-search) {
		width: 22rem;
		max-width: 100%;
		min-width: 0;
		/* Trimmed from 8px for the same reason as the font size above. */
		padding-block: 4px;
	}
	.admin-pagehead-gap {
		flex: 1 1 0;
		min-width: 0;
	}
	/* A receipt — row counts, "fetched 2m ago" — quiet, never a heading. */
	.admin-pagehead-meta {
		font-size: 12.5px;
		font-weight: 500;
		color: var(--at-muted, #8f8a76);
	}
	.admin-pagehead-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.admin-pagehead p {
		margin: 6px 0 0;
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--at-muted, #8f8a76);
		font-weight: 500;
		max-width: 800px;
	}
</style>
