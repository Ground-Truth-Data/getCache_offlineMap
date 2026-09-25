<script lang="ts">
import "$rig/dev/devCard.css";
/** DEV-ONLY: the worker override sits behind `import.meta.env.DEV` in tilesHost.ts, so a shipped build cannot switch it. */
import { onMount } from "svelte";
import {
	getWorkerTarget,
	LOCAL_DEV_HOST,
	probeTarget,
	setWorkerTarget,
	type WorkerTarget,
} from "../worker/worker-local-dev/tilesHost";
import {
	allCircuits,
	allPaints,
	light,
	probeOf,
	type CircuitState,
	type Light,
} from "../shared/workMeter.svelte";
import { LAYER_TOGGLES } from "../onPhone/render/wallLegend";

let {
	layers = [],
}: {
	layers?: {
		key: string;
		label: string;
		on: boolean;
		toggle: () => void;
		hint?: string;
		disabled?: boolean;
		disabledHint?: string;
	}[];
} = $props();

// ⚠️ Keep worker-local-dev — the only worker reachable without the Cloudflare key.
// ⚠️ init from getWorkerTarget(), never a literal, or prod paints selected until onMount.
let target = $state<WorkerTarget>(getWorkerTarget());

const TARGETS: {
	id: WorkerTarget;
	label: string;
	hint: string;
}[] = [
	{
		id: "worker-cloud-prod",
		label: "worker-cloud-prod",
		hint: "tiles-prod.getcache.org — what every shipped phone talks to. Reads THE one R2 bucket. Deployed by ./deployProduction.sh, which asks for confirmation first.",
	},
	{
		id: "worker-cloud-dev",
		label: "worker-cloud-dev",
		hint: "tiles-dev.getcache.org — a DEPLOYED sandbox worker reading the SAME one R2 bucket as prod, so any difference between them is code, never data. No shipped phone ever reads it.",
	},
	{
		id: "worker-local-dev",
		label: "worker-local-dev",
			// Interpolated so it cannot drift from the constant.
		hint: `${LOCAL_DEV_HOST} — \`npm run dev:local\` in workers/worker-local-dev serves a free sample slice (no Cloudflare account); \`npm run dev:cloud\` runs the SAME local code against the one real R2 bucket (needs wrangler login). Greyed out until that terminal is running, which is expected, not broken.`,
	},
];

// Before the first probe a tier is undefined (neutral, still clickable): a slow probe must never look like a dead Worker.
function reach(t: WorkerTarget): "ok" | "err" | "wait" {
	const p = probeOf(t);
	return p === undefined ? "wait" : p ? "ok" : "err";
}

// Green comes only from paintWatch.ts counting rendered features — a download landing never turns a row green by itself.
const circuits = $derived(allCircuits());
const paints = $derived(allPaints());
const PACK_LAYERS = LAYER_TOGGLES.filter((t) => t.feed === "pack").map((t) => t.key);
function lightOf(circuitKey: string | undefined, layerKeys: readonly string[]): Light {
	void circuits;
	void paints;
	return light(circuitKey, layerKeys);
}
const FEED_OF: Record<string, string | undefined> = Object.fromEntries(
	LAYER_TOGGLES.map((t) => [t.key, t.feed]),
);
const CIRC_WORDS: Record<CircuitState, string> = {
	idle: "nothing asked for yet",
	transit: "request out, nothing back yet",
	ok: "on disk — NOT on screen yet",
	drawn: "on screen",
	err: "broke",
};
const clock = (ms: number | null | undefined) =>
	ms == null ? "" : new Date(ms).toLocaleTimeString(undefined, { hour12: false });
const secs = (ms: number | null) => (ms == null ? "?" : `${(ms / 1000).toFixed(1)}s`);
function circTitle(what: string, l: Light): string {
	const c = l.circuit;
	const bits = [`${what}: ${CIRC_WORDS[l.state]}${c?.note ? " — " + c.note : ""}`];
	if (c?.askedAt != null) bits.push(`asked ${clock(c.askedAt)}`);
	if (c?.arrivedAt != null) bits.push(`on disk +${secs(l.transitMs)}`);
	if (l.state === "drawn") bits.push(`on screen +${secs(l.paintLagMs)} after disk (${l.paint?.count} drawn)`);
	else if (l.state === "ok") bits.push("waiting for the map to paint it");
	return bits.join(" · ");
}

