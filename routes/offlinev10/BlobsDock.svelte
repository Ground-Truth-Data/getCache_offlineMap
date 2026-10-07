<script lang="ts">
/** What is on disk, newest pin blob focused; every row a ledger of tiles in, bytes fetched, paint. */
import { onDestroy, onMount, untrack } from "svelte";
import type { MapUiPorts } from "../../lib/shared/mapHostPorts";
import { FOLLOW_MARGIN_KM } from "./follow";
import { blobBytes, BUDGET_MB } from "./budget";
import { placeLabel } from "./places";
import { ANCHOR_Z, MAX_Z, MIN_Z, RADIUS_KM } from "./tiles";
import { PHOTO_SPEC, type PhotoInfo } from "./satellite";
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
	/** per photo key; a blob with no entry has no photo yet */
	photos: Record<string, PhotoInfo>;
	tiles: number;
	bytes: number;
	busy: boolean;
	/** null until a fix lands */
	follow: { at: [number, number]; margin: number } | null;
	kept?: Kept;
	/** per blob id, tiles not on disk; 0 is whole */
	missing?: Record<string, number>;
	budgetMb?: number;
	failure?: string | null;
	onAddHere: () => void;
	onAddForPins: () => void;
	onDelete: (id: string) => void;
	onWipe: () => void;
	onFly: (r: Region) => void;
	onRepair: (r: Region) => void;
	onRepairAll: () => void;
	ui: Pick<MapUiPorts, "MaskedFrameIcon" | "createEyeBlink" | "eyeAllFrames">;
} = $props();

const CAP = 12;
let showAll = $state(false);
let quota = $state<number | null>(null);

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
const kb = (b: number) => (b < 1048576 ? `${Math.round(b / 1024)} KB` : mb(b));
const photoOf = (r: Region): PhotoInfo | undefined => (r.photoKey ? photos[r.photoKey] : undefined);
/** From the photo itself; before it lands, the source a bake will use. */
const specOf = (r: Region): { name: string; zoom: number; canvasPx: number } => {
	const p = photoOf(r);
	return p ? { name: p.source, zoom: p.zoom, canvasPx: p.canvasPx } : PHOTO_SPEC.sources[0];
};
const health = (r: Region): string =>
	missing[r.id] === undefined ? "not checked yet" : missing[r.id] === 0 ? "whole — every tile on disk" : `${missing[r.id]} of ${r.tiles} tiles not on disk`;
/** Everything the row shows, in its words, then the stored row it came from. */
const report = (r: Region) => {
	const p = photoOf(r);
	const s = r.ms / 1000;
	return {
		name: nameOf(r),
		focused: r.id === focus?.id,
		waited: r.msWait == null ? "not timed" : `${secs(r.msWait)} · tap → ${r.photoKey ? "photo" : "map"} on screen`,
		health: health(r),
		saved: `${new Date(r.at).toLocaleString()} (${ago(r.at)})`,
		added: mb(rowBytes(r)),
		tiles: {
			count: r.tiles,
			onDisk: mb(r.bytes),
			added: r.newBytes == null ? "unknown" : mb(r.newBytes),
			ground: `${RADIUS_KM} km radius on whole z${ANCHOR_Z} tiles · z${MIN_Z}–z${MAX_Z}`,
		},
		photo: r.photoKey
			? {
					...specOf(r),
					radiusKm: PHOTO_SPEC.radiusKm,
					size: p ? kb(p.bytes) : "not baked yet",
					addedByThisBlob: ownsPhoto(r) ? "its own photo" : "reuses an earlier blob's photo, added none",
					took: p?.ms == null ? "not timed" : secs(p.ms),
					closeUp: p
						? `${p.closeUp.tiles} raw z${p.zoom} tiles (${kb(p.closeUp.bytes)}) covered · ${closeAddedTiles(r)} added (${kb(closeAddedBytes(r))})`
						: "not baked yet",
				}
			: "follow-me · no pin, no photo",
		fetched: {
			new: r.fetched,
			shared: r.tiles - r.fetched,
			took: secs(r.ms),
			speed: `${(r.fetched / s).toFixed(0)} tiles/s${r.newBytes == null ? "" : ` · ${(r.newBytes / 1048576 / s).toFixed(1)} MB/s`}`,
		},
		painted: r.msPaint == null ? "not yet" : `${secs(r.msPaint)} · ${r.paintMoved ? "moved while landing" : "disk → screen"}`,
		stored: { region: r, photo: p ?? null },
	};
};
let copied = $state<string | null>(null);
async function copyJson(r: Region): Promise<void> {
	try {
		await navigator.clipboard.writeText(JSON.stringify(report(r), null, 2));
		copied = r.id;
	} catch {
		copied = `!${r.id}`;
	}
	setTimeout(() => (copied = null), 1500);
}
// One eye per mount, destroyed with it.
const eyeBlink = untrack(() => ui.createEyeBlink());
onDestroy(() => eyeBlink.destroy());
const photoTotal = $derived(Object.values(photos).reduce((a, b) => a + b.bytes, 0));
/** Stored photos no live blob names: space the phone spends on nothing. */
const unusedPhotos = $derived(Object.keys(photos).filter((k) => !regions.some((r) => r.photoKey === k)));
const unusedBytes = $derived(unusedPhotos.reduce((a, k) => a + photos[k].bytes, 0));

