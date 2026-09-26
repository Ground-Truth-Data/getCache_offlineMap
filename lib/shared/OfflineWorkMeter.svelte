<!-- The breaker panel for BOTH maps; debug routes only, renders nothing outside dev. -->
<script lang="ts">
import "$rig/dev/devCard.css";
import { dev } from "$app/environment";
import { onMount } from "svelte";
import { workStats, resetWorkStats } from "./workMeter.svelte";
import {
	startDataMeter,
	todayBytes,
	todayTotal,
	dailyAverage,
	dataSnapshot,
} from "./dataMeter.svelte";
import {
	HEAP_NOTE,
	collectFocusedBlobReport,
	compactJson,
	debugReportFilename,
} from "./debugReport";

interface Props {
	route?: string;
	/** Read-only snapshot for the export; the toggle UI lives in OfflineConfigPanel. */
	layers?: { key: string; on: boolean }[];
	/** In-flow instead of fixed-to-viewport, for a columned debug page. */
	docked?: boolean;
	focusedBlobName?: string | null;
}
let {
	docked = false,
	route = "map",
	layers = [],
	focusedBlobName = null,
}: Props = $props();

let exporting = $state(false);
let exportMsg = $state("");
let justDid = $state<"copied" | "saved" | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | undefined;

function flash(action: "copied" | "saved") {
	justDid = action;
	clearTimeout(flashTimer);
	flashTimer = setTimeout(() => (justDid = null), 1800);
}

async function buildReport() {
	return collectFocusedBlobReport({
		route,
		heapNowMb: heap,
		heapLowMb: floor,
		heapPeakMb: peak,
		heapAtLoadMb: heap0,
		layers: layers.map((l) => ({ key: l.key, on: l.on })),
	});
}

let exportOpen = $state(false);

$effect(() => {
	if (!exportOpen) return;
	function offClick(e: MouseEvent) {
		const t = e.target as HTMLElement | null;
		if (!t?.closest?.(".export-wrap")) exportOpen = false;
	}
	window.addEventListener("click", offClick, true);
	return () => window.removeEventListener("click", offClick, true);
});

async function exportJson(action: "copied" | "saved") {
	exportOpen = false;
	if (exporting) return;
	exporting = true;
	exportMsg = "";
	try {
		const json = compactJson(await buildReport());
		if (action === "copied") {
			await navigator.clipboard.writeText(json);
		} else {
			const url = URL.createObjectURL(
				new Blob([json], { type: "application/json" }),
			);
			const a = document.createElement("a");
			a.href = url;
			a.download = debugReportFilename();
			a.click();
			// Revoking synchronously can cancel the download before the blob is read.
			setTimeout(() => URL.revokeObjectURL(url), 0);
		}
		flash(action);
	} catch (err) {
		exportMsg = err instanceof Error ? err.message : "export failed";
	} finally {
		exporting = false;
		setTimeout(() => (exportMsg = ""), 2500);
	}
}

let now = $state(Date.now());
let open = $state(true);
let host: HTMLElement | undefined = $state();

/** Chromium only; garbage-inclusive, useful only for its TREND. */
interface MemoryInfo {
	usedJSHeapSize: number;
	totalJSHeapSize: number;
}
function heapMb(): number | null {
	const m = (performance as Performance & { memory?: MemoryInfo }).memory;
	return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
}
let heap = $state<number | null>(null);
let heap0 = $state<number | null>(null);

// The offline map's problem is the interaction SPIKE, which a live read can't catch.
let peak = $state<number | null>(null);
let floor = $state<number | null>(null);
let heapSum = 0;
let heapCount = 0;
let heapAvg = $state<number | null>(null);
const TRACE_MAX = 300;
let heapTrace = $state<{ t: number; mb: number }[]>([]);
let peakAt = $state<number | null>(null);

