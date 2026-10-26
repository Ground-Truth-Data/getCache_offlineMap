<!-- Squirrel: which satellite source photos bake from, what each served, what it costs. Dev only; the numbers are the Worker's. -->
<script lang="ts">
import FancyButton from "$gc/FancyButton.svelte";
import { photoTilesFor } from "../../lib/onPhone/satellite/satelliteImage";
import { SATELLITE_SOURCES, type SatelliteSource } from "../../lib/contract/satelliteSources";
import { squirrelUrl } from "../../lib/worker/tilesHost";

type Counts = Record<string, number>;
type Answer = { active: string; counts: { today: Counts; month: Counts; all: Counts } | null };

// R2 Standard storage, per GB-month.
const R2_USD_PER_GB = 0.015;
// The projection's planter: 20 pins a month, one photo each.
const USERS = 10_000;
const PINS_PER_USER = 20;

let answer = $state<Answer | null>(null);
let failure = $state<string | null>(null);
let switching = $state(false);

async function load(): Promise<void> {
	failure = null;
	try {
		const res = await fetch(squirrelUrl() ?? "");
		if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
		answer = (await res.json()) as Answer;
	} catch (e) {
		failure = String(e instanceof Error ? e.message : e);
	}
}

async function use(id: string): Promise<void> {
	switching = true;
	try {
		const res = await fetch(squirrelUrl("/active") ?? "", { method: "POST", body: id });
		if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
		await load();
	} catch (e) {
		failure = String(e instanceof Error ? e.message : e);
	} finally {
		switching = false;
	}
}

$effect(() => void load());

const sum = (c: Counts | undefined, id: string, tier: string) =>
	Object.entries(c ?? {}).reduce((n, [k, v]) => (k.startsWith(`${id}|`) && k.endsWith(`|${tier}`) && k.split("|").length === 3 && k.split("|")[1] !== "stored" ? n + v : n), 0);

function row(id: string, src: SatelliteSource) {
	const c = answer?.counts;
	const served = { today: c?.today[`${id}|served`] ?? 0, month: c?.month[`${id}|served`] ?? 0 };
	const upstream = sum(c?.month, id, "upstream");
	const hits = sum(c?.month, id, "edge") + sum(c?.month, id, "r2");
	const hitRate = served.month ? hits / served.month : 0;
	const storedTiles = c?.all[`${id}|stored|tiles`] ?? 0;
	const storedGb = (c?.all[`${id}|stored|bytes`] ?? 0) / 1e9;
	const cost = (upstream / 1000) * src.usdPer1000 + storedGb * R2_USD_PER_GB;
	const perPin = photoTilesFor([-120, 50], src.zoom).length;
	const projectedUpstream = USERS * PINS_PER_USER * perPin * (1 - hitRate);
	const projected = (projectedUpstream / 1000) * src.usdPer1000;
	return { id, src, served, upstream, hits, hitRate, storedTiles, storedGb, cost, perPin, projectedUpstream, projected };
}

const rows = $derived(Object.entries(SATELLITE_SOURCES).map(([id, src]) => row(id, src as SatelliteSource)));
const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString()}`;
const int = (n: number) => Math.round(n).toLocaleString();
</script>

<svelte:head><title>Get Cache | Squirrel</title></svelte:head>

<main class="squirrel">
	<h1>🐿️ Squirrel <span class="dim">satellite sources</span></h1>
	{#if failure}<p class="bad" role="alert">{failure}</p>{/if}
	{#if answer}
		<p>Photos bake from <b>{SATELLITE_SOURCES[answer.active as keyof typeof SATELLITE_SOURCES]?.name ?? answer.active}</b>. {#if !answer.counts}<span class="bad">This Worker has no bucket: no counts and no switch.</span>{/if}</p>
		<div class="table">
			<table>
				<thead>
					<tr><th>Source</th><th>Today</th><th>Month</th><th>Upstream</th><th>Hits</th><th>Hit rate</th><th>In R2</th><th>$/1k</th><th>Month cost</th><th></th></tr>
				</thead>
				<tbody>
					{#each rows as r (r.id)}
						<tr class:on={r.id === answer.active}>
							<td><b>{r.src.name}</b><br /><span class="dim">{r.src.licence}{r.src.cacheToR2 ? "" : " · not cached"}</span></td>
							<td>{int(r.served.today)}</td>
							<td>{int(r.served.month)}</td>
							<td>{int(r.upstream)}</td>
							<td>{int(r.hits)}</td>
							<td>{r.served.month ? `${Math.round(r.hitRate * 100)}%` : "—"}</td>
							<td>{int(r.storedTiles)}<br /><span class="dim">{r.storedGb.toFixed(3)} GB</span></td>
							<td>{usd(r.src.usdPer1000)}</td>
							<td>{usd(r.cost)}</td>
							<td>
								{#if r.id === answer.active}<span class="dim">active</span>
								{:else if answer.counts}<FancyButton size="xs" disabled={switching} onclick={() => use(r.id)}>Use</FancyButton>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr><td>This month</td><td colspan="7"></td><td><b>{usd(rows.reduce((n, r) => n + r.cost, 0))}</b></td><td></td></tr>
				</tfoot>
			</table>
		</div>

		<h2>At {int(USERS)} planters</h2>
		<p class="dim">{PINS_PER_USER} pins each a month, one photo per pin, at this month's hit rate.</p>
		<ul>
			{#each rows as r (r.id)}
				<li><b>{r.src.name}</b>: {int(r.perPin)} tiles a pin (z{r.src.zoom}) → {int(r.projectedUpstream)} upstream tiles → <b>{usd(r.projected)}</b> a month</li>
			{/each}
		</ul>
		<p class="dim">Counts reach the bucket every 100 tiles or 30 s, so the newest few may lag. Cost is upstream at each source's price plus R2 storage at {usd(R2_USD_PER_GB)}/GB-month.</p>
		<FancyButton size="sm" onclick={load}>Refresh</FancyButton>
	{:else if !failure}
		<p class="dim">Asking the Worker…</p>
	{/if}
</main>

<style>
.squirrel {
	padding: 16px;
	color: var(--color-text, #fff);
	background: var(--color-bg, #111);
	min-height: 100dvh;
	font-size: 14px;
}
h1 {
	margin: 0 0 8px;
	font-size: 20px;
}
h2 {
	margin: 20px 0 4px;
	font-size: 16px;
}
.dim {
	opacity: 0.65;
	font-size: 12px;
}
.bad {
	color: var(--color-accent-terracotta, #e07a5f);
}
.table {
	overflow-x: auto;
}
table {
	border-collapse: collapse;
	width: 100%;
}
th,
td {
	padding: 6px 8px;
	text-align: right;
	border-bottom: 1px solid rgb(255 255 255 / 0.12);
	vertical-align: top;
}
th:first-child,
td:first-child {
	text-align: left;
}
tr.on td {
	background: rgb(255 215 0 / 0.08);
}
ul {
	margin: 4px 0 12px;
	padding-left: 18px;
}
</style>
