<!-- Body gated on counted (editable deck vs read-only); header Edit/Share gated on the plot EXISTING, never its count. -->
<script lang="ts">
import { iconPath } from "../shared/icons";
import type { Feature } from "geojson";
import { onDestroy, onMount } from "svelte";
import { fade } from "svelte/transition";
import MapPopoverShell from "../panels/MapPopoverShell.svelte";
import type {
	MapHostPorts,
	MapQ704DeckExports,
	MapQ704PlotPinData,
	MapQ704PlotRow,
	MapShareFormat,
} from "../shared/mapHostPorts";

let {
	ports,
	feature = null,
	pendingPlotNo = null,
	bbox,
	containerWidth,
	containerHeight,
	onShare,
	onClose,
	onOpenInForm,
}: {
	/** A host with no inspections leaves q704 out and this popover renders nothing. */
	ports: MapHostPorts;
	/** VIEW mode: an existing plot's pin. */
	feature?: Feature | null;
	/** CREATE mode: no pin exists until the count is swiped and written. */
	pendingPlotNo?: number | null;
	bbox: { minX: number; minY: number; maxX: number; maxY: number };
	containerWidth: number;
	containerHeight: number;
	onShare: (format: MapShareFormat) => void;
	onClose: () => void;
	onOpenInForm: (plotNo: number) => void;
} = $props();

// const so {#if q704} narrows in nested blocks.
const q704 = $derived(ports.q704);
function atvShare(node: HTMLElement) {
	return q704 ? q704.atvShare(node) : undefined;
}

// Never discard a plot on unmount: only the host's "cancel plot" gate discards.
const mapFeatureKey = $derived((feature?.properties?.mapFeatureKey as string) ?? "");
const isCreate = $derived(pendingPlotNo != null);
// plotByGpsKey reads the store imperatively; plotVersion must bump after every write or `counted` freezes.
let plotVersion = $state(0);
const plot = $derived.by<MapQ704PlotPinData | null>(() => {
	void plotVersion;
	if (!q704) return null;
	if (isCreate) return q704.pendingDropPinData();
	return mapFeatureKey ? q704.plotByGpsKey(mapFeatureKey) : null;
});

// Fallback when the row lookup misses: the pin's own type key (`plot:N`).
const pinPlotNo = $derived.by(() => {
	if (isCreate) return pendingPlotNo ?? 0;
	const k = (feature?.properties?.pinTypeKey as string) ?? "";
	const m = k.match(/^plot:(\d+)$/);
	return m ? Number(m[1]) : 0;
});
// Stored survey-local number: the stable key, NOT shown to the user.
const plotNo = $derived(plot?.plotNo || pinPlotNo);
// The per-map number the user sees; re-flows as surveys merge.
const displayNo = $derived(plot?.displayNo || plot?.plotNo || pinPlotNo);
// Needs a plot that EXISTS and a number, never a count. There is no plot zero.
const canOpenInForm = $derived(
	!isCreate && Number.isInteger(plotNo) && plotNo > 0,
);

const plotFullCode = $derived(q704 ? q704.plotFullCodeByGpsKey(mapFeatureKey) : "");
// The locally-varying tail (87G3H2PG+QFG → 2PG+QFG).
const plotShortCode = $derived.by(() => {
	const plus = plotFullCode.indexOf("+");
	if (plus < 0) return "";
	return plotFullCode.slice(Math.max(0, plus - 3));
});
let loCodeCopied = $state(false);
let loCodeCopyFailed = $state(false);
let loCodeCopiedTimer: ReturnType<typeof setTimeout> | null = null;
async function copyLoCode() {
	if (!plotFullCode) return;
	const ok = await ports.ui.copyToClipboard(plotFullCode);
	loCodeCopied = ok;
	loCodeCopyFailed = !ok;
	if (loCodeCopiedTimer) clearTimeout(loCodeCopiedTimer);
	loCodeCopiedTimer = setTimeout(() => {
		loCodeCopied = false;
		loCodeCopyFailed = false;
		loCodeCopiedTimer = null;
	}, 1400);
}