function resetPeaks(): void {
	peak = heap;
	floor = heap;
	heap0 = heap;
	heapSum = heap ?? 0;
	heapCount = heap === null ? 0 : 1;
	heapAvg = heap;
	heapTrace = heap === null ? [] : [{ t: Date.now(), mb: heap }];
	peakAt = heap === null ? null : Date.now();
}

onMount(() => {
	if (!dev) return;
	// 4Hz: a zoom spike lasts a couple of seconds and a 1s sampler walks past it.
	const id = setInterval(() => {
		now = Date.now();
		const h = heapMb();
		heap = h;
		if (h === null) return;
		if (heap0 === null) heap0 = h;
		if (peak === null || h > peak) {
			peak = h;
			peakAt = Date.now();
		}
		if (floor === null || h < floor) floor = h;
		heapSum += h;
		heapCount += 1;
		heapAvg = Math.round(heapSum / heapCount);
	}, 250);
	const traceId = setInterval(() => {
		const h = heapMb();
		if (h === null) return;
		heapTrace = [...heapTrace.slice(-(TRACE_MAX - 1)), { t: Date.now(), mb: h }];
	}, 1000);
	return () => {
		clearInterval(id);
		clearInterval(traceId);
	};
});

const spark = $derived.by(() => {
	if (heapTrace.length < 2) return null;
	const mbs = heapTrace.map((s) => s.mb);
	const lo = Math.min(...mbs);
	const hi = Math.max(...mbs, lo + 1);
	const x = (i: number) => (i / (mbs.length - 1)) * 300;
	const y = (mb: number) => 40 - ((mb - lo) / (hi - lo)) * 36;
	const points = mbs.map((mb, i) => `${x(i).toFixed(1)},${y(mb).toFixed(1)}`).join(" ");
	const idx = peakAt === null ? -1 : heapTrace.findIndex((s) => s.t === peakAt);
	return { points, peak: idx === -1 ? null : { x: x(idx), y: y(peak!) } };
});

// Portal to <body>: `.mobile-preview-frame`'s `contain: layout` traps
// position:fixed inside the phone frame. Not when docked, or it leaves its rail.
$effect(() => {
	if (docked || !dev || !host || typeof document === "undefined") return;
	document.body.appendChild(host);
	return () => host?.remove();
});

const rows = $derived(workStats());

// Not reset by the Reset button: a budget measured from the last button press is not a budget.
$effect(() => startDataMeter());
const netRows = $derived(todayBytes());
const netTotal = $derived(todayTotal());
const netAvg = $derived(dailyAverage());
async function copyData(): Promise<void> {
	await navigator.clipboard.writeText(JSON.stringify(dataSnapshot(), null, 2));
}

