<!--
  Every table as a card on one pannable, zoomable sheet — Fit puts the whole
  schema on screen at whatever scale keeps colours legible, so you find the
  red then zoom into it.

  Layout is columnar and COMPUTED, not stored: cards flow top-to-bottom into
  four columns, tallest first or by `seats`, with no remembered positions. The colour
  answers "what is empty" wherever a card sits, so a stable layout (learn
  where a table lives, it stays there) beats a clever one.
-->
<script lang="ts">
import {
	type Band,
	BAND_LABEL,
	expectationOf,
	healthOf,
	type SchemaLink,
	type TableFill,
	tableEmpty,
} from "./schemaBands";

let {
	tables,
	links,
	activeKeys,
	purposes = {},
	onPickTable,
	seats,
}: {
	tables: TableFill[];
	links: SchemaLink[];
	/** `Table.column` ids currently switched ON in the key-attribute panel. */
	activeKeys: ReadonlySet<string>;
	/** Model name → the one-line "what is this for", from the data dictionary. */
	purposes?: Record<string, string>;
	onPickTable?: (model: string) => void;
	/** A fixed seating plan by table name, read four to a row. */
	seats?: readonly string[];
} = $props();

// Fixed sizes in sheet units; the sheet scales as a whole so rendering never
// has to ask the browser how big anything ended up.
const CARD_W = 230;
const HEAD_H = 30;
const ROW_H = 17;
const CARD_GAP_X = 60;
const CARD_GAP_Y = 26;
const PAD = 40;

/**
 * Purpose line's box height, fixed and clamped: card geometry is computed
 * by the packer, so a height that varied with sentence length would shift
 * every card and FK line below it.
 */
const WHY_H = 25;

const whyHeight = (t: TableFill) => (purposes[t.model] ? WHY_H : 0);

const cardHeight = (t: TableFill) =>
	HEAD_H + whyHeight(t) + t.columns.length * ROW_H + 8;

// With a seating plan, slot i sits in column i % 4 whatever the heights, so
// two databases with the same tables draw them in the same places. Unplanned
// tables follow in name order. Without one: tallest first, shortest column.
const COLUMNS = 4;
const placed = $derived.by(() => {
	const heights = Array<number>(COLUMNS).fill(PAD);
	const slot = new Map(seats?.map((m, i) => [m, i]));
	const extra = tables.filter((t) => !slot.has(t.model)).sort((a, b) => a.model.localeCompare(b.model));
	for (const [i, t] of extra.entries()) slot.set(t.model, (seats?.length ?? 0) + i);
	const ordered = seats
		? [...tables].sort((a, b) => (slot.get(a.model) ?? 0) - (slot.get(b.model) ?? 0))
		: [...tables].sort((a, b) => cardHeight(b) - cardHeight(a));
	return ordered.map((t) => {
		let col = 0;
		if (seats) col = (slot.get(t.model) ?? 0) % COLUMNS;
		else for (let i = 1; i < COLUMNS; i++) if (heights[i] < heights[col]) col = i;
		const y = heights[col];
		heights[col] += cardHeight(t) + CARD_GAP_Y;
		return {
			table: t,
			x: PAD + col * (CARD_W + CARD_GAP_X),
			y,
			h: cardHeight(t),
		};
	});
});

const sheet = $derived.by(() => ({
	w: PAD * 2 + COLUMNS * CARD_W + (COLUMNS - 1) * CARD_GAP_X,
	h: PAD + Math.max(...placed.map((p) => p.y + p.h), 0) + PAD,
}));

/** Where each card ended up, by model name — the anchor for the FK lines. */
const byModel = $derived(new Map(placed.map((p) => [p.table.model, p])));

/** Which row of a card a column sits on, so an FK line lands on the column
 *  it actually constrains rather than the card in general. */
function rowY(model: string, column: string): number | null {
	const p = byModel.get(model);
	if (!p) return null;
	const i = p.table.columns.findIndex((c) => c.column === column);
	if (i < 0) return null;
	return p.y + HEAD_H + whyHeight(p.table) + i * ROW_H + ROW_H / 2;
}

// FK lines as cubic curves; control points offset on x only so they leave
// and enter horizontally and read as row-to-row connections. No obstacle
// routing — a card left of its target just runs the curve backwards.
const edges = $derived.by(() =>
	links
		.map((l) => {
			const from = byModel.get(l.from);
			const to = byModel.get(l.to);
			if (!from || !to) return null;
			const y1 = rowY(l.from, l.field);
			const y2 = rowY(l.to, l.ref);
			if (y1 === null || y2 === null) return null;

			// Leave from whichever side of the card faces the target, so a
			// line never crosses back over the card it starts on.
			const leftward = to.x < from.x;
			const x1 = leftward ? from.x : from.x + CARD_W;
			const x2 = leftward ? to.x + CARD_W : to.x;
			const bend = Math.max(40, Math.abs(x2 - x1) * 0.4);
			const c1 = leftward ? x1 - bend : x1 + bend;
			const c2 = leftward ? x2 + bend : x2 - bend;

			return {
				id: `${l.from}.${l.field}->${l.to}.${l.ref}`,
				d: `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`,
				self: l.from === l.to,
			};
		})
		.filter((e): e is NonNullable<typeof e> => e !== null),
);