const counted = $derived(plot != null && plot.planted != null);

const planted = $derived(plot?.planted ?? 0);
const spots = $derived(plot?.spots ?? 0);
const excess = $derived(plot?.excess ?? 0);
const short = $derived(Math.max(0, spots - planted));
const faultCount = $derived(plot?.faults.length ?? 0);
const faultGroups = $derived.by<[string, number][]>(() => {
	const m = new Map<string, number>();
	for (const code of plot?.faults ?? []) m.set(code, (m.get(code) ?? 0) + 1);
	return [...m.entries()];
});

// Loaded VERBATIM, no repair: an illegal buried null makes the deck's assertThread THROW on purpose.
let block = $state({
	landKey: "",
	landName: "",
	treesPerHa: null as number | null,
	totalHa: null as number | null,
	speciesChoices: [] as string[],
});
let rows = $state<MapQ704PlotRow[]>([]);
let hydrated = $state(false);
let deck = $state<MapQ704DeckExports | null>(null);
let rewardTargetEl = $state<HTMLElement | null>(null);

// Freezes shell scroll while a row is in the edit spotlight.
let focusing = $state(false);
// Keeps the just-filed GOLD pill visible for a beat before swapping to read-only.
let justFiledHold = $state(false);
let justFiledTimer: ReturnType<typeof setTimeout> | null = null;
function onDeckFocusingChange(f: boolean) {
	const wasFocusing = focusing;
	focusing = f;
	// LIVE rows, not `counted`: the persist $effect may not have flushed yet.
	const nowCounted = rows.some((r) => r.committed && r.planted != null);
	if (wasFocusing && !f && nowCounted) {
		justFiledHold = true;
		if (justFiledTimer) clearTimeout(justFiledTimer);
		justFiledTimer = setTimeout(() => {
			justFiledHold = false;
			justFiledTimer = null;
		}, 650);
	}
}

onDestroy(() => {
	if (justFiledTimer) clearTimeout(justFiledTimer);
	if (loCodeCopiedTimer) clearTimeout(loCodeCopiedTimer);
});

onMount(async () => {
	if (!q704) return;
	const saved = await q704.loadInspection();
	const want = plot?.plotNo || pinPlotNo;
	if (saved) {
		block = { ...saved.block, speciesChoices: saved.block.speciesChoices ?? [] };
		// Only the tapped row, never the whole survey + trailing blank, or "add another" creates a phantom plot with no GPS.
		rows = saved.rows
			.filter((r) => r.plotNo === want)
			.map((r) => ({ ...r, committed: r.planted != null }));
	}
	// A fresh drop isn't in the store yet; the swipe is the FIRST write.
	if (rows.length === 0) {
		const pend = q704.getPendingDrop();
		if (pend && pend.plotNo === want) {
			rows = [
				{
					id: pend.rowKey,
					plotNo: pend.plotNo,
					planted: null,
					plantableSpotsOverride: null,
					faults: [],
					comment: "",
					openLocode: pend.gridCode || undefined,
					committed: false,
				},
			];
		}
	}
	hydrated = true;
	if (want) {
		const hit = rows.find((r) => r.plotNo === want);
		if (hit) {
			deck?.focusRow(hit.id);
			if (hit.planted == null && !hit.committed) deck?.openPlantedFor(hit.id);
		}
	}
});

// Writes only on commit (swipe-right) via targeted updateActivePlot, never the page's destructive persistInspection.
const missingReported = new Set<string>();