const used = $derived(bytes + photoTotal);
/** The earliest blob on a photo put it on the phone; a later one on the same photo reuses it and added nothing. */
const ownsPhoto = (r: Region): boolean =>
	!!r.photoKey && !regions.some((o) => o.id !== r.id && o.photoKey === r.photoKey && (o.at < r.at || (o.at === r.at && o.id < r.id)));
const photoAdded = (r: Region): number => (ownsPhoto(r) ? (photoOf(r)?.bytes ?? 0) : 0);
const closeAddedTiles = (r: Region): number => (ownsPhoto(r) ? (photoOf(r)?.closeUp.addedTiles ?? 0) : 0);
const closeAddedBytes = (r: Region): number => (ownsPhoto(r) ? (photoOf(r)?.closeUp.addedBytes ?? 0) : 0);
// What the blob ADDED to the phone, not what it covers.
const rowBytes = (r: Region): number => blobBytes(r.newBytes ?? r.bytes, photoAdded(r) + closeAddedBytes(r));
const broken = $derived(regions.filter((r) => (missing[r.id] ?? 0) > 0).length);
const nameOf = (r: Region): string => (r.place ? placeLabel(r.place) : r.id);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const ago = (t: number) => {
	const m = Math.round((Date.now() - t) / 60000);
	return m < 1 ? "now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};
// A pin blob wins over a follow-me blob, which keeps writing wherever the walker is; within a bucket, newest first.
const ordered = $derived(
	[...regions].sort((a, b) => {
		const ap = a.photoKey ? 0 : 1;
		const bp = b.photoKey ? 0 : 1;
		return ap !== bp ? ap - bp : b.at - a.at;
	}),
);
const focus = $derived(ordered[0]);
const rest = $derived(showAll ? ordered.slice(1) : ordered.slice(1, 1 + CAP));

onMount(() => {
	navigator.storage?.estimate?.().then((e) => {
		quota = e.quota ?? null;
	});
});
</script>

<div class="panel dev-card">
	<div class="head dev-card__head">
		<span class="dev-card__title">offline blobs</span>
		<span class="sum">
			{regions.length} areas · {#if broken > 0}<span class="red">{broken} not whole</span><button class="repair" onclick={onRepairAll} disabled={busy} title="fetch every missing tile of every blob, one blob at a time">repair all</button><span>&nbsp;·&nbsp;</span>{/if}{tiles} tiles
			<span class="dim">· {Object.keys(photos).length} photos · {kb(photoTotal)}</span>{#if unusedPhotos.length > 0}<span class="red" title="stored photos no live blob points at: {unusedPhotos.join(' ')}">&nbsp;· {unusedPhotos.length} unused ({kb(unusedBytes)})</span>{/if}
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
						<span class="dot {(missing[r.id] ?? 0) > 0 ? 'evictable' : missing[r.id] === 0 ? 'kept' : 'unknown'}" title={health(r)}></span>
						<button class="name" onclick={() => onFly(r)} title="fly there · {r.id}">{nameOf(r)}</button>
						{#if (missing[r.id] ?? 0) > 0}
							<button class="repair" onclick={() => onRepair(r)} disabled={busy} title="fetch the {missing[r.id]} missing tiles">{missing[r.id]} missing · repair</button>
						{/if}
						<span class="when">🕓 {ago(r.at)}</span>
						<button class="eye" aria-label="see this blob on the map" title="see on map" onclick={() => eyeBlink.blinkThen(() => onFly(r), r.id)}>
							<ui.MaskedFrameIcon src={eyeBlink.srcFor(r.id)} frames={ui.eyeAllFrames} size={23} color="var(--rt-yellow, #ffd700)" />
						</button>
						<span class="bytes">{mb(rowBytes(r))}</span>
						<button class="x" onclick={() => copyJson(r)} title="copy this blob's JSON">{copied === r.id ? "✓" : copied === `!${r.id}` ? "✕" : "⧉"}</button>
						<button class="x" onclick={() => onDelete(r.id)} disabled={busy} title="delete this blob">✕</button>
					</div>
					<div class="layers">
						<div class="layer on wait">
							<span class="dir">⏱</span>
							<span class="ico"></span>
							<span class="lname">waited</span>
							<span class="ldetail">tap → {r.photoKey ? "photo" : "map"} on screen</span>
							<span class="lbytes">{r.msWait == null ? "—" : secs(r.msWait)}</span>
						</div>
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
							{#if r.photoKey}
								{#if ownsPhoto(r)}
									<span class="ldetail">{PHOTO_SPEC.radiusKm} km · {specOf(r).canvasPx} px · {specOf(r).name} z{specOf(r).zoom}</span>
									<span class="lbytes">{#if photoOf(r)?.ms != null}<b class="took">{secs((photoOf(r) as PhotoInfo).ms as number)}</b>{" · "}{/if}{photoOf(r) == null ? "—" : kb((photoOf(r) as PhotoInfo).bytes)}</span>
								{:else}
									<span class="ldetail">reuses an earlier blob's photo</span>
									<span class="lbytes">+0 KB</span>
								{/if}
							{:else}
								<span class="ldetail">follow-me · no pin, no photo</span>
								<span class="lbytes">—</span>
							{/if}
						</div>
						{#if r.photoKey}
							<div class="layer" class:on={(photoOf(r)?.closeUp.tiles ?? 0) > 0}>
								<span class="dir">in</span>
								<span class="ico">🔍</span>
								<span class="lname">close-up</span>
								<span class="ldetail">{closeAddedTiles(r)} new of {photoOf(r)?.closeUp.tiles ?? 0} raw z{specOf(r).zoom} tiles</span>
								<span class="lbytes">{photoOf(r) == null ? "—" : `+${kb(closeAddedBytes(r))}`}</span>
							</div>
						{/if}
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
.panel { overflow: hidden; display: flex; flex-direction: column; max-height: 100%; }
.head { flex-wrap: wrap; gap: 0.4rem 0.75rem; }
.sum { margin-left: auto; color: var(--muted); }
.dim { color: var(--muted); }
.red { color: #e2553f; }
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
/* Deliberately ugly: never mistaken for a normal action. */
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
.row.focused { margin: 0.2rem 0 0.6rem; padding: 0.8rem 0.85rem; border: 1.5px solid #eab627; background: rgba(234, 182, 39, 0.06); border-radius: 10px; }
.focustag { display: inline-flex; align-items: center; gap: 5px; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.08em; color: #221904; background: #eab627; padding: 2px 7px; border-radius: 5px; margin-bottom: 7px; }
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
.layers { display: grid; grid-template-columns: 2.2em 1.4em 5.5em 1fr auto; align-items: baseline; margin-top: 0.15rem; border-radius: 6px; overflow: hidden; }
.layer { display: contents; color: var(--muted); }
.layer > span { padding: 0.18rem 0.3rem; background: rgba(255, 255, 255, 0.03); white-space: nowrap; }
.layer:nth-child(even) > span { background: rgba(255, 255, 255, 0.06); }
.dir { color: #6fb3d9; font-weight: 700; text-align: right; }
.ico { text-align: center; }
.lname { color: var(--text); }
.ldetail { color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.took, .wait .lbytes { color: #ff5a4a; }
.lbytes { color: #eab627; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
.layer:not(.on) > span { opacity: 0.5; }
</style>
