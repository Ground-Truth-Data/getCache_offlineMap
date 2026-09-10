<script lang="ts">
/**
 * CURRENT SESSION — main-thread memory (now / avg / peak + a session
 * sparkline), the freezes (every main-thread stall over 50 ms, stamped with
 * what the page was doing), the live download, the last blob's clock, and
 * tile reads.
 * The card is the old map's; every number is V10's.
 */
import { onMount } from "svelte";
import type { Progress } from "./download";
import { readCounts, resetReadCounts } from "./protocol";
import { PHOTO_SPEC, type PhotoInfo, photoKey } from "./satellite";
import type { Kept, Region } from "./store";
import type { WorkerTarget } from "../../lib/worker/worker-local-dev/tilesHost";

let {
	progress = null,
	last = null,
	regions = [],
	photos = {},
	tier,
	kept = "unknown",
	budgetMb = 0,
	bytes = 0,
}: {
	progress: Progress | null;
	last: Region | null;
	regions: Region[];
	/** bytes on disk per photo key */
	photos: Record<string, PhotoInfo>;
	tier: WorkerTarget;
	kept?: Kept;
	budgetMb?: number;
	/** tile bytes on disk */
	bytes?: number;
} = $props();

/** A blob plus its photo's bytes and source (null until baked) — the JSON shape. */
const lastPhoto = $derived(last ? photos[photoKey(last.lng, last.lat)] : undefined);
const withPhoto = (r: Region) => {
	const p = photos[photoKey(r.lng, r.lat)];
	return {
		...r,
		photoBytes: p?.bytes ?? null,
		photoSource: p?.source ?? null,
		photoZoom: p?.zoom ?? null,
		photoPx: p?.canvasPx ?? null,
	};
};

const MAX_TRACE = 300;
const HEAP_NOTE =
	"main thread only — performance.memory excludes workers; DevTools › Memory › VM instances has the rest";

let heap = $state<number | null>(null);
let peak = $state<number | null>(null);
let trace = $state<number[]>([]);
let hit = $state(0);
let miss = $state(0);
let net = $state(0);
let exportState = $state<"idle" | "busy" | "ok" | "err">("idle");

/** A main-thread stall, stamped with what the page was doing when it hit. */
interface Freeze {
	/** ms since the dock mounted */
	at: number;
	ms: number;
	heapMb: number | null;
	downloading: boolean;
	/** tile reads answered since the last tick — the burst the stall landed in */
	reads: number;
}
const MAX_FREEZES = 12;
/** A stall this long is the "it froze" the user reports; shorter ones are jank. */
const FREEZE_RED_MS = 300;
let freezes = $state<Freeze[]>([]);
let freezeCount = $state(0);
const worstFreeze = $derived(freezes.reduce((m, f) => Math.max(m, f.ms), 0));

const mb = (b: number) => (b / 1048576).toFixed(1);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const avg = $derived(
	trace.length ? Math.round(trace.reduce((a, b) => a + b, 0) / trace.length) : null,
);
const lo = $derived(
	trace.length ? trace.reduce((m, v) => Math.min(m, v), trace[0]) : 0,
);
const hi = $derived(
	trace.length ? trace.reduce((m, v) => Math.max(m, v), lo + 1) : 1,
);
const y = (v: number) => 40 - ((v - lo) / (hi - lo)) * 36;
const sparkPoints = $derived(
	trace.length < 2
		? null
		: trace.map((v, i) => `${(i / (trace.length - 1)) * 300},${y(v)}`).join(" "),
);
const peakX = $derived(
	trace.length < 2 || peak === null ? null : (trace.indexOf(peak) / (trace.length - 1)) * 300,
);

function resetPeaks(): void {
	trace = heap === null ? [] : [heap];
	peak = heap;
	freezes = [];
	freezeCount = 0;
}

async function exportJson(): Promise<void> {
	exportState = "busy";
	try {
		const report = {
			page: "offlineV10",
			at: new Date().toISOString(),
			tier,
			memoryMb: { now: heap, avg, peak },
			readsLastBurst: { disk: hit, miss, net },
			freezes: { count: freezeCount, worstMs: worstFreeze, last: freezes },
			storage: {
				kept,
				budgetMb,
				tilesMb: Number(mb(bytes)),
				photosMb: Number(mb(Object.values(photos).reduce((a, p) => a + p.bytes, 0))),
			},
			photo: PHOTO_SPEC,
			lastBlob: last ? withPhoto(last) : null,
			blobs: regions.map(withPhoto),
		};
		await navigator.clipboard.writeText(JSON.stringify(report));
		exportState = "ok";
	} catch {
		exportState = "err";
	}
	setTimeout(() => (exportState = "idle"), 1500);
}