$effect(() => {
	if (!hydrated || !q704) return;
	// Bump plotVersion ONLY on a real write, or this effect loops forever.
	let changed = false;
	for (const r of rows) {
		// 0 is the not-yet-numbered value; writing it earns a "missing" that rolls the swipe back every pass.
		if (r.plotNo == null || r.plotNo <= 0) continue;
		if (!r.committed) continue;
		const outcome = q704.updateActivePlot(r.id, {
			planted: r.planted,
			plantableSpotsOverride: r.plantableSpotsOverride,
			plantableSpots: r.plantableSpots,
			faults: [...r.faults],
			comment: r.comment,
			species: r.species?.map((s) => ({ ...s })),
		});
		if (outcome === "updated") changed = true;
		if (outcome === "missing") {
			// A refused write persisted nothing: roll the swipe back so the row never looks filed while it lives only in memory.
			r.committed = false;
			if (!missingReported.has(r.id)) {
				missingReported.add(r.id);
				ports.ui.reportSwallowed(
					"PlotMapPopoverV2:commit",
					new Error(
						`updateActivePlot: no ACTIVE row ${r.id} (plot #${r.plotNo}) — the committed count was NOT persisted`,
					),
					{ plotNo: r.plotNo, mapFeatureKey, gpsFeatureKey: r.gpsFeatureKey ?? "" },
				);
			}
		}
	}
	if (changed) plotVersion += 1;
});

// Species must persist BEFORE the plot is filed, so this does not wait on r.committed.
$effect(() => {
	if (!hydrated || !q704) return;
	q704.setActiveSpeciesChoices([...block.speciesChoices]);
});

// The unfinished-plot gate lives in the HOST so X and tap-outside share ONE gate.
function requestClose() {
	onClose();
}

</script>

