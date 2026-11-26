<!-- Body gated on counted (editable deck vs read-only); header Edit/Share gated on the plot EXISTING, never its count. -->
<script lang="ts">
import { iconPath } from "../shared/icons";
import { m } from "$parent/src/lib/paraglide/messages";
import { getLocale } from "$parent/src/lib/paraglide/runtime";
import type { Feature } from "geojson";
import { onDestroy, onMount } from "svelte";
import { fade } from "svelte/transition";
import MapPopoverShell from "../panels/MapPopoverShell.svelte";
import { ago } from "$gc/ago";
import PeopleGrid from "$gc/PeopleGrid.svelte";
import NestGroup from "$gc/NestGroup.svelte";
import NestPill from "$gc/NestPill.svelte";
import { counts, delta } from "$gc/PlotMarks.svelte";
import type {
	MapHostPorts,
	MapQ704DeckExports,
	MapQ704PlotEdit,
	MapQ704PlotPeople,
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
	feature?: Feature | null;
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

// Never discard a plot on unmount: only the host's "cancel plot" gate discards.
const mapFeatureKey = $derived((feature?.properties?.mapFeatureKey as string) ?? "");
const isCreate = $derived(pendingPlotNo != null);
const plot = $derived.by<MapQ704PlotPinData | null>(() => {
	if (!q704) return null;
	if (isCreate) return q704.pendingDropPinData();
	return mapFeatureKey ? q704.plotByGpsKey(mapFeatureKey) : null;
});

// Fallback when the row lookup misses: the pin's own type key (`plot:N`).
const pinPlotNo = $derived.by(() => {
	if (isCreate) return pendingPlotNo ?? 0;
	const k = (feature?.properties?.pinIcon as string) ?? "";
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
const plotKey = $derived(isCreate ? "" : (plot?.plotKey ?? ""));

const plotFullCode = $derived(q704 ? q704.plotFullCodeByGpsKey(mapFeatureKey) : "");
// A refused clipboard throws, so the share menu says so where it was tapped.
const shareFormats = $derived([
	{ ext: "getcache", run: () => onShare("getcache") },
	...(plotFullCode
		? [{ ext: "locode", label: m.ofmap_ui_location_code(), icon: "copy", run: async () => { if (!(await ports.ui.copyToClipboard(plotFullCode))) throw new Error("clipboard refused"); } }]
		: []),
]);

const counted = $derived(plot != null && plot.planted != null);

const planted = $derived(plot?.planted ?? 0);
const spots = $derived(plot?.spots ?? 0);
const excess = $derived(plot?.excess ?? 0);
const short = $derived(Math.max(0, spots - planted));
const words = $derived({ planted: m.ofmap_ui_planted(), spots: m.ofmap_ui_spots(), missed: m.ofmap_ui_missed(), excess: m.ofmap_ui_excess() });

let people = $state<MapQ704PlotPeople | null>(null);
$effect(() => {
	const k = counted ? plotKey : "";
	if (!k || !q704) return void (people = null);
	void q704.plotPeople(k).then((p) => k === plotKey && (people = p));
});

const faultGroups = $derived.by<[string, number][]>(() => {
	const m = new Map<string, number>();
	for (const code of plot?.faults ?? []) m.set(code, (m.get(code) ?? 0) + 1);
	return [...m.entries()];
});

// Loaded VERBATIM, no repair: an illegal buried null makes the deck's assertThread THROW on purpose.
let block = $state({
	blockKey: "",
	blockName: "",
	treesPerHa: null as number | null,
	totalHa: null as number | null,
	speciesChoices: [] as string[],
});
let rows = $state<MapQ704PlotRow[]>([]);
let hydrated = $state(false);
let deck = $state<MapQ704DeckExports | null>(null);
let rewardTargetEl = $state<HTMLElement | null>(null);

let focusing = $state(false);
// Keeps the just-filed GOLD pill visible for a beat before swapping to read-only.
let justFiledHold = $state(false);
const deckUp = $derived(!counted || focusing || justFiledHold);
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
					plantableSpotsOverrideQty: null,
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
	// 0 is the not-yet-numbered value; writing it earns a "missing" that rolls the swipe back every pass.
	const edits = rows
		.filter((r) => r.plotNo != null && r.plotNo > 0 && r.committed)
		.map((r) => ({
			r,
			fields: {
				planted: r.planted,
				plantableSpotsOverrideQty: r.plantableSpotsOverrideQty,
				plantableSpotsQty: r.plantableSpotsQty,
				faults: [...r.faults],
				comment: r.comment,
				species: r.species?.map((s) => ({ ...s })),
			},
		}));
	void commitEdits(q704, edits);
});

async function commitEdits(
	q: NonNullable<typeof q704>,
	edits: { r: MapQ704PlotRow; fields: MapQ704PlotEdit }[],
): Promise<void> {
	for (const { r, fields } of edits) {
		const outcome = await q.updateActivePlot(r.id, fields).catch((e) => {
			console.warn("[PlotMapPopoverV2:commit]", e, { plotNo: r.plotNo ?? 0, mapFeatureKey });
			return "missing" as const;
		});
		if (outcome === "missing") {
			// A refused write persisted nothing: roll the swipe back so the row never looks filed while it lives only in memory.
			r.committed = false;
			if (!missingReported.has(r.id)) {
				missingReported.add(r.id);
				console.warn(
					"[PlotMapPopoverV2:commit]",
					new Error(
						`updateActivePlot: no ACTIVE row ${r.id} (plot #${r.plotNo}) — the committed count was NOT persisted`,
					),
					{ plotNo: r.plotNo, mapFeatureKey },
				);
			}
		}
	}
}

// Species must persist BEFORE the plot is filed, so this does not wait on r.committed.
$effect(() => {
	if (!hydrated || !q704) return;
	void q704
		.setActiveSpeciesChoices([...block.speciesChoices])
		.catch((e) => console.warn("[PlotMapPopoverV2:species]", e));
});

let unfolded = $state(false);
let confirmingDelete = $state(false);
async function deleteHere() {
	confirmingDelete = false;
	await q704?.trashPlot(plotKey);
	onClose();
}

</script>

{#if q704}
<MapPopoverShell {bbox} {containerWidth} {containerHeight} isPoint={true} wide={true} scrollLocked={focusing}>
	<div class="plot-pop">
		<div class="rt-pop-hdr">
			<!-- The glyph alone names it: four squares and a label don't fit a 390 px card. -->
			<img class="pp-glyph" src={iconPath("quality")} alt={m.ofmap_ui_quality_plot()} />
			<span class="pp-spacer"></span>
			<!-- Any EXISTING plot, not only a counted one: the plot whose count did not land is the one you most need to open. No close: a tap off the card closes it. -->
			{#if canOpenInForm}
				<ports.ui.SharePicker formats={shareFormats} side="below">
					{#snippet trigger({ open, toggle }: { open: boolean; toggle: () => void })}
						<button class="rt-icon-btn rt-icon-btn--share" aria-label={m.ofmap_ui_plot_share_aria()} aria-expanded={open} title={m.ofmap_ui_share()} onclick={toggle}>
							<ports.ui.Icon name="share" size={16} />
						</button>
					{/snippet}
				</ports.ui.SharePicker>
				{#if plotKey}<ports.ui.InboxTruck featureKey={mapFeatureKey} link={`plot:${plotKey}`} />{/if}
				<button class="rt-icon-btn rt-icon-btn--share" aria-label={m.ofmap_ui_plot_edit_aria()} title={m.ofmap_ui_plot_edit_aria()} onclick={() => onOpenInForm(plotNo)}>
					<img class="pp-btn-art" src={iconPath("quality")} alt="" />
				</button>
				{#if plotKey}
					<button class="rt-icon-btn rt-icon-btn--delete" aria-label={m.ofmap_ui_delete()} title={m.ofmap_ui_delete()} onclick={() => (confirmingDelete = true)}>
						<ports.ui.Icon name="trash" size={16} />
					</button>
				{/if}
			{/if}
		</div>

		<NestGroup>
			<NestPill stack="middle">
				<span class="pp-r1">
					<!-- 0 = unnumbered: a dash says "no number yet" instead of claiming plot zero. -->
					<span class="pp-name" data-plot-name>{displayNo ? m.ofmap_ui_plot_name({ no: displayNo }) : "—"}</span>
					{#if people}
						{@const d = new Date(people.at)}
						<span class="nest-time pp-when">{d.getDate()} {d.toLocaleDateString(getLocale(), { month: "short" })} {d.getFullYear()}<br />{d.toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s*([ap])\.?\s*m\.?$/i, (_, x: string) => x.toLowerCase())}</span>
					{/if}
				</span>
				{#if people}<PeopleGrid surveyors={[people.surveyor]} planters={people.planters} words={{ surveyor: m.ofmap_ui_surveyor(), planter: m.ofmap_ui_planter() }} />{/if}
			</NestPill>
			{#if !deckUp}
				<NestGroup>
					<NestPill
						open={faultGroups.length ? unfolded : undefined}
						ontoggle={faultGroups.length ? () => (unfolded = !unfolded) : undefined}
						ongo={plotKey ? () => ports.ui.openInbox(`plot:${plotKey}`) : undefined}
						goLabel={m.ofmap_ui_plot_open_aria()}>
						{@render counts(planted, spots, words)}
						{#snippet values()}{@render delta(short, excess, words)}{/snippet}
						{#snippet corner()}{#if people}<span class="nest-time">{ago(new Date(people.at).toISOString())}</span>{/if}{/snippet}
					</NestPill>
					{#if unfolded && faultGroups.length}
						<div class="pp-faults">
							<NestGroup>
								{#each faultGroups as [code, count], i (code)}
									<NestPill small>
										{m.ofmap_ui_fault_no({ no: i + 1 })}
										{#snippet values()}<span class="pp-fault" data-fault={code}><q704.FaultChip {code} {count} /><span class="nest-meta pp-fault-name">{q704.faultTitle(code)}</span></span>{/snippet}
									</NestPill>
								{/each}
							</NestGroup>
						</div>
					{/if}
				</NestGroup>
			{/if}
		</NestGroup>

		{#if deckUp}
			<!-- Stays open while `focusing` so the swipe-to-file animation finishes before the swap. -->
			<div class="pp-deck" bind:this={rewardTargetEl} in:fade={{ duration: 180 }} out:fade={{ duration: 160 }}>
				<q704.Quality704Deck
					bind:this={deck}
					bind:block
					bind:rows
					showHeader
					singlePlot
					mapNumberFor={(r) =>
						(r.mapFeatureKey && q704.activeMapNumbering().get(r.mapFeatureKey)) || 0}
					onFocusingChange={onDeckFocusingChange}
					onReward={() => q704.celebrate.onInputComplete()}
					autoRestoreMissed={false}
				/>
			</div>
		{:else if plot?.comment.trim()}
			<div class="pp-comments" in:fade={{ duration: 220, delay: 120 }} out:fade={{ duration: 160 }}>
				<div class="pp-sect">{m.ofmap_ui_comments()}</div>
				<p class="pp-comment-text">{plot.comment}</p>
			</div>
		{/if}
	</div>
</MapPopoverShell>

<q704.CelebrateHost target={rewardTargetEl} />
<ports.ui.ConfirmModal open={confirmingDelete} title={m.ofmap_ui_delete_confirm()} onConfirm={deleteHere} onCancel={() => (confirmingDelete = false)} />
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

	.pp-glyph {
		width: 36px;
		height: 36px;
		object-fit: contain;
		flex: 0 0 auto;
	}
	.pp-spacer {
		flex: 1 1 auto;
	}
	.pp-btn-art {
		width: 20px;
		height: 20px;
	}
	.pp-r1 {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}
	.pp-name {
		font-size: 28px;
		line-height: 1.1;
	}
	.pp-when {
		flex: none;
		text-align: right;
		line-height: 1.4;
	}
	.pp-sect {
		font-family: var(--rt-font-display), sans-serif;
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		color: var(--rust);
		margin-top: 2px;
	}
	/* Three faults and the top of a fourth, so more is seen to be there; the rest scroll here, not the map. */
	.pp-faults {
		flex: none;
		max-height: 146px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.pp-fault {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		--chip-h: 22px;
		--chip-pad-x: 7px;
		--chip-font: 12px;
		--chip-radius: 6px;
		--badge-min: 13px;
		--badge-h: 13px;
		--badge-font: 9px;
	}
	.pp-fault-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
</style>
