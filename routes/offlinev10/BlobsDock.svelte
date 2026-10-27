<script lang="ts">
/** What is on disk: the newest pin blob open, each part naming its source; the rest folded. Squirrel holds the full log. */
import { onDestroy, untrack } from "svelte";
import { SATELLITE_SOURCES, type SourceId } from "../../lib/contract/satelliteSources";
import type { MapUiPorts } from "../../lib/shared/mapHostPorts";
import { FOLLOW_MARGIN_KM } from "./follow";
import { BUDGET_MB } from "./budget";
import { placeLabel } from "./places";
import { ANCHOR_Z, MAX_Z, MIN_Z, RADIUS_KM } from "./tiles";
import { type BlobPart, blobParts, type PhotoInfo } from "./satellite";
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
	photoProblem = null,
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
	/** why photos are not baking, in the host's words; null while they are */
	photoProblem?: string | null;
	onAddHere: () => void;
	onAddForPins: () => void;
	onDelete: (id: string) => void;
	onWipe: () => void;
	onFly: (r: Region) => void;
	onRepair: (r: Region) => void;
	onRepairAll: () => void;
	ui: Pick<MapUiPorts, "MaskedFrameIcon" | "createEyeBlink" | "eyeAllFrames">;
} = $props();

let showAll = $state(false);
let quota = $state<number | null>(null);
let usage = $state<number | null>(null);

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
const partsOf = (r: Region) => blobParts(r, photos, regions);
/** What the blob ADDED to the phone, not what it covers. */
const added = (r: Region) => partsOf(r).reduce((a, p) => a + (p.bytes ?? 0), 0);
const colorOf = (p: BlobPart) => (p.name === "roads" ? "var(--text)" : p.id ? SATELLITE_SOURCES[p.id as SourceId].color : "var(--muted2)");
const health = (r: Region): string =>
	missing[r.id] === undefined ? "not checked yet" : missing[r.id] === 0 ? "whole" : `${missing[r.id]} of ${r.tiles} tiles not on disk`;

