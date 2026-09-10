<script lang="ts">
/**
 * OFFLINE BLOBS — what is on disk, newest first. The newest row is FOCUSED
 * (the gold card); every row is a ledger: tiles in, bytes fetched, paint.
 * The head says whether the browser will KEEP the data and how much of the
 * budget is spent; every row says whether the blob is WHOLE on disk, and
 * repairs it when it is not.
 */
import { onDestroy, onMount } from "svelte";
import type { MapUiPorts } from "../../lib/shared/mapHostPorts";
import { FOLLOW_MARGIN_KM } from "./follow";
import { blobBytes, BUDGET_MB } from "./budget";
import { placeLabel } from "./places";
import { ANCHOR_Z, MAX_Z, MIN_Z, RADIUS_KM } from "./tiles";
import {
	planPhotoDedup,
	runPhotoDedup,
} from "../../lib/onPhone/satellite/photoDedup";
import { PHOTO_SPEC, type PhotoInfo, photoKey, photoSourceFor } from "./satellite";
import type { Kept, Region } from "./store";

let {
	regions = [],
	photos = {},
	tiles = 0,
	bytes = 0,
	busy = false,
	follow = null,
	kept = "unknown",
	missing = {},
	budgetMb = BUDGET_MB,
	failure = null,
	onAddHere,
	onAddForPins,
	onDelete,
	onWipe,
	onFly,
	onRepair,
	onRepairAll,
	ui,
}: {
	regions: Region[];
	/** bytes on disk per photo key — a blob with no entry has no photo yet */
	photos: Record<string, PhotoInfo>;
	tiles: number;
	bytes: number;
	busy: boolean;
	/** The blue dot's last live fix and how much map is left around it; null until a fix lands. */
	follow: { at: [number, number]; margin: number } | null;
	/** whether the browser has agreed to keep the store; "evictable" is the state that empties a map in the field */
	kept?: Kept;
	/** per blob id, how many of its tiles are not on disk; 0 is whole */
	missing?: Record<string, number>;
	budgetMb?: number;
	/** why the last download did not land, until the next one starts */
	failure?: string | null;
	onAddHere: () => void;
	/** A blob for every pin on screen that has none — the way to see many borders at once without 2 GB. */
	onAddForPins: () => void;
	onDelete: (id: string) => void;
	onWipe: () => void;
	onFly: (r: Region) => void;
	onRepair: (r: Region) => void;
	onRepairAll: () => void;
	/** The host's eye animation and frame icon — this child owns no assets. */
	ui: Pick<MapUiPorts, "MaskedFrameIcon" | "createEyeBlink" | "eyeAllFrames">;
} = $props();

/** Rows shown under FOCUSED before "N more…" — a long library must not become a long card. */
const CAP = 12;
let showAll = $state(false);
let quota = $state<number | null>(null);

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
/** KB up to a megabyte, MB above it — "1533 KB" is a size nobody reads as 1.5 MB. */
const kb = (b: number) => (b < 1048576 ? `${Math.round(b / 1024)} KB` : mb(b));
const photoOf = (r: Region): PhotoInfo | undefined => photos[photoKey(r.lng, r.lat)];
/** What the photo was baked with, from the photo itself; before it lands, the row a bake here would pick. */
const specOf = (r: Region): { name: string; zoom: number; canvasPx: number } => {
	const p = photoOf(r);
	if (p) return { name: p.source, zoom: p.zoom, canvasPx: p.canvasPx };
	const name = photoSourceFor(r.lng, r.lat);
	return PHOTO_SPEC.sources.find((s) => s.name === name) ?? PHOTO_SPEC.sources[PHOTO_SPEC.sources.length - 1];
};
const eyeBlink = ui.createEyeBlink();
onDestroy(() => eyeBlink.destroy());
const photoTotal = $derived(Object.values(photos).reduce((a, b) => a + b.bytes, 0));