/** Counts from the ask until the thing is ON SCREEN (bytes on disk is not done), then freezes at ask→seen. */
const dlWords = (l: Light): string => {
	if (l.state === "drawn") return l.seenMs == null ? "" : `dl ${secs(l.seenMs)}`;
	// Arrived but zero in view — the count would never end, so freeze at the download time.
	if (l.state === "ok" && l.settledEmpty && l.transitMs != null)
		return `dl ${secs(l.transitMs)} · 0 in view`;
	if (l.state === "transit" || l.state === "ok")
		return l.circuit?.askedAt == null ? "dl …" : `dl ${secs(now - l.circuit.askedAt)}…`;
	return "";
};

let retrying = $state<WorkerTarget | null>(null);

let now = $state(Date.now());

async function pickTarget(t: WorkerTarget) {
	// Selecting a dead tier is allowed — fixing the local worker while pointed at it is the workflow.
	setWorkerTarget(t);
	target = t;
	if (reach(t) === "err") {
		retrying = t;
		const alive = await probeTarget(t);
		retrying = null;
		if (!alive) {
			console.warn(
				`[tiles] ${t} selected while not answering — start it, or click another tier.`,
			);
		}
	}
}

async function probeAll() {
	for (const t of TARGETS) {
		await probeTarget(t.id);
	}
	// ⛔ Never auto-switch tiers — an auto-pick of production silently bills R2 on every fresh install.
	if (reach(target) === "err") {
		console.warn(
			`[tiles] ${target} is not answering — nothing will download until it does. ` +
				(target === "worker-local-dev"
					? "Start it: cd workers/worker-local-dev && npm install && npm run dev:local — or click another tier."
					: "Check VITE_TILES_HOST resolves, or click another tier."),
		);
	}
}

onMount(() => {
	target = getWorkerTarget();
	void probeAll();
	const tick = setInterval(() => (now = Date.now()), 500);
	return () => clearInterval(tick);
});
</script>