let copied = $state<string | null>(null);
async function copyJson(r: Region): Promise<void> {
	try {
		await navigator.clipboard.writeText(JSON.stringify({ region: r, photo: r.photoKey ? (photos[r.photoKey] ?? null) : null, parts: partsOf(r) }, null, 2));
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
const broken = $derived(regions.filter((r) => (missing[r.id] ?? 0) > 0).length);
const nameOf = (r: Region): string => (r.place ? placeLabel(r.place) : r.id);
const secs = (ms: number | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);
const when = (t: number) => {
	const d = new Date(t);
	return `${d.toLocaleString("en-US", { month: "short", day: "2-digit" })} · ${d.toTimeString().slice(0, 5)}`;
};
const ll = (v: number) => v.toFixed(4).replace("-", "−");
// A pin blob wins over a follow-me blob, which keeps writing wherever the walker is; within a bucket, newest first.
const ordered = $derived(
	[...regions].sort((a, b) => {
		const ap = a.pin ? 0 : 1;
		const bp = b.pin ? 0 : 1;
		return ap !== bp ? ap - bp : b.at - a.at;
	}),
);
const focus = $derived(ordered[0]);
const rest = $derived(ordered.slice(1));

// The browser's own count of what this whole site holds: the one number we did not tally ourselves.
$effect(() => {
	void used;
	navigator.storage?.estimate?.().then((e) => {
		quota = e.quota ?? null;
		usage = e.usage ?? null;
	});
});
</script>

<div class="panel dev-card">
	<div class="head dev-card__head">
		<span class="dev-card__title">offline blobs</span>
		<span class="sum">
			{regions.length} areas · {mb(used)}
			{#if broken > 0}<span class="red">· {broken} not whole</span><button class="repair" onclick={onRepairAll} disabled={busy} title="fetch every missing tile of every blob, one blob at a time">repair all</button>{/if}
			{#if unusedPhotos.length > 0}<span class="red" title="stored photos no live blob points at: {unusedPhotos.join(' ')}">· {unusedPhotos.length} unused photos ({mb(unusedBytes)})</span>{/if}
		</span>
		<a class="sqbtn" href="/app/squirrel">Squirrel →</a>
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
	{#if usage !== null}
		<div class="hint" title="everything this site stores in the browser: maps, photos, and the app's own database and caches">on the phone: {tiles} tiles · {mb(used)} counted here · {mb(usage)} the browser reports for the whole site</div>
	{/if}
	{#if failure}
		<div class="fail">✕ {failure}</div>
	{/if}
	{#if photoProblem}
		<div class="fail" title="the photo pass retries every minute and on reload; blobs without a photo get theirs when it clears">✕ photos not baking: {photoProblem}</div>
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

	{#if !focus}
		<div class="empty">nothing on disk<div class="dim">drop a pin to download the first blob</div></div>
	{:else}
		<div class="rows">
			<div class="latest">
				<div class="ltop">
					<span class="tagpill">● {focus.pin ? "LATEST PIN" : "LATEST · NO PIN"} · {when(focus.at)}</span>
					<span class="spacer"></span>
					{#if (missing[focus.id] ?? 0) > 0}
						<button class="repair" onclick={() => onRepair(focus)} disabled={busy} title="fetch the {missing[focus.id]} missing tiles">{missing[focus.id]} missing · repair</button>
					{/if}
					<button class="eye" aria-label="see this blob on the map" title="see on map" onclick={() => eyeBlink.blinkThen(() => onFly(focus), focus.id)}>
						<ui.MaskedFrameIcon src={eyeBlink.srcFor(focus.id)} frames={ui.eyeAllFrames} size={23} color="var(--rt-yellow, #ffd700)" />
					</button>
					<button class="x" onclick={() => copyJson(focus)} title="copy this blob's JSON">{copied === focus.id ? "✓" : copied === `!${focus.id}` ? "✕" : "⧉"}</button>
					<button class="x" onclick={() => onDelete(focus.id)} disabled={busy} title="delete this blob">✕</button>
				</div>
				<div class="line1">
					<button class="name" onclick={() => onFly(focus)} title="fly there · {focus.id}">{nameOf(focus)}</button>
					<span class="bsize" title="what this blob added to the phone">{mb(added(focus))}</span>
				</div>
				<div class="bcoord">{ll(focus.lat)}, {ll(focus.lng)} · {health(focus)}</div>
				<div class="plines">
					{#each partsOf(focus) as p (p.name)}
						<div class="pl">
							<span class="part">{p.name}</span>
							<span class="src" title={p.source}><i style="background:{colorOf(p)}"></i>{p.source}</span>
							<span class="how">
								{#if p.name === "roads"}<span class="grn">R2 hit</span>
								{:else if p.note || p.tiles === null}<span class="dim">{p.note ?? "—"}</span>
								{:else if p.wire}<span class="grn">{p.wire.hit} hit</span> · <span class:amb={p.wire.miss > 0}>{p.wire.miss} upstream</span>{#if p.wire.miss}{#if p.wire.kept}<span class="dim"> · written to R2</span>{:else}<span class="red"> · not saved</span>{/if}{/if}
								{:else if p.name === "close-up"}<span class="dim">with the photo's</span>
								{:else}<span class="dim">baked before counting</span>{/if}
								{#if p.tiles !== null}<span class="dim"> · {p.tiles} tiles</span>{/if}
							</span>
							<span class="mb">{p.bytes === null ? "—" : mb(p.bytes)}</span>
						</div>
					{/each}
				</div>
				<div class="times">waited {secs(focus.msWait)} · fetched {secs(focus.ms)} · painted {focus.paintMoved ? "moved while landing" : secs(focus.msPaint)}</div>
			</div>

			{#if rest.length > 0}
				<button class="more" onclick={() => (showAll = !showAll)}>
					{showAll ? "▾ hide" : "▸ show"} {rest.length} more
					<span class="moresum">{mb(rest.reduce((a, r) => a + added(r), 0))} · since {when(Math.min(...rest.map((r) => r.at))).split(" · ")[0]}</span>
				</button>
				{#if showAll}
					<div class="older">
						{#each rest as r (r.id)}
							<div class="orow">
								<button class="oname" onclick={() => onFly(r)} title="fly there · {r.id} · {health(r)}">{nameOf(r)}</button>
								{#if (missing[r.id] ?? 0) > 0}<button class="repair" onclick={() => onRepair(r)} disabled={busy}>{missing[r.id]} missing</button>{/if}
								<span class="ot">{when(r.at)}</span>
								<span class="os">{mb(added(r))}</span>
								<button class="x" onclick={() => onDelete(r.id)} disabled={busy} title="delete this blob">✕</button>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
.panel { overflow: hidden; display: flex; flex-direction: column; max-height: 100%; }
.head { flex-wrap: wrap; gap: 0.4rem 0.6rem; }
.sum { color: var(--muted); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; }
.spacer { flex: 1; }
.dim { color: var(--muted2, var(--muted)); }
.red { color: #e2553f; }
.grn { color: #7fbf6a; }
.sqbtn { margin-left: auto; border: 1.5px solid #eab627; color: #eab627; background: none; font: 800 0.72rem "Inter", -apple-system, sans-serif; padding: 0.3rem 0.65rem; border-radius: 7px; text-decoration: none; white-space: nowrap; }
.sqbtn:hover { background: rgba(234, 182, 39, 0.1); }
.keep { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; margin: 4px 0 6px; }
.keep.bad { color: #e2553f; }
.budget { margin-left: auto; color: #eab627; font-weight: 700; font-variant-numeric: tabular-nums; }
.budget.full { color: #e2553f; }
.dot { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%; background: #4a4a4a; align-self: center; }
.dot.kept { background: #35c759; }
.dot.evictable { background: #e0483e; }
.fail { color: #e2553f; font-size: 11px; margin: 0 0 6px; line-height: 1.3; }
.repair { background: none; border: 1px solid #e2553f; color: #e2553f; border-radius: 5px; font: inherit; font-size: 0.8em; cursor: pointer; padding: 0 5px; white-space: nowrap; margin-left: 6px; }
/* Deliberately ugly: never mistaken for a normal action. */
.wipe { border: 1px solid #e2553f; color: #e2553f; background: transparent; border-radius: 7px; padding: 0.3rem 0.6rem; cursor: pointer; font: 800 0.7rem "Inter", -apple-system, sans-serif; letter-spacing: 0.03em; }
.add { width: 100%; padding: 6px; font: inherit; cursor: pointer; border-radius: 7px; border: 1px solid var(--gold); background: transparent; color: var(--gold); }
button:disabled { opacity: 0.4; cursor: default; }
.hint { color: var(--muted2); font-size: 11px; margin: 4px 0 4px; }
.follow { color: var(--muted); font-size: 11px; margin: 0 0 8px; font-variant-numeric: tabular-nums; }
.follow.low { color: #eab627; }
.empty { padding: 0.9rem; line-height: 1.5; }
.rows { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.latest { margin: 0.2rem 0 0; padding: 0.8rem 0.85rem; border: 1.5px solid #eab627; background: rgba(234, 182, 39, 0.06); border-radius: 10px; }
.ltop { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 6px; }
.tagpill { display: inline-flex; align-items: center; gap: 5px; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 0.66rem; font-weight: 800; letter-spacing: 0.08em; color: #221904; background: #eab627; padding: 2px 7px; border-radius: 5px; }
.line1 { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.name { all: unset; cursor: pointer; font-weight: 700; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bsize { font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 700; font-size: 14px; color: #eab627; white-space: nowrap; }
.bcoord { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; color: var(--muted); margin-top: 4px; }
.plines { margin-top: 10px; display: flex; flex-direction: column; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.pl { display: grid; grid-template-columns: 58px 108px 1fr auto; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px dashed rgba(255, 255, 255, 0.1); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; }
.pl:last-child { border-bottom: none; }
.part { color: var(--muted); }
.src { display: flex; align-items: center; gap: 6px; font-weight: 700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.src i { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.how { font-size: 10.5px; }
.pl .mb { font-weight: 700; text-align: right; white-space: nowrap; }
.times { margin-top: 6px; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 10.5px; color: var(--muted); }
.eye { all: unset; cursor: pointer; display: inline-flex; align-items: center; line-height: 0; }
.eye:active { transform: scale(0.9); }
.x { background: none; border: 1px solid rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.6); border-radius: 5px; font: inherit; cursor: pointer; padding: 0 5px; }
.more { display: flex; align-items: center; gap: 8px; width: 100%; margin: 12px 0 8px; padding: 9px 12px; border: 1px dashed rgba(255, 255, 255, 0.2); border-radius: 9px; background: none; color: var(--muted); font: 700 11px "JetBrains Mono", ui-monospace, monospace; cursor: pointer; text-align: left; }
.more:hover { color: var(--text); }
.moresum { margin-left: auto; font-weight: 500; opacity: 0.7; }
.older { opacity: 0.6; }
.orow { display: flex; align-items: baseline; gap: 10px; padding: 7px 0; border-top: 1px dashed rgba(255, 255, 255, 0.1); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; }
.oname { all: unset; cursor: pointer; flex: 1; min-width: 0; font: 600 13px "Inter", -apple-system, sans-serif; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ot { color: var(--muted2, var(--muted)); white-space: nowrap; }
.os { font-weight: 700; min-width: 56px; text-align: right; white-space: nowrap; }
</style>