function secs(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtBytes(b: number): string {
	if (b <= 0) return "—";
	if (b < 1024) return `${b}B`;
	if (b < 1024 * 1024) return `${Math.round(b / 1024)}KB`;
	return `${(b / 1024 / 1024).toFixed(1)}MB`;
}
</script>

{#if dev}
	<div class="meter dev-card" class:docked={docked} class:collapsed={!open} bind:this={host}>
		<div class="head-row dev-card__head">
			<button
				class="head"
				onclick={() => (open = !open)}
				title="Offline work meter — counts what runs while you sit still"
			>
				<span class="dev-card__title">CURRENT SESSION</span> {open ? "▾" : "▸"}
			</button>
			<!-- Hand-built SharePicker shape: this child may not import $lib/mobile. -->
			<div class="export-wrap">
				<button
					class="export-trigger"
					class:did={justDid !== null}
					class:on={exportOpen}
					onclick={() => (exportOpen = !exportOpen)}
					disabled={exporting}
					aria-haspopup="menu"
					aria-expanded={exportOpen}
					title="Export as JSON — the focused blob, layers, heap, the work meter (circuits, timings, probes), recent imports: one file"
				>
					{#if justDid !== null}
						<span class="et-ok">✓</span>
					{:else if exporting}
						<span class="et-ok">…</span>
					{:else}
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4.5 14v4.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V14"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
						<span class="et-label">json</span>
					{/if}
				</button>

				{#if exportOpen}
					<div class="export-menu" role="menu">
						{#if focusedBlobName}
							<div class="em-head">{focusedBlobName}</div>
						{/if}
						<button class="em-opt em-opt--active" onclick={() => exportJson("copied")}>
							copy json
						</button>
						<button class="em-opt" onclick={() => exportJson("saved")}>download</button>
						{#if exportMsg}
							<div class="em-err">{exportMsg}</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		{#if heap !== null}
			<div class="heap" title={HEAP_NOTE}>
				<div class="heap-head">
					<span class="heap-title">MEMORY</span>
					<span class="heap-note">resets on refresh · or new blob load</span>
				</div>

				{#each [{ cls: "now", lbl: "now", v: heap }, { cls: "avg", lbl: "avg", v: heapAvg }, { cls: "peak", lbl: "peak", v: peak }] as row (row.cls)}
					{#if row.v !== null}
						<div class="memrow {row.cls}">
							<span class="lbl">{row.lbl}</span>
							<div class="track">
								<div
									class="fill"
									style="width:{peak ? Math.max(4, (row.v / peak) * 100) : 0}%"
								></div>
							</div>
							<span class="val">{row.v} MB</span>
						</div>
					{/if}
				{/each}

				{#if spark}
					<div class="sparkwrap">
						<svg viewBox="0 0 300 44" preserveAspectRatio="none">
							<polyline points={spark.points} fill="none" stroke={"#6fb3d9"} stroke-width="2" />
							{#if spark.peak}
								<circle cx={spark.peak.x} cy={spark.peak.y} r="3.5" fill="#e2553f" />
								<line
									x1={spark.peak.x}
									y1={spark.peak.y}
									x2={spark.peak.x}
									y2="44"
									stroke="#e2553f"
									stroke-width="1"
									stroke-dasharray="2,3"
								/>
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
		{/if}

		{#if open}
			{#if rows.length === 0}
				<div class="empty">nothing has run yet</div>
			{:else}
				<table>
					<tbody>
						{#each rows as r (r.name)}
							<tr class:hot={r.startedAt !== null}>
								<td class="name">{r.name}</td>
								<td class="num" title="runs">{r.runs}</td>
								<td class="num" title="last run">{secs(r.lastMs)}</td>
								<td class="num dim" title="worst run">{secs(r.maxMs)}</td>
								<td class="flags">
									{#if r.startedAt !== null}
										<span class="run">▶ {secs(now - r.startedAt)}</span>
									{/if}
									{#if r.errors > 0}<span class="err">{r.errors}✕</span>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<div class="foot">
				<span class="dim">DROP PIN TO START · LONG PRESS ON MAP</span>
				<button onclick={resetWorkStats}>reset</button>
			</div>

			{#if netRows.length > 0}
				<div class="paysec netsec">
					<div class="payhead">
						data downloaded today
						<span class="big">{fmtBytes(netTotal)}</span>
					</div>
					<table>
						<tbody>
							{#each netRows as n (n.kind)}
								<tr>
									<td class="name">{n.kind}</td>
									<td class="num" title="share of today's download">
										{netTotal > 0 ? `${Math.round((n.bytes / netTotal) * 100)}%` : "—"}
									</td>
									<td class="num">{fmtBytes(n.bytes)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<div class="foot">
						<span class="dim">
							{#if netAvg.days > 0}
								{fmtBytes(netAvg.bytesPerDay)}/day over {netAvg.days} day{netAvg.days === 1 ? "" : "s"}
							{:else}
								first day — an average needs a second
							{/if}
						</span>
						<button onclick={copyData}>copy</button>
					</div>
				</div>
			{/if}

		{/if}
	</div>
{/if}

<style>
.meter.docked {
	position: static;
	left: auto;
	top: auto;
	width: 100%;
	box-sizing: border-box;
	max-width: none;
}

.meter {
	/* Fixed to the VIEWPORT: inside the phone frame it sat under the tab bar. */
	position: fixed;
	left: 10px;
	top: 10px;
	z-index: 99999;
	max-width: 420px;
	pointer-events: auto;
}
.head {
	display: flex;
	align-items: center;
	gap: 6px;
	background: none;
	border: 0;
	color: var(--gold);
	font: inherit;
	padding: 0;
	cursor: pointer;
	white-space: nowrap;
}
table {
	border-collapse: collapse;
	margin-top: 4px;
}
td {
	padding: 1px 5px 1px 0;
	white-space: nowrap;
	vertical-align: top;
}
.name {
	color: var(--blue);
}
.num {
	text-align: right;
	font-variant-numeric: tabular-nums;
}
.dim {
	color: var(--muted);
}
tr.hot .name {
	color: var(--gold);
}
.flags {
	display: flex;
	gap: 5px;
}
.run {
	color: var(--gold);
}
.err {
	color: var(--red);
}
.empty {
	color: var(--muted);
	margin-top: 3px;
}
.heap {
	margin-top: 16px;
}
.heap-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 10px;
	margin-bottom: 10px;
}
.heap-title {
	font-size: 11px;
	font-weight: 800;
	letter-spacing: 0.1em;
	color: var(--muted);
}
.heap-note {
	font-size: 10px;
	color: var(--muted2);
}
.memrow {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 7px;
}
.memrow .lbl {
	width: 30px;
	font-size: 10.5px;
	font-weight: 800;
	letter-spacing: 0.05em;
	color: var(--muted);
	text-transform: uppercase;
}
.memrow .track {
	flex: 1;
	height: 14px;
	background: var(--panel3);
	border-radius: 4px;
	position: relative;
	overflow: hidden;
	border: 1px solid var(--border);
}
.memrow .fill {
	position: absolute;
	left: 0;
	top: 0;
	height: 100%;
	border-radius: 3px;
}
.memrow.now .fill {
	background: var(--blue);
}
.memrow.avg .fill {
	background: var(--muted2);
}
.memrow.peak .fill {
	background: var(--red);
}
.memrow .val {
	width: 58px;
	text-align: right;
	font-weight: 700;
	font-size: 13px;
	color: var(--text);
	font-variant-numeric: tabular-nums;
}
.memrow.peak .val {
	color: var(--red);
}
.memrow.now .val {
	color: var(--blue);
}
.sparkwrap {
	margin-top: 12px;
	padding: 10px 10px 6px;
	background: var(--panel3);
	border: 1px solid var(--border);
	border-radius: 8px;
}
.sparkwrap svg {
	display: block;
	width: 100%;
	height: 44px;
}
.sparklabel {
	display: flex;
	justify-content: space-between;
	font-size: 9.5px;
	color: var(--muted2);
	margin-top: 4px;
}
.sparklabel .spike {
	color: var(--red);
}
.mini {
	background: none;
	border: 0;
	color: var(--muted);
	font: inherit;
	text-decoration: underline;
	cursor: pointer;
	padding: 0;
}
.zero-btn {
	margin-top: 8px;
}
.netsec .big {
	margin-left: auto;
	font-size: 1.35em;
	font-variant-numeric: tabular-nums;
	color: var(--dev-card-accent, #ffd479);
}
.netsec .payhead {
	display: flex;
	align-items: baseline;
	gap: 0.5em;
}

.paysec {
	margin-top: 6px;
	padding-top: 4px;
	border-top: 1px solid var(--border);
}
.payhead {
	display: flex;
	justify-content: space-between;
	gap: 10px;
	color: var(--text);
	margin-bottom: 2px;
}
.foot {
	display: flex;
	justify-content: space-between;
	gap: 10px;
	margin-top: 4px;
	padding-top: 8px;
	border-top: 1px solid var(--border);
}
.foot button {
	background: none;
	border: 0;
	color: var(--muted);
	font: inherit;
	cursor: pointer;
	padding: 0;
	text-decoration: underline;
}

.head-row {
	flex-wrap: wrap;
	gap: 8px 10px;
}
.head-row .head {
	flex: 1 1 auto;
	min-width: 0;
}
.export-wrap {
	flex: 0 0 auto;
	position: relative;
	display: inline-flex;
}
/* Outlined: fill is reserved for the DEFAULT choice in the popup. */
.export-trigger {
	flex: 0 0 auto;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	height: 30px;
	gap: 6px;
	padding: 0 10px;
	border-radius: 9px;
	border: 1px solid #e8b923;
	background: transparent;
	color: #e8b923;
	cursor: pointer;
	font: inherit;
	transition:
		background 80ms ease,
		transform 80ms ease;
}
.export-trigger svg {
	width: 18px;
	height: 18px;
	display: block;
}
.export-trigger:hover:not(:disabled),
.export-trigger.on {
	background: rgba(232, 185, 35, 0.14);
}
.export-trigger:active:not(:disabled) {
	transform: translateY(1px);
}
.export-trigger:disabled {
	opacity: 0.55;
	cursor: default;
}
.export-trigger .et-label {
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.04em;
}
.export-trigger .et-ok {
	font-weight: 800;
	font-size: 14px;
	line-height: 1;
}
.export-menu {
	position: absolute;
	top: calc(100% + 8px);
	right: 0;
	z-index: 40;
	display: flex;
	flex-direction: column;
	gap: 5px;
	padding: 0.5rem;
	border-radius: 10px;
	background: rgba(10, 10, 10, 0.95);
	border: 1px solid rgba(232, 185, 35, 0.5);
	box-shadow: 0 10px 26px rgba(0, 0, 0, 0.55);
	white-space: nowrap;
	animation: export-menu-in 120ms ease-out;
}
.em-head {
	font-family: "JetBrains Mono", ui-monospace, monospace;
	font-size: 9.5px;
	font-weight: 600;
	color: var(--muted);
	padding: 0 2px 2px;
}
.em-opt {
	text-align: left;
	padding: 0.5rem 0.9rem;
	border-radius: 8px;
	border: 1px solid transparent;
	background: transparent;
	color: #e8b923;
	font-family: "Inter", -apple-system, sans-serif;
	font-size: 12.5px;
	font-weight: 700;
	cursor: pointer;
}
.em-opt:hover {
	background: rgba(232, 185, 35, 0.14);
}
/* Hand-matched to Get Cache's .rt-gold-btn, which this child may not import. */
.em-opt--active {
	background: linear-gradient(180deg, #f5d565 0%, #e8b923 100%);
	border-color: transparent;
	color: #1a1405;
	box-shadow:
		0 2px 0 #b8901c,
		0 6px 14px rgba(232, 185, 35, 0.25),
		inset 0 1px 0 rgba(255, 255, 255, 0.45);
}
.em-opt--active:hover {
	background: linear-gradient(180deg, #f5d565 0%, #e8b923 100%);
}
.em-err {
	font-size: 10px;
	color: var(--red, #e2553f);
	max-width: 200px;
	white-space: normal;
	padding: 0 2px;
}
@keyframes export-menu-in {
	from {
		opacity: 0;
	}
	to {
		opacity: 1;
	}
}
.export-trigger.did {
	animation: export-flash 1.8s ease-out;
}
@keyframes export-flash {
	0% {
		background: rgba(127, 191, 106, 0.9);
		border-color: #6fbf6a;
		color: #0d1a0c;
	}
	70% {
		background: rgba(127, 191, 106, 0.9);
		border-color: #6fbf6a;
		color: #0d1a0c;
	}
	100% {
		background: transparent;
		border-color: #e8b923;
		color: #e8b923;
	}
}
</style>