{#if q704}
<MapPopoverShell {bbox} {containerWidth} {containerHeight} isPoint={true} wide={true} scrollLocked={focusing}>
	<div class="plot-pop">
		<div class="pp-hdr">
			<img class="pp-glyph" src={iconPath("quality")} alt="" />
			<span class="pp-kind">Quality plot</span>
			<span class="pp-spacer"></span>
			<!-- Edit belongs to any EXISTING plot, not only a counted one: the plot whose count did not land is the one you most need to open. -->
			{#if canOpenInForm}
				<span class="pp-edit">
					<ports.ui.GoldButton
						size="sm"
						ariaLabel="Edit plot in form"
						title="Edit"
						onclick={() => onOpenInForm(plotNo)}
					>
						{#snippet icon()}<ports.ui.Icon name="edit-tilt" size={18} />{/snippet}
					</ports.ui.GoldButton>
				</span>
			{/if}
			{#if canOpenInForm}
				<button class="pp-icon" aria-label="Share plot" title="Share" use:atvShare onclick={() => onShare("getcache")}>
					<ports.ui.Icon name="share" size={18} />
				</button>
			{/if}
			<!-- No delete: a plot pin is the plot's key. -->
			<button class="rt-popover-close" aria-label="Close" title="Close" onclick={requestClose}><ports.ui.Icon name="close-x" /></button>
		</div>

		<!-- 0 = unnumbered; a dash says "no number yet" instead of claiming plot zero. -->
		<div class="pp-title" aria-label={displayNo ? `Plot ${displayNo}` : "Plot, not numbered yet"}>
			<span class="pp-title-lead">Plot #</span>
			<span class="pp-title-no">{displayNo || "—"}</span>
			{#if plotShortCode}
				<span class="pp-title-code" aria-label="Plot code {plotShortCode}">
					<span class="pp-title-code-bar">|</span>&nbsp;{plotShortCode}
				</span>
			{/if}
			{#if plotFullCode}
				<div class="pp-locode-row">
					<span class="pp-locode">{plotFullCode}</span>
					<button
						type="button"
						class="pp-locode-copy"
						aria-label="Copy location code"
						title="Copy"
						onclick={copyLoCode}
					>
						{#if loCodeCopied}
							<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
								<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
							<span class="pp-locode-copy-text">COPIED</span>
						{:else if loCodeCopyFailed}
							<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
								<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
							</svg>
							<span class="pp-locode-copy-text">FAILED</span>
						{:else}
							<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
								<rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2" />
								<path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
							</svg>
							<span class="pp-locode-copy-text">COPY</span>
						{/if}
					</button>
				</div>
			{/if}
		</div>

		{#if !counted || focusing || justFiledHold}
			<!-- Stays open while `focusing` so the swipe-to-file animation finishes before the swap. -->
			<div class="pp-deck" bind:this={rewardTargetEl} in:fade={{ duration: 180 }} out:fade={{ duration: 160 }}>
				<q704.Quality704Deck
					bind:this={deck}
					bind:block
					bind:rows
					showHeader
					singlePlot
					mapNumberFor={(r) =>
						(r.gpsFeatureKey && q704.activeMapNumbering().get(r.gpsFeatureKey)) || 0}
					onFocusingChange={onDeckFocusingChange}
					onReward={() => q704.celebrate.onInputComplete()}
					autoRestoreMissed={false}
				/>
			</div>
		{:else if plot}
			<div class="pp-view" in:fade={{ duration: 220, delay: 120 }} out:fade={{ duration: 160 }}>
			<div class="pp-sect">PLOT DATA</div>
			<div class="pp-data">
				<div class="pp-cell" class:pp-cell--under={short > 0}>
					<span class="pp-k">Planted</span>
					<span class="pp-v">{plot.planted}</span>
				</div>
				<div class="pp-cell"><span class="pp-k">Spots</span><span class="pp-v">{plot.spots}</span></div>
				<div class="pp-cell" class:pp-cell--over={excess > 0}>
					<span class="pp-k">Excess</span>
					<span class="pp-v">{plot.excess}</span>
				</div>
				<div class="pp-cell" class:pp-cell--bad={faultCount > 0}>
					<span class="pp-k">Faults</span>
					<span class="pp-v">{faultCount}</span>
				</div>
			</div>
			{#if faultGroups.length > 0}
				<div class="pp-fault-strip">
					{#each faultGroups as [code, count] (code)}
						<q704.FaultChip {code} {count} />
					{/each}
				</div>
			{/if}
			{#if plot.comment.trim()}
				<div class="pp-comments">
					<div class="pp-sect">Comments</div>
					<p class="pp-comment-text">{plot.comment}</p>
				</div>
			{/if}
			</div>
		{/if}
	</div>
</MapPopoverShell>

<q704.CelebrateHost target={rewardTargetEl} />
{/if}

<style>
	.plot-pop {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 8px;
		color: var(--rt-fg, #f3ead2);
	}

	.pp-deck {
		margin: 4px 0 0;
	}

	.pp-hdr {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.pp-glyph {
		width: 39px;
		height: 39px;
		object-fit: contain;
		flex: 0 0 auto;
	}
	.pp-kind {
		font-family: var(--rt-font-display), sans-serif;
		font-weight: 700;
		font-size: 1.05rem;
		letter-spacing: 0.02em;
		color: var(--rt-yellow, #ffd700);
	}
	.pp-spacer {
		flex: 1 1 auto;
	}
	.pp-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: 39px;
		height: 39px;
		border-radius: var(--rt-radius-sm, 8px);
		border: 1.5px solid var(--rt-gold-1, #f5d565);
		background: rgba(232, 185, 35, 0.12);
		color: var(--rt-gold-1, #f5d565);
		cursor: pointer;
	}

	.pp-edit {
		display: inline-flex;
		flex: none;
	}
	.pp-edit :global(.gold-btn) {
		box-sizing: border-box;
		width: 39px;
		height: 39px;
		padding: 0;
	}
	.pp-edit :global(.gold-btn .badge) {
		width: auto;
		height: auto;
		border: none;
		border-radius: 0;
		background: none;
	}
	.pp-title {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px 8px;
		padding: 8px 12px;
		border-radius: var(--rt-radius-sm, 8px);
		background: rgba(0, 0, 0, 0.32);
		border: 1px solid var(--rt-border, rgba(232, 185, 35, 0.18));
	}
	.pp-title-lead {
		font-family: var(--rt-font-display), sans-serif;
		font-weight: 800;
		font-size: 1.5rem;
		line-height: 1;
		color: var(--rt-fg-context, #d9a679);
	}
	.pp-title-no {
		font-family: var(--rt-font-display), sans-serif;
		font-weight: 800;
		font-size: 1.5rem;
		line-height: 1;
		color: var(--rt-yellow, #ffd700);
	}
	.pp-title-code {
		font-family: var(--rt-font-display), sans-serif;
		font-weight: 800;
		font-size: 1.5rem;
		line-height: 1;
		letter-spacing: 0.01em;
		color: var(--rt-yellow, #ffd700);
		display: inline-flex;
		align-items: baseline;
		gap: 8px;
		margin-left: 8px;
	}
	.pp-title-code-bar {
		color: var(--rt-fg-context, #d9a679);
		opacity: 0.85;
	}
	.pp-locode-row {
		flex-basis: 100%;
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
	}
	.pp-locode {
		font-family: var(--rt-font-mono, ui-monospace, monospace);
		font-size: 0.72rem;
		letter-spacing: 0.01em;
		color: var(--rt-fg-context, #d9a679);
		opacity: 0.7;
	}
	/* A real button WITH a label: a bare faint icon read as decoration and was missed. */
	.pp-locode-copy {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		box-sizing: border-box;
		padding: 0 10px;
		height: 28px;
		border-radius: var(--rt-radius-sm, 8px);
		border: 1.5px solid var(--rt-gold-1, #f5d565);
		background: rgba(232, 185, 35, 0.12);
		color: var(--rt-gold-1, #f5d565);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition: background 120ms ease;
	}
	.pp-locode-copy:hover,
	.pp-locode-copy:active {
		background: rgba(232, 185, 35, 0.24);
	}
	.pp-locode-copy-text {
		line-height: 1;
	}

	.pp-view {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.pp-sect {
		font-family: var(--rt-font-display), sans-serif;
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		color: var(--rt-fg-context, #d9a679);
		margin-top: 2px;
	}
	.pp-data {
		display: flex;
		flex-wrap: nowrap;
		gap: 5px;
	}
	.pp-cell {
		display: inline-flex;
		/* Wraps INSIDE the pill when too narrow instead of pushing past the border. */
		flex-wrap: wrap;
		flex: 1 1 auto;
		min-width: 0;
		align-items: baseline;
		justify-content: space-between;
		gap: 0 6px;
		padding: 7px 9px;
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.28);
		border: 1px solid rgba(255, 255, 255, 0.18);
	}
	.pp-cell--under {
		background: color-mix(in srgb, var(--rt-q704-under) 16%, rgba(0, 0, 0, 0.28));
		border-color: var(--rt-q704-under);
	}
	.pp-cell--over {
		background: color-mix(in srgb, var(--rt-q704-over) 16%, rgba(0, 0, 0, 0.28));
		border-color: var(--rt-q704-over);
	}
	.pp-cell--bad {
		background: color-mix(in srgb, var(--rt-q704-fault) 18%, rgba(0, 0, 0, 0.28));
		border-color: var(--rt-q704-fault);
	}
	.pp-fault-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		--chip-h: 22px;
		--chip-pad-x: 7px;
		--chip-font: 12px;
		--chip-radius: 6px;
		--badge-min: 13px;
		--badge-h: 13px;
		--badge-font: 9px;
	}
	.pp-comments {
		margin-top: 2px;
		padding: 8px 10px;
		border-radius: var(--rt-radius-sm, 8px);
		background: rgba(0, 0, 0, 0.28);
		border: 1px solid rgba(255, 255, 255, 0.06);
	}
	.pp-comment-text {
		margin: 4px 0 0;
		font-size: 0.86rem;
		line-height: 1.3;
		color: var(--rt-fg, #f3ead2);
		word-break: break-word;
	}
	.pp-k {
		font-size: 0.62rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--rt-fg-context, #d9a679);
		white-space: nowrap;
	}
	.pp-v {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: 1rem;
		color: var(--rt-fg, #f3ead2);
		white-space: nowrap;
	}
	.plot-pop :global(.rt-popover-close) {
		box-sizing: border-box;
		width: 39px;
		height: 39px;
		border-radius: var(--rt-radius-sm, 8px);
		border-width: 1.5px;
	}

</style>
