<!--
  The one spreadsheet body used by every admin table screen: frozen left edge,
  header pinning, column width, which element scrolls — not filters, search,
  paging, export or the page title. Rules it enforces, none a page can opt out of:
  a column is as wide as its content, never narrower than its header or 60px,
  never wider than --adt-colmax (a longer value truncates; a click shows it);
  the frozen edge is cells that TILE, offset from frozenLeft(), or a gap lets
  the scrolling columns show through; the header pins via one box owning both
  axes, capped at `100dvh`.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { type SortState, nextSort } from "./sortRows";
import {
	applyColumnOrder,
	type ColumnPrefs,
	DEFAULT_FIT,
	type FitMode,
	fitMode,
	loadColumnPrefs,
	moveColumn,
	saveColumnPrefs,
	widthStyle,
} from "./columnPrefs";
import { frozenLeft } from "./frozenLeft";
import SegmentedControl from "./SegmentedControl.svelte";

type Props = {
	/** Column keys, in display order. */
	columns: readonly string[];
	/** Human label for a column. Defaults to the key itself. */
	label?: (col: string) => string;
	/** Hover text for a column HEADER — what it counts, or its denominator. */
	headerTitle?: (col: string) => string | undefined;
	/** Columns rendered as an "open it" button — the value is not on the page. */
	peekColumns?: readonly string[];
	rows: readonly Record<string, unknown>[];
	/** Stable per-row identity. Never the array index. */
	rowKey: (row: Record<string, unknown>) => string;
	sort: SortState;
	onSort: (next: SortState) => void;
	/** Leading DATA columns that hold their place; excludes the lead track — that's the component's, not the caller's. */
	frozen?: number;
	/** Rendered ahead of every row, inside the frozen panel. The checkbox. */
	lead?: Snippet<[Record<string, unknown> | null]>;
	/** Width of the `lead` track. */
	leadWidth?: string;
	/** Row numbers from this 0-based offset — pass the PAGE's offset, not a per-page restart ("row 412" can't be quoted otherwise). Omit for none. */
	rowNumberOffset?: number;
	/** A cell was clicked and has something worth showing. */
	onPeek?: (col: string, row: Record<string, unknown>) => void;
	/** Per-column totals, already formatted. A missing key = not numeric. */
	totals?: Record<string, string>;
	/** The Σ row's first cell — the matched total, not this page's row count. */
	totalLabel?: string;
	/** Cell display text. Defaults to the raw value. */
	render?: (col: string, row: Record<string, unknown>) => string;
	/** Full control of a cell's contents for what `render` can't express as text; the cell box, freezing and truncation stay the table's. */
	cell?: Snippet<[string, Record<string, unknown>]>;
	/** Title attribute for a cell — the untruncated value. */
	cellTitle?: (col: string, row: Record<string, unknown>) => string | undefined;
	/** Extra classes for a row, e.g. selection state. */
	rowClass?: (row: Record<string, unknown>) => string;
	/** Drag-to-reorder/resize, remembered under this key. Omit for neither. Key by TABLE NAME, not route, so the table opens arranged the same from any screen. */
	prefsKey?: string;
	/** Rendered in a last, unfrozen cell of every row; `null` for the header. */
	trail?: Snippet<[Record<string, unknown> | null]>;
	/** Rendered full-width under the row whose `rowKey` equals `openKey`. */
	detail?: Snippet<[Record<string, unknown>]>;
	openKey?: string | null;
	/** A click or Enter on the row, not on a control inside it — that one is the control's. */
	onRowClick?: (row: Record<string, unknown>) => void;
};
let {
	columns,
	label = (c) => c,
	headerTitle,
	peekColumns = [],
	rows,
	rowKey,
	sort,
	onSort,
	frozen = 0,
	lead,
	leadWidth = "2.2rem",
	onPeek,
	totals = {},
	rowNumberOffset = undefined,
	totalLabel,
	render,
	cellTitle,
	cell,
	rowClass,
	prefsKey,
	trail,
	detail,
	openKey = null,
	onRowClick,
}: Props = $props();

const CONTROL = "form, button, a, input, select, textarea, label";
const onControl = (t: EventTarget | null) => t instanceof Element && t.closest(CONTROL) !== null;

let colPrefs = $state<ColumnPrefs>({});
let mode = $state<FitMode>(DEFAULT_FIT);
$effect(() => {
	const saved = prefsKey ? loadColumnPrefs(prefsKey) : {};
	colPrefs = saved;
	mode = fitMode(saved);
});

