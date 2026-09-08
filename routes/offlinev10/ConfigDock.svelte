<script lang="ts">
/**
 * CONFIG — which tiles Worker blobs come from, read-through, and one switch
 * per pyramid layer. THE CIRCLE: grey = never asked · yellow = asked, or on
 * disk but not on screen · green = painted in the viewport after the bytes
 * landed · red = broke. The dl label is a stopwatch, ask → seen.
 */
import { onMount } from "svelte";
import { type WorkerTarget, hostFor, probeTarget } from "../../lib/worker/worker-local-dev/tilesHost";
import { BUDGET_MB, BUDGET_PRESETS_MB } from "./budget";

export type Light = "idle" | "transit" | "ok" | "drawn" | "err";
export interface LayerRow {
	key: string;
	label: string;
	ids: string[];
	on: boolean;
	painted: boolean;
}

let {
	tier,
	onTier,
	readThrough,
	onReadThrough,
	light = "idle",
	dlStart = null,
	dlMs = null,
	layers = [],
	onLayer,
	budgetMb = BUDGET_MB,
	onBudget,
}: {
	tier: WorkerTarget;
	onTier: (t: WorkerTarget) => void;
	readThrough: boolean;
	onReadThrough: (on: boolean) => void;
	light?: Light;
	/** performance.now() when the current ask started */
	dlStart?: number | null;
	/** ask → painted, frozen once seen */
	dlMs?: number | null;
	layers?: LayerRow[];
	onLayer: (key: string) => void;
	/** the budget in force; a tap cycles the presets so the wall can be hit in minutes */
	budgetMb?: number;
	onBudget: (mb: number) => void;
} = $props();

function nextBudget(): void {
	const i = BUDGET_PRESETS_MB.indexOf(budgetMb as (typeof BUDGET_PRESETS_MB)[number]);
	onBudget(BUDGET_PRESETS_MB[(i + 1) % BUDGET_PRESETS_MB.length]);
}

const TARGETS = (["worker-cloud-prod", "worker-cloud-dev", "worker-local-dev"] as const).map((id) => ({
	id,
	hint: hostFor(id) ?? "(unconfigured)",
}));
type Reach = "?" | "ok" | "err";
let reach = $state<Record<string, Reach>>({});
let retrying = $state<WorkerTarget | null>(null);
let now = $state(performance.now());

async function probe(t: WorkerTarget): Promise<void> {
	retrying = t;
	reach = { ...reach, [t]: (await probeTarget(t)) ? "ok" : "err" };
	retrying = null;
}

function pick(t: WorkerTarget): void {
	if (reach[t] === "err") void probe(t);
	onTier(t);
}

const circ = $derived(
	light === "transit" || light === "ok" ? "ok" : light === "drawn" ? "drawn" : light === "err" ? "err" : "",
);
const dlWords = $derived(
	light === "err"
		? "failed"
		: light === "drawn" && dlMs !== null
			? `dl ${(dlMs / 1000).toFixed(1)}s`
			: (light === "transit" || light === "ok") && dlStart !== null
				? `dl ${((now - dlStart) / 1000).toFixed(1)}s`
				: "",
);

onMount(() => {
	for (const t of TARGETS) void probe(t.id);
	const tick = setInterval(() => (now = performance.now()), 250);
	return () => clearInterval(tick);
});
</script>