let viewport = $state<HTMLDivElement | null>(null);
let scale = $state(1);
let tx = $state(0);
let ty = $state(0);

const MIN_SCALE = 0.08;
const MAX_SCALE = 2.5;
const clamp = (n: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));

// Refuses a zero box: ResizeObserver's first callback fires before layout
// gives the element a size, so `r.width` is 0 and `scale(0)` would collapse
// every card to nothing.
export function fit() {
	if (!viewport) return;
	const r = viewport.getBoundingClientRect();
	if (r.width < 1 || r.height < 1) return;
	if (sheet.w < 1 || sheet.h < 1) return;
	const s = clamp(Math.min(r.width / sheet.w, r.height / sheet.h) * 0.96);
	scale = s;
	tx = (r.width - sheet.w * s) / 2;
	ty = (r.height - sheet.h * s) / 2;
}

// Zoom about the cursor point, or content shoots off screen on every zoom.
function zoomAt(clientX: number, clientY: number, factor: number) {
	if (!viewport) return;
	const r = viewport.getBoundingClientRect();
	const px = clientX - r.left;
	const py = clientY - r.top;
	const next = clamp(scale * factor);
	const k = next / scale;
	tx = px - (px - tx) * k;
	ty = py - (py - ty) * k;
	scale = next;
}

export function zoomBy(factor: number) {
	if (!viewport) return;
	const r = viewport.getBoundingClientRect();
	zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
}

function onWheel(e: WheelEvent) {
	// A trackpad pinch arrives as ctrl/meta+wheel, same as the browser's own
	// page zoom — intercepting it makes pinch-to-zoom scale the sheet instead.
	if (e.ctrlKey || e.metaKey) {
		e.preventDefault();
		zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
		return;
	}
	e.preventDefault();
	tx -= e.deltaX;
	ty -= e.deltaY;
}