const MODES = [
	{ value: "comfort", label: "Comfort" },
	{ value: "fit", label: "Fit" },
	{ value: "full", label: "Full" },
];

let dragCol = $state<string | null>(null);
let dragOverCol = $state<string | null>(null);
let resizingCol = $state<string | null>(null);

function commitPrefs(next: ColumnPrefs) {
	colPrefs = next;
	if (prefsKey) saveColumnPrefs(prefsKey, next);
}

function onColDragStart(col: string, e: DragEvent) {
	dragCol = col;
	e.dataTransfer?.setData("text/plain", col);
	if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onColDragOver(col: string, e: DragEvent) {
	if (!dragCol || dragCol === col) return;
	e.preventDefault();
	dragOverCol = col;
}

function onColDrop(col: string, e: DragEvent) {
	e.preventDefault();
	if (dragCol && dragCol !== col)
		commitPrefs({ ...colPrefs, order: moveColumn([...allCols], dragCol, col) });
	dragCol = null;
	dragOverCol = null;
}

function onColDragEnd() {
	dragCol = null;
	dragOverCol = null;
}

function startResize(col: string, e: PointerEvent) {
	e.stopPropagation();
	e.preventDefault();
	const th = (e.currentTarget as HTMLElement).closest("th");
	if (!th) return;
	resizingCol = col;
	const startX = e.clientX;
	const startW = th.offsetWidth;
	// Saved once on release, not per pointermove — a write per pixel is a write per pixel.
	const move = (ev: PointerEvent) => {
		const w = Math.max(48, Math.round(startW + ev.clientX - startX));
		colPrefs = { ...colPrefs, widths: { ...colPrefs.widths, [col]: w } };
	};
	const up = () => {
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		resizingCol = null;
		commitPrefs(colPrefs);
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
}

/** Double-click the grip → back to auto width for that column. */
function clearWidth(col: string) {
	const widths = { ...colPrefs.widths };
	delete widths[col];
	commitPrefs({ ...colPrefs, widths });
}

/**
 * A resized column keeps the width it was given — except in Fit, whose widths
 * must sum to exactly one window, so a saved pixel width is ignored there
 * rather than silently breaking the sum.
 */
const headWidth = (c: string, i: number) =>
	mode === "fit"
		? `width: ${fitShares[leadCount + i]}`
		: (widthStyle(colPrefs, c) ?? `min-width: ${autoWidths[c]}`);

// Character widths of the header and cell fonts; each estimate carries its cell padding.
const CH = 0.502;
const SORT_ARROW = 1.6;
const CELL_CH = 0.48;
const CELL_PAD = 1.2;
// The two demands a column makes, in rem, measured once: every mode below is a
// different way of settling between them.
const demands = $derived.by(() => {
	const out: Record<string, { head: number; body: number }> = {};
	for (const c of allCols) {
		let n = 0;
		if (!isPeek(c)) for (const r of rows) n = Math.max(n, text(c, r).length);
		out[c] = {
			head: label(c).length * CH + SORT_ARROW,
			body: n * CELL_CH + CELL_PAD,
		};
	}
	return out;
});
/**
 * MIN-WIDTH, NOT WIDTH, and that is the whole reason this machinery now bites.
 * Under `table-layout: auto` a `width` on a cell is a suggestion the browser
 * weighs against content, and the content here contributes nothing — `.adt-cell`
 * carries `max-width: 0` precisely so a long value cannot widen its column. So
 * every column collapsed to its HEADER's width and the computed estimate was
 * inert: `organizationKey` asked for 400px and rendered at 140px, which is why
 * raising the cap alone moved 1,281 ellipsised cells to 1,275. `min-width` is a
 * floor the auto algorithm has to honour.
 */
const autoWidths = $derived.by(() => {
	const out: Record<string, string> = {};
	for (const c of allCols) {
		const head = demands[c].head.toFixed(2);
		const body = demands[c].body.toFixed(2);
		out[c] = `clamp(max(60px, ${head}rem), ${body}rem, var(--adt-colmax))`;
	}
	return out;
});

// Fit spends ONE window across every column, so a width there is a share of the
// whole rather than a length: percentages under `table-layout: fixed` are the
// only widths that add up to the window exactly, whatever the window is.
// Shares are clamped to a band around the mean because 35 columns cannot each be
// readable, but none may collapse to nothing either — and the band is unit-free,
// so nothing has to be measured to know it fits.
const FIT_FLOOR = 0.62;
const FIT_CEIL = 2.2;
// The two tracks the component owns rather than the caller: their rem widths are
// declared in the style block, and Fit needs them as weights like any column.
const LEAD_WEIGHT = 2.2;
const TRAIL_WEIGHT = 5.5;
const fitShares = $derived.by(() => {
	const weights = [
		...(hasLead ? [LEAD_WEIGHT] : []),
		...allCols.map((c) => Math.max(demands[c].head, demands[c].body)),
		...(trail ? [TRAIL_WEIGHT] : []),
	];
	const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
	const band = weights.map((w) =>
		Math.min(Math.max(w, mean * FIT_FLOOR), mean * FIT_CEIL),
	);
	const total = band.reduce((a, b) => a + b, 0);
	return band.map((w) => `${((w / total) * 100).toFixed(4)}%`);
});

const allCols = $derived(
	applyColumnOrder([...columns, ...peekColumns], colPrefs.order),
);
const isPeek = (c: string) => peekColumns.includes(c);

// Row numbers ride the lead track but don't depend on the `lead` snippet: a
// page wanting a gutter of numbers and no checkboxes gets one.
const hasLead = $derived(Boolean(lead) || rowNumberOffset !== undefined);
const leadCount = $derived(hasLead ? 1 : 0);
const span = $derived(leadCount + allCols.length + (trail ? 1 : 0));
// Clamped: a `frozen` past the last column would freeze the whole table.
// NOTHING IS FROZEN IN FIT, and that is not a compromise: Fit has no horizontal
// overflow, so no column ever slides under another and there is nothing for a
// frozen edge to hold. Worse, a sticky `left` carried over from the scrolling
// layout DISPLACES these cells — a cell whose natural position sits left of its
// own inset gets pushed right, which measured as 32px and 81px gaps between the
// frozen cells rather than the seam they are supposed to tile into.
const frozenTotal = $derived(
	mode !== "fit" && frozen > 0
		? Math.min(frozen, allCols.length) + leadCount
		: 0,
);

function clickSort(col: string) {
	onSort(nextSort(sort, col));
}
const arrow = (c: string) => (sort.col === c ? (sort.asc ? "↑" : "↓") : "↕");

// "—" is the server's rendering of null, and a popup saying "—" answers no
// question anyone asked.
const openable = (s: string) => s !== "" && s !== "—";
const text = (c: string, row: Record<string, unknown>) =>
	render ? render(c, row) : String(row[c] ?? "");

// EACH CELL CARRIES ITS OWN OFFSET, never `nth-child`: header/Σ row/data row
// don't agree on cell count, so the same column is a different nth-child in each.
const frozenLeftVar = (index: number) =>
	index < frozenTotal ? `left: var(--fz${index}, 0px)` : undefined;

const cellStyle = (index: number, bar: string | undefined) =>
	[frozenLeftVar(index), bar].filter(Boolean).join("; ") || undefined;

let wrapEl = $state<HTMLElement | null>(null);
let tableEl = $state<HTMLTableElement | null>(null);
let moreLeft = $state(false);
let moreRight = $state(false);

function readEdges() {
	const el = wrapEl;
	if (!el) return;
	moreLeft = el.scrollLeft > 1;
	moreRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
	// The fades are absolute children of a ZERO-HEIGHT sticky box, so only script
	// knows how far down the visible edge runs. A fixed `100dvh` instead would
	// give a short table scrollable overflow it does not have — a vertical
	// scrollbar on a thirteen-row table.
	el.style.setProperty("--adt-vh", `${el.clientHeight}px`);
}

$effect(() => {
	const el = wrapEl;
	const table = tableEl;
	if (!el || !table) return;
	readEdges();
	// The table's width changes with the mode and with a column drag, not only
	// with the window, and neither fires a scroll event.
	const ro = new ResizeObserver(readEdges);
	ro.observe(el);
	ro.observe(table);
	return () => ro.disconnect();
});

// ONE listener on <tbody>, not one per cell: 500 rows of 34 columns is 17,000
// handlers for a highlight.
let hoverCol = $state<string | null>(null);
function onBodyOver(e: Event) {
	const cell = e.target instanceof Element ? e.target.closest("td") : null;
	hoverCol = cell?.dataset.col ?? null;
}

// `totals` is a SERVER-side sum over every match, so a key present means the
// column is numeric — the bars never have to infer a type from a page of values,
// and an id that happens to be digits is never in it.
const numeric = (v: unknown) => {
	if (typeof v === "number") return Number.isFinite(v) ? v : null;
	if (typeof v !== "string") return null;
	// Values arrive formatted; the separators are the only thing in the way.
	const n = Number(v.replace(/[,\s%]/g, ""));
	return v.trim() !== "" && Number.isFinite(n) ? n : null;
};
// Scale is THIS PAGE's maximum, never the server total: the bar compares the
// rows on screen, which is the only comparison a screenful can support.
const barMax = $derived.by(() => {
	const out: Record<string, number> = {};
	for (const c of allCols) {
		if (!(c in totals)) continue;
		let max = 0;
		for (const r of rows) {
			const n = numeric(r[c]);
			if (n !== null && n > max) max = n;
		}
		if (max > 0) out[c] = max;
	}
	return out;
});
// A SECOND encoding of the number already written in the cell, never the only
// one — so it stays a texture behind the value and never earns a legend.
const barShare = (c: string, row: Record<string, unknown>) => {
	const max = barMax[c];
	if (max === undefined) return undefined;
	const n = numeric(row[c]);
	if (n === null || n <= 0) return undefined;
	return `--adt-bar: ${Math.min(100, (n / max) * 100).toFixed(2)}%`;
};
</script>

<!--
  With the table, never a page prop: which question the grid is answering is the
  TABLE's, and a page free to pin one mode would make "show everything" a
  per-screen accident.
-->
<div class="adt-modes">
	<SegmentedControl
		options={MODES}
		bind:value={mode}
		label="Table width"
		name="adt-fit-{prefsKey ?? 'table'}"
		onchange={() => commitPrefs({ ...colPrefs, fit: mode })}
	/>
</div>

<div
	class="admin-tablewrap adt-wrap"
	bind:this={wrapEl}
	onscroll={readEdges}
>
	<!--
	  Sticky in BOTH axes and zero-height, so the fades track the visible edge
	  without introducing a box that clips: a block child of a scroller is laid
	  out at its CLIENT width, which is exactly the span to be marked, while the
	  table beside it overflows that width freely.
	-->
	<div class="adt-edges" aria-hidden="true">
		<!-- Only when nothing is frozen: a frozen edge already says "there is more
		     to the left", and a fade over held columns would claim they scrolled. -->
		<div class="adt-edge adt-edge-l" class:on={moreLeft && frozenTotal === 0}></div>
		<div class="adt-edge adt-edge-r" class:on={moreRight}></div>
	</div>
	<table
		class="admin-table adt"
		class:adt-fit={mode === "fit"}
		class:adt-full={mode === "full"}
		bind:this={tableEl}
		use:frozenLeft={frozenTotal}
	>
		<thead>
			<tr>
				{#if hasLead}
					<th
						class="admin-th adt-lead"
						class:adt-frozen={frozenTotal > 0}
						class:adt-seam={frozenTotal === 1}
						style="width: {mode === 'fit'
							? fitShares[0]
							: leadWidth}; {frozenLeftVar(0) ?? ''}"
					>
						{#if lead}{@render lead(null)}{/if}
					</th>
				{/if}
				{#each allCols as c, i (c)}
					{#if isPeek(c)}
						<!-- Not sortable: the value was never fetched with the page. -->
						<th
							class="admin-th adt-peek-th"
							class:adt-frozen={i + leadCount < frozenTotal}
							class:adt-seam={i + leadCount === frozenTotal - 1}
							class:adt-colhover={hoverCol === c}
							style="{headWidth(c, i)}; {frozenLeftVar(i + leadCount) ?? ''}"
							title="{label(c)} — open from a row">{label(c)}</th
						>
					{:else}
						<th
							class="admin-th adt-th"
							class:adt-frozen={i + leadCount < frozenTotal}
							class:adt-seam={i + leadCount === frozenTotal - 1}
							class:sorted={sort.col === c}
							class:adt-dragover={dragOverCol === c}
							class:adt-colhover={hoverCol === c}
							aria-sort={sort.col === c
								? sort.asc
									? "ascending"
									: "descending"
								: undefined}
							style="{headWidth(c, i)}; {frozenLeftVar(i + leadCount) ?? ''}"
							title={headerTitle?.(c)}
							onclick={() => clickSort(c)}
							draggable={prefsKey ? resizingCol === null : undefined}
							ondragstart={prefsKey
								? (e: DragEvent) => onColDragStart(c, e)
								: undefined}
							ondragover={prefsKey
								? (e: DragEvent) => onColDragOver(c, e)
								: undefined}
							ondrop={prefsKey ? (e: DragEvent) => onColDrop(c, e) : undefined}
							ondragend={prefsKey ? onColDragEnd : undefined}
						>
							{label(c)}<span class="arr">{arrow(c)}</span>
							{#if prefsKey && mode !== "fit"}
								<!-- No grip in Fit: the widths there are shares of one window, so a
								     dragged pixel width would be ignored the moment it was saved.
								     Sibling of the label, not a wrapper, so a drag on it never starts
								     a column drag. -->
								<span
									class="adt-grip"
									role="separator"
									aria-orientation="vertical"
									aria-label="Resize {label(c)}"
									title="Drag to resize — double-click for auto width"
									onpointerdown={(e: PointerEvent) => startResize(c, e)}
									ondblclick={(e: MouseEvent) => {
										e.stopPropagation();
										clearWidth(c);
									}}
								></span>
							{/if}
						</th>
					{/if}
				{/each}
				{#if trail}<th
						class="admin-th adt-trail"
						style={mode === "fit"
							? `width: ${fitShares[fitShares.length - 1]}`
							: undefined}>{@render trail(null)}</th
					>{/if}
			</tr>
			<!-- A Σ over nothing says nothing, so an empty table shows headers and stops. -->
			{#if totalLabel !== undefined && rows.length > 0}
				<!-- INSIDE <thead> so it stays with the head band on re-sort; `.subtotal` keeps it out of the sticky rule. -->
				<tr class="subtotal">
					{#if hasLead}<th
							class="sub"
							class:adt-frozen={frozenTotal > 0}
							style={frozenLeftVar(0)}
						></th>{/if}
					{#each allCols as c, i (c)}
						<th
							class="sub adt-sub"
							class:adt-frozen={i + leadCount < frozenTotal}
							class:adt-seam={i + leadCount === frozenTotal - 1}
							style={frozenLeftVar(i + leadCount)}
							title={i === 0 ? totalLabel : totals[c]}
						>
							{#if i === 0}<span class="adt-sig">Σ</span>{totalLabel}
							{:else if totals[c]}<span class="adt-sig">Σ</span>{totals[c]}{/if}
						</th>
					{/each}
					{#if trail}<th class="sub adt-sub"></th>{/if}
				</tr>
			{/if}
		</thead>
		<!-- `focusin`, not `focus`: focus does not bubble, and the point of one
		     delegated listener is that it is not 17,000 of them. Tabbing through a
		     row's cell buttons lights the same header a pointer would. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<tbody
			onmouseover={onBodyOver}
			onmouseleave={() => (hoverCol = null)}
			onfocusin={onBodyOver}
			onfocusout={() => (hoverCol = null)}
		>
			<!-- Keyed by identity, never index: a re-sort/page change would otherwise leave a tick on the wrong row. -->
			{#each rows as row, rowIx (rowKey(row))}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<tr
					class={rowClass?.(row) ?? ""}
					class:adt-clickable={!!onRowClick}
					tabindex={onRowClick ? 0 : undefined}
					onclick={onRowClick
						? (e) => {
								if (!onControl(e.target)) onRowClick(row);
							}
						: undefined}
					onkeydown={onRowClick
						? (e) => {
								if (onControl(e.target) || (e.key !== "Enter" && e.key !== " ")) return;
								e.preventDefault();
								onRowClick(row);
							}
						: undefined}
				>
					{#if hasLead}<td
							class="adt-lead"
							class:adt-frozen={frozenTotal > 0}
							class:adt-seam={frozenTotal === 1}
							style={frozenLeftVar(0)}
						>{#if lead}{@render lead(row)}{/if}{#if rowNumberOffset !== undefined}<span
									class="adt-rownum">{(rowNumberOffset + rowIx + 1).toLocaleString()}</span
								>{/if}</td>{/if}
					{#each allCols as c, i (c)}
						{@const bar = barShare(c, row)}
						<td
							class="adt-cell"
							class:adt-frozen={i + leadCount < frozenTotal}
							class:adt-seam={i + leadCount === frozenTotal - 1}
							class:adt-bar={bar !== undefined}
							data-col={c}
							style={cellStyle(i + leadCount, bar)}
							title={cellTitle?.(c, row)}
						>
							{#if isPeek(c)}
								<!-- Unconditional: the value is not present to test for emptiness. -->
								<button
									type="button"
									class="adt-peek-btn"
									onclick={() => onPeek?.(c, row)}
									aria-label="Open {label(c)}">{"{…}"}</button
								>
							{:else if onPeek && openable(text(c, row))}
								<!-- <button>, not a <span> with a click handler (unreachable by keyboard), stripped of button affordance or 500 of them read as a form. -->
								<button type="button" class="adt-cell-btn" onclick={() => onPeek(c, row)}>
									{#if cell}{@render cell(c, row)}{:else}{text(c, row)}{/if}
								</button>
							{:else if cell}
								{@render cell(c, row)}
							{:else}
								{text(c, row)}
							{/if}
						</td>
					{/each}
					{#if trail}<td class="adt-trail">{@render trail(row)}</td>{/if}
				</tr>
				{#if detail && openKey !== null && openKey === rowKey(row)}
					<tr class="adt-detail">
						<td colspan={span}>{@render detail(row)}</td>
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
</div>

<style>
	.adt-th[draggable="true"] {
		cursor: pointer;
	}
	/* Where the dragged column would land — a left edge, since a drop puts the column BEFORE this one. */
	.adt-dragover {
		box-shadow: inset 2px 0 0 var(--at-gold, #eab627);
	}
	.adt-grip {
		position: absolute;
		top: 0;
		right: 0;
		width: 7px;
		height: 100%;
		cursor: col-resize;
		touch-action: none;
	}
	.adt-grip:hover {
		background: color-mix(in srgb, var(--at-gold, #eab627), transparent 60%);
	}
	.adt-th {
		position: relative;
	}

	/* Row number is a coordinate for pointing at a row, not data — must never compete with the values beside it. Tabular figures so it doesn't jitter. */
	.adt-rownum {
		margin-left: 5px;
		font-size: 9.5px;
		font-variant-numeric: tabular-nums;
		color: #5f5b50;
		user-select: none;
	}
	/* Overrides the shared sheet's `width: 100%`, which would leave nothing to scroll sideways. */
	.adt {
		width: auto;
		--adt-colmax: 400px;
	}
	@media (max-width: 1280px) {
		.adt {
			--adt-colmax: 320px;
		}
	}
	/* FULL: the cap stops being what hides a value and becomes only a stop against
	   a pathological one. 1200px is about 155 monospace characters — past any
	   name, slug, URL, address or email in these tables, and still bounded.
	   IT CANNOT BE UNCAPPED: `organizationDesc` holds 1,515 characters, which asks
	   for an 11,650px column and a table around 25,000px wide, and exercising that
	   froze the renderer twice while measuring this card. A value that long is not
	   read in a one-line cell in any mode — clicking it opens `JsonPeek`, which is
	   what the header comment promises. */
	.adt-full {
		--adt-colmax: 1200px;
	}
	/* FIT: `fixed` is what makes the percentage shares binding — under auto layout
	   the browser re-derives widths from content and the sum stops being one
	   window. `width: 100%` then takes back the `width: auto` above, because in
	   this mode there is deliberately nothing to scroll sideways. */
	.adt-fit {
		table-layout: fixed;
		width: 100%;
	}
	.adt :global(th) {
		box-sizing: border-box;
	}
	/* Full-bleed. NO LEFT PADDING: padding on a scroller travels with the
	   scrolling columns, leaving a transparent strip a frozen cell's edge
	   would show through — the gutter lives on the first cell instead. */
	.adt-wrap {
		/* Under CSS `zoom` a vw is still pre-zoom, so it is divided back out or the table starts off-screen. */
		margin-inline: calc(50% - 50vw / var(--page-zoom, 1));
		padding-inline: 0 24px;
	}

	.adt-th {
		cursor: pointer;
		user-select: none;
	}
	/* A header must not wrap — a wrapped header would silently make every row in the table taller. */
	.adt :global(th),
	.adt-cell {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.adt-cell {
		font-family: var(--rt-font-mono, ui-monospace, Menlo, monospace);
		font-size: 12.5px;
		max-width: 0;
	}
	/* `max-width: 0` stops text widening a column but not a block of controls.
	   Blocks only: containing an inline-block (a pill, a button) sizes it to 0. */
	.adt-cell > :global(div) {
		contain: inline-size;
	}

	/* THE FROZEN LEFT EDGE: these cells hold their place while everything else
	   slides under them. THE INSET SHADOW IS AN OPAQUE FLOOR, not decoration —
	   the scrolling columns pass UNDERNEATH, so a plain `background` per state
	   would leave a hole for any state nobody enumerated; every rule below
	   repeats the shadow rather than replacing it. Z stack: sliding body 0,
	   sliding header 5, frozen body 7 (must beat the sliding HEADER), frozen
	   header 8 — frozen always beats sliding on both axes, or a column name
	   could travel across the frozen edge. */
	.adt :global(td.adt-frozen),
	.adt :global(th.adt-frozen) {
		position: sticky;
		z-index: 7;

		background: var(--at-bg);
		box-shadow: inset 0 0 0 100vmax var(--at-bg);
	}
	/* `!important` is the point: the shared sheet pins headers at z-index 5 with
	   a more specific selector, so without it the frozen header ties with the
	   sliding ones and a later column paints over it. */
	.adt :global(thead th.adt-frozen) {
		z-index: 8 !important;
		background: var(--at-inset);
		box-shadow: inset 0 0 0 100vmax var(--at-inset);
	}
	/* THE HEAD BAND IS ONE PLANE, and a frozen header cell has to carry it too.
	   The shared sheet gives the band `--at-lift-2` + `--at-edge-hi`, but a frozen
	   cell declares its own `box-shadow` and that is ONE property with one winner
	   — so without restating them the band's shadow visibly breaks over the frozen
	   columns, and no sliding cell can cast across them either (frozen outranks
	   sliding on both axes, by design). The floor stays LAST: earlier layers paint
	   on top, so the lit top edge has to sit above the opaque backing to be seen
	   at all. The Σ row is excluded because it is not part of the band. */
	.adt :global(thead tr:not(.subtotal) th.adt-frozen) {
		box-shadow: var(--at-lift-2), var(--at-edge-hi),
			inset 0 0 0 100vmax var(--at-inset);
	}
	.adt :global(tr.subtotal th.adt-frozen) {
		background: var(--at-panel);
		box-shadow: inset 0 0 0 100vmax var(--at-panel);
	}
	.adt :global(tbody tr:hover td.adt-frozen) {
		background: var(--at-hover);
		box-shadow: inset 0 0 0 100vmax var(--at-hover);
	}
	/* Without this a ticked row's highlight stops at the frozen seam (the floor
	   paints over the shared sheet's background). After hover in source order,
	   so a ticked row stays ticked-coloured under the pointer. */
	.adt :global(tbody tr.row-selected td.adt-frozen) {
		background: var(--at-selected);
		box-shadow: inset 0 0 0 100vmax var(--at-selected);
	}
	.adt :global(tbody tr.row-selected td.adt-seam) {
		box-shadow: var(--at-lift-1), inset 0 0 0 100vmax var(--at-selected);
	}
	/* Marks where the sliding half begins, or the two halves read as one grid
	   whose left columns stopped moving. Each variant repeats the floor since
	   `box-shadow` is ONE property — a bare seam rule blanks the hiding layer.
	   `--at-lift-1` is the house's one sideways cast; the seam is what it is for. */
	.adt :global(td.adt-seam) {
		box-shadow: var(--at-lift-1), inset 0 0 0 100vmax var(--at-bg);
	}
	/* Carries the band's plane as well as the seam — see the frozen header rule.
	   Scoped past `.subtotal` so it still outranks it on an equal-specificity tie. */
	.adt :global(thead tr:not(.subtotal) th.adt-seam) {
		box-shadow: var(--at-lift-2), var(--at-edge-hi), var(--at-lift-1),
			inset 0 0 0 100vmax var(--at-inset);
	}
	.adt :global(tr.subtotal th.adt-seam) {
		box-shadow: var(--at-lift-1), inset 0 0 0 100vmax var(--at-panel);
	}
	.adt :global(tbody tr:hover td.adt-seam) {
		box-shadow: var(--at-lift-1), inset 0 0 0 100vmax var(--at-hover);
	}

	/* Page gutter carried by the row's FIRST cell, not the scroller (see
	   .adt-wrap) — on every frozen column it would open a 24px gap before each one. */
	.adt :global(tr > *:first-child) {
		padding-left: 24px;
	}

	.adt-trail {
		width: 5.5rem;
		text-align: right;
	}
	.adt :global(tbody tr.adt-detail),
	.adt :global(tbody tr.adt-detail:hover) {
		background: color-mix(in srgb, var(--at-selected), var(--at-bg) 45%);
	}
	.adt :global(tr.adt-detail > td) {
		white-space: normal;
		box-shadow: inset 2px 0 0 var(--at-gold, #eab627);
		border-bottom-color: color-mix(in srgb, var(--at-gold, #eab627), transparent 65%);
	}

	.adt-clickable {
		cursor: pointer;
	}
	.adt-clickable:focus-visible {
		outline: 1px solid var(--at-gold, #eab627);
		outline-offset: -1px;
	}

	.adt-lead {
		width: 2.2rem;
		text-align: center;
	}

	.adt-cell-btn {
		display: block;
		width: 100%;
		border: 0;
		padding: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.adt-cell-btn:hover {
		color: var(--at-th-hover, #eab627);
	}
	.adt-cell-btn:focus-visible {
		outline: 1px solid var(--at-gold, #eab627);
		outline-offset: 1px;
	}

	/* The Σ label is prose; left to size its column it widened Orgs' first one to 430px. */
	.adt-sub {
		max-width: 0;
		cursor: default;
		font-family: var(--rt-font-mono, ui-monospace, Menlo, monospace);
	}
	.adt-sig {
		opacity: 0.55;
		font-weight: 500;
		margin-right: 0.35em;
	}

	/* Full-bleed like the scroller below it, and gutter-aligned with the row's
	   first cell so the control sits on the grid's own left edge. */
	.adt-modes {
		margin-inline: calc(50% - 50vw / var(--page-zoom, 1));
		padding: 0 24px 8px;
		display: flex;
		justify-content: flex-end;
	}

	.adt-edges {
		position: sticky;
		top: 0;
		left: 0;
		height: 0;
		z-index: 9;
		pointer-events: none;
	}
	/* Above the frozen header's 8: an edge that columns disappeared under has to
	   be the last thing painted, or the thing it marks paints over it. */
	.adt-edge {
		position: absolute;
		top: 0;
		width: 30px;
		height: var(--adt-vh, 0px);
		opacity: 0;
		transition: opacity 160ms ease;
	}
	.adt-edge.on {
		opacity: 1;
	}
	/* The floor colour, not black: the fade says "this continues", and a darker
	   than the page edge would read as a border instead. */
	.adt-edge-l {
		left: 0;
		background: linear-gradient(to right, var(--at-bg), transparent);
	}
	.adt-edge-r {
		right: 0;
		background: linear-gradient(to left, var(--at-bg), transparent);
	}

	/* Which column the pointer is in, legible across a 4000px table. COLOUR ONLY:
	   a frozen header's `box-shadow` is its opaque floor and a `background` there
	   is painted over by it, so anything but ink would light the sliding columns
	   and silently skip the frozen ones. */
	.adt :global(thead th.adt-colhover),
	.adt :global(thead th.adt-colhover .arr) {
		color: var(--at-th-hover, #eab627);
	}

	/* A column's distribution BEHIND its value, never instead of it. `background-image`
	   rather than `background`, so the row's own hover colour still shows through
	   from underneath — and a frozen cell's opaque floor is an inset shadow, which
	   paints ABOVE the background, so the identifier columns stay clean for free. */
	.adt-cell.adt-bar {
		background-image: linear-gradient(
			to right,
			color-mix(in srgb, var(--at-gold, #eab627), transparent 89%) 0 var(--adt-bar),
			transparent var(--adt-bar)
		);
		background-repeat: no-repeat;
	}

	.adt-peek-th {
		opacity: 0.5;
		cursor: default;
	}
	.adt-peek-btn {
		border: 1px solid var(--at-line);
		background: transparent;
		color: var(--at-accent);
		border-radius: 4px;
		padding: 0 0.4rem;
		font-family: var(--rt-font-mono, ui-monospace, Menlo, monospace);
		font-size: 12px;
		line-height: 1.7;
		cursor: pointer;
	}
	.adt-peek-btn:hover {
		border-color: var(--at-gold, #eab627);
	}
</style>