<div class="config dev-card">
	<div class="dev-card__head"><span class="dev-card__title">config</span></div>

	<div class="cfg-title">Workers</div>
	{#each TARGETS as t (t.id)}
		<button
			class="cfg-row"
			class:sel={tier === t.id}
			class:dead={reach[t.id] === "err"}
			onclick={() => pick(t.id)}
			title={reach[t.id] === "err" ? `${t.id} is not answering — click to retry` : t.hint}
		>
			<span class="cfg-label">{t.id}</span>
			{#if retrying === t.id}
				<span class="dead-tag">checking…</span>
			{:else if reach[t.id] === "err"}
				<span class="dead-tag">retry</span>
			{/if}
			{#if tier === t.id}
				{#if dlWords}<span class="dl">{dlWords}</span>{/if}
				<span class="circ {circ}" title="last blob: grey never asked · yellow asked or on disk · green painted · red broke"></span>
			{:else}
				<span class="circ blank"></span>
			{/if}
			<span class="sw" class:sw-on={tier === t.id}></span>
		</button>
	{/each}
	<button class="cfg-row" class:sel={readThrough} onclick={() => onReadThrough(!readThrough)}>
		<span class="cfg-label">read-through when online</span>
		<span class="cfg-hint">off = airplane-mode truth</span>
		<span class="circ blank"></span>
		<span class="sw" class:sw-on={readThrough}></span>
	</button>
	<button class="cfg-row" class:sel={budgetMb !== BUDGET_MB} onclick={nextBudget} title="tap to cycle {BUDGET_PRESETS_MB.join(' / ')} MB — the store refuses the batch that would cross it">
		<span class="cfg-label">budget {budgetMb} MB</span>
		<span class="cfg-hint">{budgetMb === BUDGET_MB ? "the product line · tap to shrink" : `test line · ${BUDGET_MB} is the product`}</span>
		<span class="circ blank"></span>
		<span class="sw" class:sw-on={budgetMb !== BUDGET_MB}></span>
	</button>
	<div class="cfg-note">reads only — this picks where blobs come FROM. Nothing here deploys anything.</div>

	{#if layers.length > 0}
		<div class="cfg-sep"></div>
		<div class="cfg-title">layers</div>
		{#each layers as l (l.key)}
			<button class="cfg-row" class:sel={l.on} onclick={() => onLayer(l.key)} title="toggle {l.label} — watch MEMORY">
				<span class="cfg-label">{l.label}</span>
				<span class="cfg-hint">pyramid · {l.ids.length}</span>
				{#if l.on}
					<span class="circ" class:drawn={l.painted} title={l.painted ? "painted in the viewport" : "on, nothing of it on screen"}></span>
				{:else}
					<span class="circ blank"></span>
				{/if}
				<span class="sw" class:sw-on={l.on}></span>
			</button>
		{/each}
		<div class="cfg-note dim">any combination · heap updates each second · green = painted in the viewport</div>
	{/if}
</div>

<style>
/* Shell + title come from devCard.css (.dev-card) — same look as CURRENT SESSION and OFFLINE BLOBS. */
.cfg-title { font-family: "Inter", -apple-system, sans-serif; font-weight: 800; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 10px 0 6px; }
.cfg-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; background: none; border: 0; color: var(--muted); font: inherit; padding: 3px 0; cursor: pointer; text-align: left; }
.cfg-label { flex: 0 0 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfg-row.sel { color: #ffd24a; font-weight: 600; }
/* Dimmed but CLICKABLE — the click is the retry. */
.cfg-row.dead { opacity: 0.55; }
.cfg-hint { flex: 1 1 auto; min-width: 0; margin-left: 6px; color: var(--muted); font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cfg-row.sel .cfg-hint { color: var(--muted); }
.dead-tag { flex: 1 1 auto; min-width: 0; margin-left: auto; color: var(--muted); font-size: 0.85em; text-align: right; white-space: nowrap; }
.dl { flex: 0 0 auto; margin-left: auto; color: var(--muted); font-size: 0.85em; white-space: nowrap; }
/* THE CIRCLE — muted grey (not black) so "never asked" doesn't read as failure; `ok` is the SAME yellow as transit: to the user it is still "not there yet". */
.circ { flex: 0 0 auto; width: 10px; height: 10px; border-radius: 50%; margin-left: auto; margin-right: 8px; background: #4a4a4a; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }
.circ.blank { background: transparent; box-shadow: none; }
.circ.ok { background: #e0b428; }
.circ.drawn { background: #35c759; }
.circ.err { background: #e0483e; }
.cfg-sep { border-top: 1px solid #3a3a3a; margin: 7px 0 5px; }
.cfg-note { color: var(--muted); margin-top: 5px; line-height: 1.3; }
.cfg-note.dim { opacity: 0.75; }
.sw { flex: 0 0 auto; width: 30px; height: 16px; border-radius: 999px; background: #4a4a4a; position: relative; transition: background 120ms ease; }
.sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform 120ms ease; }
.sw-on { background: #35c759; }
.sw-on::after { transform: translateX(14px); }
</style>