onMount(() => {
	const id = setInterval(() => {
		const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
		if (m) {
			heap = Math.round(m.usedJSHeapSize / 1048576);
			if (peak === null || heap > peak) peak = heap;
			trace = [...trace.slice(-(MAX_TRACE - 1)), heap];
		}
		const c = readCounts();
		if (c.hit + c.miss + c.net > 0) {
			hit = c.hit;
			miss = c.miss;
			net = c.net;
			resetReadCounts();
		}
	}, 1000);
	// Long tasks are the freeze itself, measured by the browser; buffered so the boot stalls are in the list too.
	let stalls: PerformanceObserver | null = null;
	try {
		stalls = new PerformanceObserver((list) => {
			for (const e of list.getEntries()) {
				const c = readCounts();
				const f: Freeze = {
					at: Math.round(e.startTime),
					ms: Math.round(e.duration),
					heapMb: heap,
					downloading: progress !== null,
					reads: c.hit + c.miss + c.net,
				};
				freezes = [...freezes.slice(-(MAX_FREEZES - 1)), f];
				freezeCount++;
			}
		});
		stalls.observe({ type: "longtask", buffered: true });
	} catch {
		// no long-task timing in this browser — the block shows nothing, never a false "none"
		stalls = null;
	}
	return () => {
		clearInterval(id);
		stalls?.disconnect();
	};
});
</script>