let dragging = $state(false);
function onPointerDown(e: PointerEvent) {
	if (e.button !== 0) return;
	dragging = true;
	(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onPointerMove(e: PointerEvent) {
	if (!dragging) return;
	tx += e.movementX;
	ty += e.movementY;
}
function onPointerUp(e: PointerEvent) {
	dragging = false;
	(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
}

// A flag, not inferred from the transform: `scale===1 && tx===0 && ty===0`
// is also true of a zero-sized viewport and of a reader who panned back to
// the origin, so either would wrongly re-trigger the fit.
let fitted = $state(false);

$effect(() => {
	if (!viewport) return;
	const ro = new ResizeObserver(() => {
		if (fitted) return;
		const r = viewport?.getBoundingClientRect();
		if (!r || r.width < 1 || r.height < 1) return;
		fit();
		fitted = true;
	});
	ro.observe(viewport);
	return () => ro.disconnect();
});

// With no rows, every column is 0 filled — same as any other empty column,
// so this doesn't dim a whole-table-empty column differently.
function cellBand(t: TableFill, column: string, filled: number): Band {
	return healthOf(
		t.rows === 0 ? 0 : filled / t.rows,
		expectationOf(t.model, column, activeKeys),
	).band;
}

const pct = (filled: number, rows: number) =>
	rows === 0 ? "—" : `${Math.round((filled / rows) * 100)}%`;
</script>

<div
	class="canvas"
	bind:this={viewport}
	class:dragging
	onwheel={onWheel}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	role="application"
	aria-label="Schema map"
>
	<div
		class="sheet"
		style="width:{sheet.w}px; height:{sheet.h}px; transform: translate({tx}px, {ty}px) scale({scale}); transform-origin: 0 0;"
	>
		<!-- Drawn first, under the cards: a wire occluded by a card reads as
		     passing behind it rather than terminating there. -->
		<svg class="wires" width={sheet.w} height={sheet.h} aria-hidden="true">
			{#each edges as e (e.id)}
				<path d={e.d} class="wire" class:self={e.self} />
			{/each}
		</svg>

		{#each placed as p (p.table.model)}
			{@const empty = tableEmpty(p.table.rows)}
			<div
				class="card"
				class:empty
				style="left:{p.x}px; top:{p.y}px; width:{CARD_W}px;"
			>
				<button
					class="card-head"
					style="height:{HEAD_H}px"
					onclick={() => onPickTable?.(p.table.model)}
					title={purposes[p.table.model]
						? `${p.table.model} — ${purposes[p.table.model]}\n\nClick to open in the table viewer.`
						: `Open ${p.table.model} in the table viewer`}
				>
					<span class="card-name">{p.table.model}</span>
					<span class="card-rows">
						{#if p.table.error}
							!
						{:else if !p.table.scoped}
							{p.table.rows.toLocaleString()}
						{:else}
							{p.table.rows.toLocaleString()}<span class="of"
								>/{p.table.rowsAllSites.toLocaleString()}</span
							>
						{/if}
					</span>
				</button>

				<!-- A card is a name and column list, which says nothing about the
				     table's JOB — this line answers that from the data dictionary. -->
				{#if purposes[p.table.model]}
					<p class="card-why" style="height:{WHY_H}px">
						{purposes[p.table.model]}
					</p>
				{/if}

				{#each p.table.columns as c (c.column)}
					{@const b = cellBand(p.table, c.column, c.filled)}
					<div
						class="row band-{b}"
						style="height:{ROW_H}px"
						title="{p.table.model}.{c.column} — {pct(
							c.filled,
							p.table.rows,
						)} filled ({c.filled.toLocaleString()} of {p.table.rows.toLocaleString()}) · {BAND_LABEL[
							b
						]}"
					>
						<span class="col-name">{c.column}</span>
						<span class="col-pct">{pct(c.filled, p.table.rows)}</span>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.canvas {
		position: relative;
		overflow: hidden;
		width: 100%;
		height: 100%;
		background: var(--at-bg, #0c0c0c);
		/* Without this texture, panning reads as the cards being dragged
		   rather than the view moving. */
		background-image: radial-gradient(
			circle at 1px 1px,
			rgb(255 255 255 / 6%) 1px,
			transparent 0
		);
		background-size: 22px 22px;
		cursor: grab;
		/* Otherwise the admin page scrolls under the map while it stands still. */
		touch-action: none;
		overscroll-behavior: contain;
	}
	.canvas.dragging {
		cursor: grabbing;
	}
	.sheet {
		position: absolute;
		top: 0;
		left: 0;
		/* Text renders at the scaled size instead of rasterising at 1× and
		   stretching — mushy at a 2× zoom otherwise. */
		will-change: transform;
	}
	.wires {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.wire {
		fill: none;
		stroke: rgb(201 122 74 / 45%);
		stroke-width: 1.2;
	}
	.wire.self {
		stroke-dasharray: 3 3;
	}

	.card {
		position: absolute;
		border-radius: 6px;
		border: 1px solid var(--at-line, #262626);
		background: var(--at-inset, #111);
		overflow: hidden;
		font-size: 11px;
		/* Must stay opaque — wires run beneath the cards. */
		box-shadow: 0 2px 10px rgb(0 0 0 / 45%);
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		width: 100%;
		padding: 0 8px;
		border: 0;
		border-bottom: 1px solid var(--at-line, #262626);
		background: rgb(255 255 255 / 4%);
		color: var(--at-fg, #fafafa);
		font: inherit;
		font-weight: 700;
		cursor: pointer;
		text-align: left;
	}
	.card-head:hover {
		background: rgb(234 182 39 / 12%);
	}
	.card-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.card-rows {
		flex: none;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--at-muted, #8f8a76);
	}
	.of {
		opacity: 0.55;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 0 8px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 9.5px;
		line-height: 1;
		color: var(--at-fg, #fafafa);
	}
	.col-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.col-pct {
		flex: none;
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}

	/* Colour is the only severity signal, so steps must be told apart at a
	   fitted zoom where a cell is a few pixels tall. KEY bands are saturated;
	   ordinary ones are the same hues heavily muted. */
	.band-empty-key {
		background: rgb(192 57 43 / 55%);
		color: #fff;
	}
	.band-partial-key {
		background: rgb(244 211 94 / 34%);
	}
	/* Translucent so twenty cards of it stay a texture rather than a wash. */
	.band-empty {
		background: rgb(200 165 9 / 62%);
	}
	.band-partial {
		background: rgb(244 211 94 / 11%);
	}
	.band-full {
		background: rgb(90 170 110 / 13%);
	}
	/* Deliberately quiet — reference, not a finding; must not compete with
	   the colours it sits above. */
	.card-why {
		margin: 0;
		padding: 3px 6px;
		box-sizing: border-box;
		font-size: 8px;
		line-height: 1.3;
		color: #7d7768;
		border-bottom: 1px solid rgb(255 255 255 / 6%);
		/* Clamped, never grown — height is load-bearing (WHY_H). Full text
		   is on the card's hover title. */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* A border only — rows are already yellow on their own, so this adds just
	   the fact they can't carry: that it's the WHOLE table. A box-shadow ring
	   rather than a thicker border: `.card` is content-box, so border-width
	   is card geometry and would knock rows off their wires. */
	.card.empty {
		border-color: rgb(224 90 72);
		box-shadow:
			0 0 0 1px rgb(224 90 72) inset,
			0 0 0 2px rgb(224 90 72 / 40%),
			0 2px 10px rgb(0 0 0 / 45%);
	}

</style>