// Photos baked before the reuse rule: duplicates of ground a neighbour photo
// already covers. Only ever shown when there are some to clear — a button
// offering to delete nothing is noise.
let dupes = $state(0);
let tidying = $state(false);
async function countDupes(): Promise<void> {
	dupes = (await planPhotoDedup()).drop.length;
}
async function tidyPhotos(): Promise<void> {
	tidying = true;
	try {
		await runPhotoDedup();
		await countDupes();
	} finally {
		tidying = false;
	}
}
/** Tiles and photos together — the figure the budget is measured against. */
const used = $derived(bytes + photoTotal);
// ⚠️ What the blob ADDED, not what it covers — a blob landing on ground another
// already saved costs only its photo, and a header reading 6 MB for it invited
// the "is it downloading twice?" question. `newBytes` is absent on rows written
// before it existed; those fall back to the on-disk size.
const rowBytes = (r: Region): number => blobBytes(r.newBytes ?? r.bytes, photoOf(r)?.bytes);
const broken = $derived(regions.filter((r) => (missing[r.id] ?? 0) > 0).length);
const nameOf = (r: Region): string => (r.place ? placeLabel(r.place) : r.id);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const ago = (t: number) => {
	const m = Math.round((Date.now() - t) / 60000);
	return m < 1 ? "now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};
/**
 * TWO BUCKETS, ONE LIST. Follow-me writes a roads-only blob (`photo: false`)
 * under the live fix whenever the walker crosses the rim — real machinery, and
 * it keeps writing while the map is looked at somewhere else entirely. Ranking
 * the whole list by write time therefore hoisted a blob in another province and
 * left the pin on screen unlisted.
 *
 * A pin blob wins over a follow-me blob; within a bucket, newest first.
 */
const ordered = $derived(
	[...regions].sort((a, b) => {
		const ap = a.photo === false ? 1 : 0;
		const bp = b.photo === false ? 1 : 0;
		return ap !== bp ? ap - bp : b.at - a.at;
	}),
);
const focus = $derived(ordered[0]);
const rest = $derived(showAll ? ordered.slice(1) : ordered.slice(1, 1 + CAP));

onMount(() => {
	navigator.storage?.estimate?.().then((e) => {
		quota = e.quota ?? null;
	});
	void countDupes();
});
</script>

<div class="panel dev-card">
	<div class="head dev-card__head">
		<span class="dev-card__title">offline blobs</span>
		<span class="sum">
			{regions.length} areas · {#if broken > 0}<span class="red">{broken} not whole</span><button class="repair" onclick={onRepairAll} disabled={busy} title="fetch every missing tile of every blob, one blob at a time">repair all</button><span>&nbsp;·&nbsp;</span>{/if}{tiles} tiles
			<span class="dim">· {Object.keys(photos).length} photos · {kb(photoTotal)}</span>{#if dupes > 0}<button class="repair" onclick={tidyPhotos} disabled={busy || tidying} title="delete {dupes} photos of ground another photo already covers — roads are untouched">{tidying ? "tidying…" : `tidy ${dupes} dupes`}</button>{/if}
		</span>
		<button class="wipe" onclick={onWipe} disabled={busy}>WIPE</button>
	</div>

	<div class="keep" class:bad={kept === "evictable"} title={quota === null ? "" : `the browser would allow ${mb(quota)}`}>
		<span class="dot {kept}"></span>
		{#if kept === "kept"}
			kept — the browser will not evict this store
		{:else if kept === "evictable"}
			NOT kept — the browser may evict this store to free space
		{:else}
			kept? — this browser did not say
		{/if}
		<span class="budget" class:full={used >= budgetMb * 1048576}>{mb(used)} of {budgetMb} MB</span>
	</div>
	{#if failure}
		<div class="fail">✕ {failure}</div>
	{/if}
	<button class="add" onclick={onAddHere} disabled={busy}>{busy ? "downloading…" : "+ blob at map centre"}</button>
	<button class="add" onclick={onAddForPins} disabled={busy}>+ blobs for pins in view</button>
	<div class="hint">or drop a pin · {RADIUS_KM} km radius on whole z{ANCHOR_Z} tiles · z{MIN_Z}–z{MAX_Z}</div>
	<div class="follow" class:low={follow !== null && follow.margin <= FOLLOW_MARGIN_KM}>
		📡
		{#if follow === null}
			following · no fix yet — the blue dot starts it
		{:else if follow.margin === Number.NEGATIVE_INFINITY}
			following · no map here yet
		{:else if follow.margin < 0}
			following · {(-follow.margin).toFixed(1)} km outside every blob
		{:else}
			following · {follow.margin.toFixed(1)} km of map ahead
		{/if}
		<span class="dim">· fetches under {FOLLOW_MARGIN_KM} km</span>
	</div>

	{#if regions.length === 0}
		<div class="empty">nothing on disk<div class="dim">drop a pin to download the first blob</div></div>
	{:else}
		<div class="rows">
			{#each [focus, ...rest] as r, i (r.id)}
				{@const focused = i === 0}
				<div class="row" class:focused class:other={!focused}>
					{#if focused}
						<span class="focustag">● FOCUSED — LAST PIN BLOB</span>
					{/if}
					<div class="row-top">
						<span class="dot {(missing[r.id] ?? 0) > 0 ? 'evictable' : missing[r.id] === 0 ? 'kept' : 'unknown'}" title={missing[r.id] === undefined ? "not checked yet" : missing[r.id] === 0 ? "whole — every tile on disk" : `${missing[r.id]} of ${r.tiles} tiles not on disk`}></span>
						<button class="name" onclick={() => onFly(r)} title="fly there · {r.id}">{nameOf(r)}</button>
						{#if (missing[r.id] ?? 0) > 0}
							<button class="repair" onclick={() => onRepair(r)} disabled={busy} title="fetch the {missing[r.id]} missing tiles">{missing[r.id]} missing · repair</button>
						{/if}
						<span class="when">🕓 {ago(r.at)}</span>
						<button class="eye" aria-label="see this blob on the map" title="see on map" onclick={() => eyeBlink.blinkThen(() => onFly(r), r.id)}>
							<ui.MaskedFrameIcon src={eyeBlink.srcFor(r.id)} frames={ui.eyeAllFrames} size={23} color="var(--rt-yellow, #ffd700)" />
						</button>
						<span class="bytes">{mb(rowBytes(r))}</span>
						<button class="x" onclick={() => onDelete(r.id)} disabled={busy} title="delete this blob">✕</button>
					</div>
					<div class="layers">
						<div class="layer on">
							<span class="dir">in</span>
							<span class="ico">🗺️</span>
							<span class="lname">tiles</span>
							<span class="ldetail">{r.tiles} tiles · {mb(r.bytes)}</span>
							<span class="lbytes">{r.newBytes == null ? "—" : mb(r.newBytes)}</span>
						</div>
						<div class="layer" class:on={photoOf(r) != null}>
							<span class="dir">in</span>
							<span class="ico">🛰️</span>
							<span class="lname">photo</span>
							{#if r.photo === false}
								<span class="ldetail">follow-me · no pin, no photo</span>
								<span class="lbytes">—</span>
							{:else}
								<span class="ldetail">{PHOTO_SPEC.radiusKm} km · {specOf(r).canvasPx} px · {specOf(r).name} z{specOf(r).zoom}</span>
								<span class="lbytes">{photoOf(r) == null ? "—" : kb((photoOf(r) as PhotoInfo).bytes)}</span>
							{/if}
						</div>
						<div class="layer on">
							<span class="dir">net</span>
							<span class="ico">⬇️</span>
							<span class="lname">fetched</span>
							<span class="ldetail">{r.fetched} new · {r.tiles - r.fetched} shared</span>
							<span class="lbytes">{secs(r.ms)}</span>
						</div>
						<div class="layer" class:on={r.msPaint != null}>
							<span class="dir">out</span>
							<span class="ico">🖌️</span>
							<span class="lname">painted</span>
							<span class="ldetail">{r.paintMoved ? "moved while landing" : "disk → screen"}</span>
							<span class="lbytes">{r.msPaint == null ? "—" : secs(r.msPaint)}</span>
						</div>
					</div>
				</div>
			{/each}
			{#if !showAll && regions.length > 1 + CAP}
				<button class="more" onclick={() => (showAll = true)}>{regions.length - 1 - CAP} more…</button>
			{/if}
		</div>
	{/if}
</div>

<style>
/* Shell from devCard.css (.dev-card); the list takes the slack and scrolls so the head and WIPE stay put. */
.panel { overflow: hidden; display: flex; flex-direction: column; max-height: 100%; }
.head { flex-wrap: wrap; gap: 0.4rem 0.75rem; }
.sum { margin-left: auto; color: var(--muted); }
.dim { color: var(--muted); }
.red { color: #e2553f; }
/* KEPT — the one line that decides whether the map is still there out of coverage. */
.keep { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; margin: 4px 0 6px; }
.keep.bad { color: #e2553f; }
.budget { margin-left: auto; color: #eab627; font-weight: 700; font-variant-numeric: tabular-nums; }
.budget.full { color: #e2553f; }
.dot { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%; background: #4a4a4a; align-self: center; }
.dot.kept { background: #35c759; }
.dot.evictable { background: #e0483e; }
.fail { color: #e2553f; font-size: 11px; margin: 0 0 6px; line-height: 1.3; }
.sum .repair { margin-left: 6px; }
.repair { background: none; border: 1px solid #e2553f; color: #e2553f; border-radius: 5px; font: inherit; font-size: 0.8em; cursor: pointer; padding: 0 5px; white-space: nowrap; }
/* Deliberately ugly and red: it must never be mistaken for a normal action. */
.wipe { border: 1px solid #e2553f; color: #e2553f; background: transparent; border-radius: 7px; padding: 0.3rem 0.6rem; cursor: pointer; font: 800 0.7rem "Inter", -apple-system, sans-serif; letter-spacing: 0.03em; }
.add { width: 100%; padding: 6px; font: inherit; cursor: pointer; border-radius: 7px; border: 1px solid var(--gold); background: transparent; color: var(--gold); }
button:disabled { opacity: 0.4; cursor: default; }
.hint { color: var(--muted2); font-size: 11px; margin: 4px 0 4px; }
.follow { color: var(--muted); font-size: 11px; margin: 0 0 8px; font-variant-numeric: tabular-nums; }
.follow.low { color: #eab627; }
.empty { padding: 0.9rem; line-height: 1.5; }
.rows { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.row { padding: 0.6rem 0.4rem; border-top: 1px dashed rgba(255, 255, 255, 0.1); }
.row:first-child { border-top: none; }
/* FOCUSED — the newest PIN blob (follow-me's roads-only blobs rank below it). Not necessarily SessionDock's `lastBlob`, which is the last blob DOWNLOADED whichever bucket it came from. */
.row.focused { margin: 0.2rem 0 0.6rem; padding: 0.8rem 0.85rem; border: 1.5px solid #eab627; background: rgba(234, 182, 39, 0.06); border-radius: 10px; }
.focustag { display: inline-flex; align-items: center; gap: 5px; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.08em; color: #221904; background: #eab627; padding: 2px 7px; border-radius: 5px; margin-bottom: 7px; }
/* NOT focused — secondary at a glance, so the eye lands on FOCUSED first. */
.row.other { opacity: 0.55; }
.row.other .name { font-weight: 600; font-size: 0.9em; }
.more { all: unset; cursor: pointer; padding: 4px 6px; opacity: 0.7; text-decoration: underline dotted; }
.row-top { display: flex; align-items: baseline; gap: 0.5rem; padding: 0.2rem 0; }
.name { all: unset; cursor: pointer; color: #eab627; font-weight: 700; font-size: 0.95em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.when { color: #eab627; opacity: 0.85; font-variant-numeric: tabular-nums; white-space: nowrap; }
.eye { all: unset; cursor: pointer; display: inline-flex; align-items: center; align-self: center; line-height: 0; }
.eye:active { transform: scale(0.9); }
.bytes { margin-left: auto; color: #eab627; font-weight: 700; font-variant-numeric: tabular-nums; }
.x { background: none; border: 1px solid rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.6); border-radius: 5px; font: inherit; cursor: pointer; padding: 0 5px; }
/* THE LEDGER — one line per fact, columns aligned (dir · icon · name · detail · figure). */
.layers { display: grid; grid-template-columns: 2.2em 1.4em 5.5em 1fr auto; align-items: baseline; margin-top: 0.15rem; border-radius: 6px; overflow: hidden; }
.layer { display: contents; color: var(--muted); }
.layer > span { padding: 0.18rem 0.3rem; background: rgba(255, 255, 255, 0.03); white-space: nowrap; }
.layer:nth-child(even) > span { background: rgba(255, 255, 255, 0.06); }
.dir { color: #6fb3d9; font-weight: 700; text-align: right; }
.ico { text-align: center; }
.lname { color: var(--text); }
.ldetail { color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.lbytes { color: #eab627; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
.layer:not(.on) > span { opacity: 0.5; }
</style>
