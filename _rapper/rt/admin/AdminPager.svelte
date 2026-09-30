<!--
  The ONE Prev/Next window control for admin table viewers. ReTreever used to
  `take: 500` with no offset, leaving rows 501+ unreachable; both dashboards
  now share one window, moved by one control.

  Mounted BELOW the grid and nowhere else. You reach for the next page once
  you have read to the end, so a second copy above the grid spends a band of a
  table screen — rows, on the one screen whose whole point is row count — on a
  control nobody needs before they have read anything. `adminDensity.test.ts`
  pins exactly one mount per viewer, below the grid; a second one reddens it.

  Links, not buttons: `?page=N` is addressable, survives reload, and a full
  navigation re-runs the server load that fetches the window.

  Disabled edges stay RENDERED, dimmed and inert, not removed — a control
  that vanishes at the boundary is how you get stranded on an empty page.
-->
<script lang="ts">
type Props = {
	/** 0-based index of the window being shown. */
	page: number;
	/** Rows per window. */
	pageSize: number;
	/** Rows on THIS page — the last page is usually short. */
	rowsOnPage: number;
	/** Total rows in the table, when known. */
	total?: number | null;
	/** Whether a further page exists. */
	hasMore: boolean;
	/** Builds the href for a page index — the caller owns its URL shape. */
	href: (page: number) => string;
	/** Called when the page-size box is committed, already clamped to something a table can survive. Omit to keep it read-only. */
	onPageSize?: (size: number) => void;
	/** Right-aligned content — the Export button lives here. */
	actions?: import("svelte").Snippet;
	/** Extra positioning class from the host page. */
	class?: string;
};
let {
	page,
	pageSize,
	rowsOnPage,
	total,
	hasMore,
	href,
	onPageSize,
	actions,
	class: klass = "",
}: Props = $props();

// A DRAFT until committed, so a half-typed "5" on the way to "50" never refetches the table.
let sizeDraft = $state("");
$effect(() => {
	sizeDraft = String(pageSize);
});

/** A pasted 100000 would try to render the whole table into the DOM and hang the tab. */
function commitSize() {
	const n = Number.parseInt(sizeDraft, 10);
	const clamped = Number.isFinite(n) ? Math.min(5000, Math.max(1, n)) : pageSize;
	sizeDraft = String(clamped);
	if (clamped !== pageSize) onPageSize?.(clamped);
}

const first = $derived(page * pageSize + 1);
const last = $derived(page * pageSize + rowsOnPage);
const atStart = $derived(page === 0);
</script>

<!-- Hidden when everything fits (furniture describing nothing); stays if somehow past page 0, so an overshot ?page can never strand you. -->
{#if !atStart || hasMore || onPageSize || actions}
	<nav class="admin-pager {klass}" aria-label="Table pages">
		<a
			class="pg-btn"
			class:disabled={atStart}
			aria-disabled={atStart}
			tabindex={atStart ? -1 : undefined}
			href={atStart ? undefined : href(page - 1)}>‹ Prev</a
		>

		<span class="pg-meta">
			{#if rowsOnPage === 0}
				no rows on this page
			{:else if onPageSize}
				<!-- Committed on blur/Enter, never per-keystroke. `&nbsp;`, not a plain space: Svelte trims whitespace at a block start, so a newline renders as "500of 11,400". -->
				rows {first.toLocaleString()}–<input
					class="pagesize"
					type="text"
					inputmode="numeric"
					bind:value={sizeDraft}
					aria-label="Rows per page"
					onblur={commitSize}
					onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
				/>{#if total != null}&nbsp;of {total.toLocaleString()}{/if}
			{:else}
				<!-- `&nbsp;`, not a plain space: Svelte trims whitespace at a block start, so a newline after {#if} runs the words together. -->
				rows {first.toLocaleString()}–{last.toLocaleString()}{#if total != null}&nbsp;of {total.toLocaleString()}{/if}
			{/if}
		</span>

		<a
			class="pg-btn"
			class:disabled={!hasMore}
			aria-disabled={!hasMore}
			tabindex={!hasMore ? -1 : undefined}
			href={hasMore ? href(page + 1) : undefined}>Next ›</a
		>

		{#if actions}
			<span class="pg-spacer"></span>
			<div class="pg-actions">{@render actions()}</div>
		{/if}
	</nav>
{/if}

<style>
	/* Scoped and shipped with the component — same reasoning as AdminPageHead. */
	.admin-pager {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 10px 0;
	}
	.pg-btn {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--at-fg, #fafafa);
		background: var(--at-bg-2, #202020);
		border: 1px solid var(--at-border, #3a3a44);
		border-radius: 6px;
		padding: 5px 11px;
		text-decoration: none;
		white-space: nowrap;
	}
	.pg-btn:hover:not(.disabled) {
		border-color: var(--at-accent, #c97a4a);
		color: var(--at-accent, #c97a4a);
	}
	/* Inert, not gone — `pointer-events` alone would still leave it keyboard-reachable, hence tabindex in markup. */
	.pg-btn.disabled {
		opacity: 0.38;
		pointer-events: none;
		cursor: default;
	}
	.pg-spacer {
		flex: 1 1 0;
		min-width: 0;
	}
	.pg-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.pagesize {
		width: 56px;
		background: var(--at-panel-2, #1c1c1c);
		border: 1px solid var(--at-line-strong, rgba(255, 255, 255, 0.2));
		border-radius: 6px;
		color: var(--at-fg, #f3f1e9);
		font-family: inherit;
		font-size: 12px;
		padding: 3px 6px;
		text-align: center;
	}
	.pagesize:focus-visible {
		outline: 1px solid var(--at-gold, #eab627);
		outline-offset: 1px;
	}
	.pg-meta {
		font-size: 12.5px;
		font-weight: 500;
		color: var(--at-muted, #8f8a76);
		white-space: nowrap;
	}
</style>