<div class="meter dev-card">
	<div class="dev-card__head">
		<span class="dev-card__title">current session</span>
		<button class="export" onclick={exportJson} title="copy a JSON report of this session to the clipboard">
			{#if exportState === "ok"}<span class="et-ok">✓</span>{:else if exportState === "busy"}…{:else if exportState === "err"}✕{:else}↥{/if}
			<span class="et-label">json</span>
		</button>
	</div>

	{#if heap !== null}
		<div class="heap" title={HEAP_NOTE}>
			<div class="heap-head">
				<span class="heap-title">MEMORY</span>
				<span class="heap-note">resets on refresh · or zero</span>
			</div>
			{#each [{ cls: "now", lbl: "now", v: heap }, { cls: "avg", lbl: "avg", v: avg }, { cls: "peak", lbl: "peak", v: peak }] as row (row.cls)}
				{#if row.v !== null}
					<div class="memrow {row.cls}">
						<span class="lbl">{row.lbl}</span>
						<div class="track">
							<div class="fill" style="width:{peak ? Math.max(4, (row.v / peak) * 100) : 0}%"></div>
						</div>
						<span class="val">{row.v} MB</span>
					</div>
				{/if}
			{/each}
			{#if sparkPoints}
				<div class="sparkwrap">
					<svg viewBox="0 0 300 44" preserveAspectRatio="none">
						<polyline points={sparkPoints} fill="none" stroke="#6fb3d9" stroke-width="2" />
						{#if peakX !== null && peak !== null}
							<circle cx={peakX} cy={y(peak)} r="3.5" fill="#e2553f" />
							<line x1={peakX} y1={y(peak)} x2={peakX} y2="44" stroke="#e2553f" stroke-width="1" stroke-dasharray="2,3" />
						{/if}
					</svg>
					<div class="sparklabel">
						<span>session start</span>
						<span class="spike">peak spike</span>
						<span>now</span>
					</div>
				</div>
			{/if}
			<button class="mini zero-btn" onclick={resetPeaks}>zero</button>
		</div>
	{:else}
		<div class="hint">no heap reading in this browser — Chrome has performance.memory</div>
	{/if}

	<div class="freezes">
		<div class="heap-head">
			<span class="heap-title">FREEZES</span>
			<span class="heap-note">main-thread stalls over 50 ms · zero clears</span>
		</div>
		{#if freezeCount === 0}
			<div class="hint">none this session</div>
		{:else}
			<div class="freeze-sum">
				<span class="num">{freezeCount}</span> <span class="dim">stalls · worst</span>
				<span class="num" class:red={worstFreeze >= FREEZE_RED_MS}>{worstFreeze} ms</span>
			</div>
			<table class="clock">
				<tbody>
					{#each freezes.slice(-6).reverse() as f (f.at)}
						<tr>
							<td class="name">+{(f.at / 1000).toFixed(1)}s</td>
							<td class="num" class:red={f.ms >= FREEZE_RED_MS}>{f.ms} ms</td>
							<td class="dim">{f.heapMb === null ? "–" : `${f.heapMb} MB`}{f.downloading ? " · downloading" : ""}{f.reads ? ` · ${f.reads} reads` : ""}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<div class="live" class:on={progress !== null}>
		{#if progress}
			<strong>downloading…</strong>
			<span class="secs">{progress.done}/{progress.total}</span>
			<span class="dim">· {mb(progress.bytes)} MB · {secs(progress.ms)}</span>
		{:else if last}
			<strong class="dim">idle</strong>
			<span class="dim">· last blob {last.fetched} new of {last.tiles} · {last.newBytes == null ? "—" : mb(last.newBytes)} MB{#if lastPhoto}{` · photo ${Math.round(lastPhoto.bytes / 1024)} KB ${lastPhoto.source}`}{/if}</span>
		{:else}
			<strong class="dim">idle</strong>
			<span class="dim">· no blob loaded yet</span>
		{/if}
	</div>
	{#if last}
		<table class="clock">
			<tbody>
				<tr><td class="name">ask → disk</td><td class="num">{secs(last.ms)}</td><td class="dim">{last.fetched} fetched</td></tr>
				<tr><td class="name">disk → painted</td><td class="num">{last.msPaint == null ? "…" : secs(last.msPaint)}</td><td class="dim">map idle</td></tr>
			</tbody>
		</table>
	{/if}
	<div class="reads">
		<span class="dim">READS last burst</span>
		<span class="num">{hit} disk · {miss} miss · {net} net</span>
	</div>

	<div class="foot">
		<span class="dim">DROP PIN TO START · LONG PRESS ON MAP</span>
		<button onclick={() => { hit = miss = net = 0; }}>clear counts</button>
	</div>
</div>

<style>
/* Shell + title come from devCard.css (.dev-card); the memory block matches the old map's .memrow/.sparkwrap. */
.export {
	margin-left: auto;
	display: inline-flex;
	align-items: center;
	gap: 5px;
	background: none;
	border: 1px solid var(--gold);
	color: var(--gold);
	border-radius: 7px;
	padding: 2px 8px;
	font: inherit;
	cursor: pointer;
}
.et-ok { color: var(--green); }
.et-label { font-weight: 700; }
.heap { margin-top: 4px; }
.heap-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.heap-title { font-size: 11px; font-weight: 800; letter-spacing: 0.1em; color: var(--muted); }
.heap-note { font-size: 10px; color: var(--muted2); }
.memrow { display: flex; align-items: center; gap: 10px; margin-top: 7px; }
.memrow .lbl { width: 30px; font-size: 10.5px; font-weight: 800; letter-spacing: 0.05em; color: var(--muted); text-transform: uppercase; }
.memrow .track { flex: 1; height: 14px; background: var(--panel3); border-radius: 4px; position: relative; overflow: hidden; border: 1px solid var(--border); }
.memrow .fill { position: absolute; left: 0; top: 0; height: 100%; border-radius: 3px; }
.memrow.now .fill { background: var(--blue); }
.memrow.avg .fill { background: var(--muted2); }
.memrow.peak .fill { background: var(--red); }
.memrow .val { width: 58px; text-align: right; font-weight: 700; font-size: 13px; color: var(--text); font-variant-numeric: tabular-nums; }
.memrow.peak .val { color: var(--red); }
.memrow.now .val { color: var(--blue); }
.sparkwrap { margin-top: 12px; padding: 10px 10px 6px; background: var(--panel3); border: 1px solid var(--border); border-radius: 8px; }
.sparkwrap svg { display: block; width: 100%; height: 44px; }
.sparklabel { display: flex; justify-content: space-between; font-size: 9.5px; color: var(--muted2); margin-top: 4px; }
.sparklabel .spike { color: var(--red); }
.mini { background: none; border: 0; color: var(--muted); font: inherit; text-decoration: underline; cursor: pointer; padding: 0; }
.zero-btn { margin-top: 8px; }
.hint { color: var(--muted2); font-size: 11px; }
.freezes { margin-top: 14px; }
.freeze-sum { display: flex; gap: 0.35em; align-items: baseline; font-variant-numeric: tabular-nums; }
.freeze-sum .num, .clock .num { font-weight: 700; }
.red { color: var(--red); }
/* LIVE ROW — dim when idle so it never competes with the numbers, lit while working. */
.live { display: flex; align-items: baseline; gap: 0.35em; padding: 10px 0 0; font-variant-numeric: tabular-nums; }
.live.on strong { color: var(--gold); }
.secs { font-weight: 700; }
.dim { color: var(--muted); }
.clock { border-collapse: collapse; margin-top: 4px; width: 100%; }
.clock td { padding: 1px 0; }
.clock .name { color: var(--muted); }
.clock .num { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; padding-right: 10px; }
.reads { display: flex; justify-content: space-between; gap: 10px; margin-top: 8px; }
.reads .num { font-weight: 700; font-variant-numeric: tabular-nums; }
.foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border); }
.foot button { background: none; border: 0; color: var(--muted); font: inherit; cursor: pointer; padding: 0; text-decoration: underline; }
</style>