<div class="config dev-card">
	<div class="dev-card__head"><span class="dev-card__title">CONFIG</span></div>

	<div class="cfg-title">Workers</div>
	{#each TARGETS as t (t.id)}
		<button
			class="cfg-row"
			class:sel={target === t.id}
			class:dead={reach(t.id) === "err"}
			class:retrying={retrying === t.id}
			onclick={() => pickTarget(t.id)}
			title={reach(t.id) === "err"
				? `${t.label} is not answering — CLICK TO RETRY. ${t.id === "worker-local-dev" ? "Start it: cd getCache_OfflineMap/workers/worker-local-dev && npm install && npm run dev:local — no account needed." : "The Worker was unreachable when last checked."}`
				: t.hint}
		>
			<span class="cfg-label">{t.label}</span>
			{#if retrying === t.id}
				<span class="dead-tag">checking…</span>
			{:else if reach(t.id) === "err"}
				<span class="dead-tag">retry</span>
			{/if}
			{#if target === t.id}
				{@const l = lightOf(`worker:${t.id}`, PACK_LAYERS)}
				{#if dlWords(l)}
					<span class="dl">{dlWords(l)}</span>
				{/if}
				<span class="circ {l.state}" title={circTitle("last pack request", l)}></span>
			{:else}
				<span class="circ blank"></span>
			{/if}
			<span class="sw" class:sw-on={target === t.id}></span>
		</button>
	{/each}
	<div class="cfg-note">
		reads only — this picks where blobs come FROM. Deploying is still
		<code>./deployProduction.sh</code>, which asks for confirmation first.
	</div>

	{#if layers.length > 0}
		<div class="cfg-sep"></div>
		<div class="cfg-title">layers</div>
		{#each layers as l (l.key)}
			<button
				class="cfg-row"
				class:sel={l.on}
				class:dead={l.disabled}
				disabled={l.disabled}
				onclick={l.toggle}
				title={l.disabled
					? (l.disabledHint ?? `${l.label} is not switchable yet`)
					: `Toggle ${l.label} — watch the heap reading in MAP DEBUGGER`}
			>
				<span class="cfg-label">{l.label}</span>
				{#if l.hint}
					<span class="cfg-hint">{l.hint}</span>
				{/if}
				{#if l.disabled}
					<span class="dead-tag">not yet</span>
				{/if}
				{#if FEED_OF[l.key]}
					{@const lt = lightOf(FEED_OF[l.key], [l.key])}
					{#if dlWords(lt)}
						<span class="dl">{dlWords(lt)}</span>
					{/if}
					<span class="circ {lt.state}" title={circTitle(`${FEED_OF[l.key]} download`, lt)}></span>
				{:else}
					<span class="circ blank"></span>
				{/if}
				<span class="sw" class:sw-on={l.on}></span>
			</button>
		{/each}
		<div class="cfg-note dim">any combination · heap updates each second · green = painted in the viewport, yellow = still on its way to the screen</div>
	{/if}
</div>

<style>
.cfg-title {
	font-family: "Inter", -apple-system, sans-serif;
	font-weight: 800;
	font-size: 11px;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--muted);
	margin: 10px 0 6px;
}
.cfg-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	width: 100%;
	background: none;
	border: 0;
	color: var(--muted);
	font: inherit;
	padding: 3px 0;
	cursor: pointer;
	text-align: left;
}
.cfg-label {
	/* Does NOT grow — the hint/tag take the slack so every switch lands on the same right edge. */
	flex: 0 0 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.cfg-row.sel {
	/* Gold, not off-white — off-white read as disabled. */
	color: #ffd24a;
	font-weight: 600;
}
.cfg-row.dead {
	/* Dimmed but clickable — the click is the retry. */
	opacity: 0.55;
	cursor: pointer;
}
.cfg-row.retrying {
	opacity: 0.8;
}
.cfg-hint {
	flex: 1 1 auto;
	min-width: 0;
	margin-left: 6px;
	color: var(--muted);
	font-size: 0.85em;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.cfg-row.sel .cfg-hint {
	/* The hint is not state, so it stays grey. */
	color: var(--muted);
}

.dead-tag {
	flex: 1 1 auto;
	min-width: 0;
	margin-left: auto;
	color: var(--muted);
	font-size: 0.85em;
	text-align: right;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
/* margin-left:auto right-aligns it on worker rows, which have no hint to take the slack. */
.dl {
	flex: 0 0 auto;
	margin-left: auto;
	color: var(--muted);
	font-size: 0.85em;
	white-space: nowrap;
}
/* `ok` (on disk) is deliberately the same yellow as transit — to the user it is still not there. */
.circ {
	flex: 0 0 auto;
	width: 10px;
	height: 10px;
	border-radius: 50%;
	margin-left: auto;
	margin-right: 8px;
	background: #4a4a4a;
	box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.circ.blank {
	background: transparent;
	box-shadow: none;
}
.circ.transit,
.circ.ok {
	background: #e0b428;
}
.circ.drawn {
	background: #35c759;
}
.circ.err {
	background: #e0483e;
}
.cfg-sep {
	border-top: 1px solid #3a3a3a;
	margin: 7px 0 5px;
}
.cfg-note {
	color: var(--muted);
	margin-top: 5px;
	line-height: 1.3;
}
.cfg-note.dim {
	opacity: 0.75;
}
.cfg-note code {
	font: inherit;
	color: var(--muted);
}
.sw {
	flex: 0 0 auto;
	width: 30px;
	height: 16px;
	border-radius: 999px;
	background: #4a4a4a;
	position: relative;
	transition: background 120ms ease;
}
.sw::after {
	content: "";
	position: absolute;
	top: 2px;
	left: 2px;
	width: 12px;
	height: 12px;
	border-radius: 50%;
	background: #fff;
	transition: transform 120ms ease;
}
.sw-on {
	background: #35c759;
}
.sw-on::after {
	transform: translateX(14px);
}
</style>
