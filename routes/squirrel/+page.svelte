<!-- Squirrel: every imagery source side by side: what it served, pulled upstream, kept in R2 and costs. Dev only. Numbers are the Worker's counts and this browser's blobs; "—" means nothing measures it yet. -->
<script lang="ts">
import { SATELLITE_SOURCES, type SatelliteSource, type SourceId, sourceOf } from "../../lib/contract/satelliteSources";
import { loadCamera, MAP_HOME_CENTER } from "../../lib/mapState/mapViewport";
import { forcedImagery, forceImagery } from "../../lib/onPhone/satellite/onlineImagery";
import { photoTilesFor } from "../../lib/onPhone/satellite/satelliteImage";
import { satelliteTileUrl, squirrelUrl } from "../../lib/worker/tilesHost";
import { placeLabel } from "../offlinev10/places";
import { type BlobPart, type PhotoInfo, blobParts, photoInfo } from "../offlinev10/satellite";
import { type Region, listRegions } from "../offlinev10/store";
import { rangeBox } from "../offlinev10/tiles";

type Counts = Record<string, number>;
type Answer = { active: string; standby: string[]; cache: Record<string, boolean>; counts: { today: Counts; month: Counts; all: Counts } | null };
type Lic = "ok" | "tos";
type Row = {
	id: string;
	name: string;
	sub: string;
	color: string;
	lic: Lic;
	licText: string;
	licence: string;
	cache: boolean;
	/** a standby source's switch: on, off, or unknown until the Worker answers */
	standby?: boolean | null;
	/** the Worker stops it at 90% of its free tier */
	stops?: boolean;
	/** why the toggle cannot be switched on */
	lock: string | null;
	z: string | null;
	today: number | null;
	month: number | null;
	up: number | null;
	hits: number | null;
	tiles: number | null;
	gb: number | null;
	price: string;
	unit: string;
	free: number | null;
	mtd: number | null;
	/** one cost per HIT_RATES entry */
	proj: number[] | null;
	projNote?: string;
	/** tiles the projection asks of a cached source, before any R2 hit */
	projTiles?: number;
};

// R2 list price: Standard storage per GB-month, Class A (write) and Class B (read) per million.
const R2 = { storage: 0.015, write: 4.5, read: 0.36 };
// The projection's planter: 20 pins a month, one photo each; only pin photos fetch MapTiler.
const USERS = 10_000;
const PINS_PER_USER = 20;
// Crews plant the same blocks, so most of a pin's tiles were already fetched by a crewmate.
const HIT_RATES = [0.5, 0.7, 0.9];
// MapTiler Flex includes 500k requests a month; Esri's free tier is in the contract because the Worker stops at 90% of it.
const INCLUDED: Record<string, number> = { maptiler: 500_000 };
// Mapbox bills the online map per load, not per tile: 50k free, then $ per 1,000 falling by tier (mapbox.com/pricing, Oct 2026).
const MAPBOX_LOADS = { free: 50_000, tiers: [[100_000, 5], [200_000, 4], [1_000_000, 3], [Infinity, 2.5]] as const };
const OPENS_PER_DAY = 3;
const loadsCost = (n: number) =>
	MAPBOX_LOADS.tiers.reduce((usd, [upTo, per], i) => {
		const from = i ? MAPBOX_LOADS.tiers[i - 1][0] : MAPBOX_LOADS.free;
		return usd + (Math.max(0, Math.min(n, upTo) - from) / 1000) * per;
	}, 0);
const LOADS = USERS * OPENS_PER_DAY * 30;

const LOOK: Record<string, { sub: string; lic: Lic; licText: string; lock?: string }> = {
	maptiler: { sub: "satellite-v2 · pin photos", lic: "ok", licText: "R2 approved" },
	sentinel: { sub: "cloudless 2016 · online map", lic: "ok", licText: "CC BY 4.0" },
	esri: { sub: "World Imagery · streamed", lic: "tos", licText: "ToS forbids", lock: 'Esri E204 §3.2c: "may not … store Data"' },
	usgs: { sub: "ImageryOnly · US", lic: "ok", licText: "public domain" },
	mapbox: { sub: "satellite · standby", lic: "tos", licText: "stream only", lock: "Mapbox ToS: no caching outside the SDK" },
};
const BC_COLOR = "oklch(0.74 0.10 190)";
const ROADS_COLOR = "#f3f1e9";

let answer = $state<Answer | null>(null);
let failure = $state<string | null>(null);
let regions = $state<Region[]>([]);
let photos = $state<Record<string, PhotoInfo>>({});
let sel = $state<string | null>(null);
let open = $state(new Set<string>());

async function load(): Promise<void> {
	failure = null;
	try {
		const res = await fetch(squirrelUrl() ?? "");
		if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
		answer = (await res.json()) as Answer;
	} catch (e) {
		failure = String(e instanceof Error ? e.message : e);
	}
	[regions, photos] = await Promise.all([listRegions(), photoInfo()]);
	if (sel === null && regions[0]) {
		sel = regions[0].id;
		open = new Set([sel]);
	}
}

$effect(() => void load());

async function flip(sw: "standby" | "cache", id: string, on: boolean): Promise<void> {
	failure = null;
	try {
		const res = await fetch(squirrelUrl(`/${sw}/${id}`) ?? "", { method: "POST", body: on ? "on" : "off" });
		if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
		const { standby, cache } = (await res.json()) as Pick<Answer, "standby" | "cache">;
		if (answer) answer = { ...answer, standby, cache };
	} catch (e) {
		failure = String(e instanceof Error ? e.message : e);
	}
}

/** `source|z|tier` counts for one source, summed over the tiers named. */
const tiers = (c: Counts | undefined, id: string, ...want: string[]) =>
	Object.entries(c ?? {}).reduce((n, [k, v]) => {
		const [s, z, t] = k.split("|");
		return s === id && /^\d+$/.test(z) && want.includes(t) ? n + v : n;
	}, 0);
const zooms = (c: Counts | undefined, id: string) =>
	Object.keys(c ?? {}).flatMap((k) => {
		const [s, z] = k.split("|");
		return s === id && /^\d+$/.test(z) ? [Number(z)] : [];
	});

function sourceRow(id: string, src: SatelliteSource): Row {
	const c = answer?.counts;
	const look = LOOK[id];
	const month = c ? (c.month[`${id}|served`] ?? 0) : null;
	const up = c ? tiers(c.month, id, "upstream") : null;
	const hits = c ? tiers(c.month, id, "edge", "r2") : null;
	const free = src.freeTilesPerMonth ?? INCLUDED[id] ?? null;
	const billed = (n: number) => (Math.max(0, n - (free ?? 0)) / 1000) * src.usdPer1000;
	const zs = zooms(c?.month, id);
	// The Worker's switch once it answers; the contract's default until then.
	const keeps = answer ? answer.cache[id] : src.cacheToR2;
	let proj = HIT_RATES.map(() => 0);
	let projNote: string | undefined;
	let projTiles: number | undefined;
	if (src.live) projNote = src.standby && !answer?.standby.includes(id) ? "off: Esri streams instead" : `stops at ${k(0.9 * (free ?? 0))}, then falls back to Sentinel`;
	else if (src.usdPer1000 > 0) {
		const perPin = photoTilesFor([-120, 50], src.zoom).length;
		const asked = USERS * PINS_PER_USER * perPin;
		proj = HIT_RATES.map((hr) => billed(asked * (keeps ? 1 - hr : 1)));
		projNote = `${k(asked)} tiles asked · ${perPin}/pin at z${src.zoom}${keeps ? "" : " · cache off, every tile upstream"}`;
		if (keeps) projTiles = asked;
	}
	return {
		id,
		name: src.name.replace(/ (cloudless 2016|National Map imagery|World Imagery|Satellite)$/, ""),
		sub: look.sub,
		color: src.color,
		lic: look.lic,
		licText: look.licText,
		licence: `${src.licence} · ${src.attribution}`,
		cache: keeps,
		standby: src.standby ? (answer ? answer.standby.includes(id) : null) : undefined,
		stops: !!src.freeTilesPerMonth,
		lock: look.lock ?? null,
		z: zs.length ? `z${Math.min(...zs)}–${Math.max(...zs)}` : c ? "none" : null,
		today: c ? (c.today[`${id}|served`] ?? 0) : null,
		month,
		up,
		hits,
		tiles: c ? (c.all[`${id}|stored|tiles`] ?? 0) : null,
		gb: c ? (c.all[`${id}|stored|bytes`] ?? 0) / 1e9 : null,
		price: src.usdPer1000 ? `$${src.usdPer1000.toFixed(2)}` : "free",
		unit: "",
		free,
		mtd: up === null ? null : billed(up),
		proj,
		projNote,
		projTiles,
	};
}

const blank = { z: null, today: null, month: null, up: null, hits: null, tiles: null, gb: null, mtd: null, proj: null };
const rows = $derived<Row[]>([
	...Object.entries(SATELLITE_SOURCES).map(([id, src]) => sourceRow(id, src as SatelliteSource)),
	{
		...blank,
		id: "bc",
		name: "BC",
		sub: "gov orthophoto WMS · not wired",
		color: BC_COLOR,
		lic: "tos",
		licText: "Access Only",
		licence: 'BC Imagery WMS: "cannot be cascaded through another Web Map Service without the express written permission of the Province"',
		cache: false,
		lock: "stopped: needs the Province's written permission",
		price: "free",
		unit: "",
		free: null,
	},
	{
		...blank,
		id: "mapbox-loads",
		name: "Mapbox map loads",
		sub: "online map · billed per load",
		color: SATELLITE_SOURCES.mapbox.color,
		lic: "tos",
		licText: "ToS forbids",
		licence: "Mapbox ToS: no caching of map data outside the SDK",
		cache: false,
		lock: "Mapbox ToS: no caching outside the SDK",
		price: "$5→2.50",
		unit: "/1k loads",
		free: MAPBOX_LOADS.free,
		proj: HIT_RATES.map(() => loadsCost(LOADS)),
		projNote: `${k(LOADS)} loads · ${OPENS_PER_DAY} opens/user/day`,
	},
]);

const r2 = $derived.by(() => {
	const c = answer?.counts;
	if (!c) return null;
	const ids = Object.keys(SATELLITE_SOURCES);
	const gb = ids.reduce((n, id) => n + (c.all[`${id}|stored|bytes`] ?? 0), 0) / 1e9;
	const writes = ids.reduce((n, id) => n + (c.month[`${id}|stored|tiles`] ?? 0), 0);
	const reads = ids.reduce((n, id) => n + tiers(c.month, id, "r2"), 0);
	return { gb, writes, reads, mtd: gb * R2.storage + (writes / 1e6) * R2.write + (reads / 1e6) * R2.read };
});
// Every hit is an R2 read and every miss an R2 write.
const r2Proj = $derived.by(() => {
	const asked = rows.reduce((a, r) => a + (r.projTiles ?? 0), 0);
	return HIT_RATES.map((hr) => ((asked * hr) / 1e6) * R2.read + ((asked * (1 - hr)) / 1e6) * R2.write);
});

const sum = (pick: (r: Row) => number | null) => {
	const vals = rows.map(pick).filter((v): v is number => v !== null);
	return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};
const total = $derived({
	today: sum((r) => r.today),
	month: sum((r) => r.month),
	up: sum((r) => r.up),
	hits: sum((r) => r.hits),
	tiles: sum((r) => r.tiles),
	gb: sum((r) => r.gb),
	mtd: answer?.counts ? (sum((r) => r.mtd) ?? 0) + (r2?.mtd ?? 0) : null,
	proj: HIT_RATES.map((_, i) => (sum((r) => r.proj?.[i] ?? null) ?? 0) + r2Proj[i]),
});

// Inventory: what Squirrel counted going into R2 (an upstream fetch of a cached source is one write), not a listing.
const stored = $derived(rows.filter((r) => r.cache && (r.tiles ?? 0) > 0));
const ZS = Array.from({ length: 21 }, (_, z) => z);
const byZoom = $derived(ZS.map((z) => stored.map((r) => answer?.counts?.all[`${r.id}|${z}|upstream`] ?? 0)));
const zMax = $derived(Math.max(1, ...byZoom.map((col) => col.reduce((a, b) => a + b, 0))));
const zPeak = $derived(byZoom.findIndex((col) => col.reduce((a, b) => a + b, 0) === zMax));

// Blob log: this browser's blobs, newest first.
const MAX_LOG = 50;
const colorOf = (p: BlobPart) => (p.name === "roads" ? ROADS_COLOR : p.id ? SATELLITE_SOURCES[p.id as SourceId].color : "var(--muted2)");
type Part = BlobPart & { color: string; mb: number | null };
const log = $derived(
	regions.slice(0, MAX_LOG).map((r) => {
		const parts = blobParts(r, photos, regions).map((p): Part => ({ ...p, color: colorOf(p), mb: p.bytes === null ? null : p.bytes / 1048576 }));
		const w = parts.find((p) => p.wire)?.wire;
		return { r, parts, hits: w && w.hit + w.miss ? Math.round((100 * w.hit) / (w.hit + w.miss)) : null };
	}),
);
const blobMb = (parts: Part[]) => parts.reduce((a, p) => a + (p.mb ?? 0), 0);
const picked = $derived(log.find((b) => b.r.id === sel) ?? log[0]);

function toggle(id: string): void {
	const next = new Set(open);
	if (sel === id && next.has(id)) next.delete(id);
	else next.add(id);
	open = next;
	sel = id;
}

// Footprint: the roads box and the photo disc, on a flat projection centred on the pin.
const W = 400;
const H = 300;
const KM_PER_DEG = 111.32;
const foot = $derived.by(() => {
	if (!picked) return null;
	const { r } = picked;
	const cos = Math.cos((r.lat * Math.PI) / 180);
	const b = rangeBox(r.range);
	const wKm = (b.e - b.w) * KM_PER_DEG * cos;
	const hKm = (b.n - b.s) * KM_PER_DEG;
	const pxPerKm = Math.min((W - 40) / wKm, (H - 40) / hKm);
	const x = (lng: number) => W / 2 + (lng - r.lng) * KM_PER_DEG * cos * pxPerKm;
	const y = (lat: number) => H / 2 - (lat - r.lat) * KM_PER_DEG * pxPerKm;
	const c = r.photoCenter ?? [r.lng, r.lat];
	return {
		roads: { x: x(b.w), y: y(b.n), w: wKm * pxPerKm, h: hKm * pxPerKm },
		disc: { cx: x(c[0]), cy: y(c[1]), r: 2 * pxPerKm },
		pin: { x: x(r.lng), y: y(r.lat) },
		kmWide: W / pxPerKm,
	};
});

const n = (v: number) => Math.round(v).toLocaleString("en-US");
function k(v: number): string {
	if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`;
	if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}k`;
	return String(Math.round(v));
}
const usd = (v: number) => (v === 0 ? "$0" : v < 100 ? `$${v.toFixed(2)}` : `$${n(v)}`);
const when = (t: number) => {
	const d = new Date(t);
	return `${d.toLocaleString("en-US", { month: "short", day: "2-digit" })} · ${d.toTimeString().slice(0, 5)}`;
};
const ll = (v: number) => v.toFixed(4).replace("-", "−");
const freeTone = (p: number) => (p > 1 ? "var(--red)" : p > 0.7 ? "var(--amber)" : "var(--green)");
const host = $derived(squirrelUrl()?.replace(/^https?:\/\//, "").replace(/\/squirrel$/, "") ?? "no tiles host");
const today = new Date();

// Hand test: force one source onto the online map, and fetch ten tiles through the Worker twice.
const HAND = ["sentinel", "esri", "usgs", "bc", "maptiler", "mapbox"];
const TEST_Z = 15;
type Probe = { at: [number, number]; tiles: { zxy: string; first: string; second: string }[]; note: string | null };
let forced = $state(forcedImagery());
let probes = $state<Record<string, Probe | "running">>({});
let forgot = $state<Record<string, string>>({});

function setForced(id: string): void {
	forced = forced === id ? null : id;
	forceImagery(forced);
}

/** Ten tiles around the online map's last centre, moved into the source's coverage when it has one and the centre is outside it. */
function testTiles(src: SatelliteSource): { at: [number, number]; zxy: string[] } {
	let [lng, lat] = loadCamera()?.center ?? MAP_HOME_CENTER;
	if (src.covers && !src.covers.some(([w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n)) {
		const [w, s, e, n] = src.covers[0];
		[lng, lat] = [(w + e) / 2, (s + n) / 2];
	}
	const span = 2 ** TEST_Z;
	const cx = Math.floor(((lng + 180) / 360) * span);
	const cy = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * span);
	return { at: [lng, lat], zxy: Array.from({ length: 10 }, (_, i) => `${TEST_Z}/${cx - 2 + (i % 5)}/${cy - 1 + Math.floor(i / 5)}`) };
}

/** The Worker's X-Cache, or its status and reason. no-store: the browser would otherwise answer the second pass itself. */
async function probe(id: string, zxy: string): Promise<string> {
	const [z, x, y] = zxy.split("/").map(Number);
	const res = await fetch(satelliteTileUrl(id, z, x, y) ?? "", { cache: "no-store" });
	return res.ok ? (res.headers.get("X-Cache") ?? "no X-Cache") : `${res.status} ${await res.text()}`;
}

async function testCache(id: string, src: SatelliteSource): Promise<void> {
	const { at, zxy } = testTiles(src);
	probes = { ...probes, [id]: "running" };
	try {
		const first = await Promise.all(zxy.map((t) => probe(id, t)));
		const second = await Promise.all(zxy.map((t) => probe(id, t)));
		const note = [...first, ...second].find((r) => r !== "HIT" && r !== "MISS") ?? null;
		probes = { ...probes, [id]: { at, tiles: zxy.map((t, i) => ({ zxy: t, first: first[i], second: second[i] })), note } };
	} catch (e) {
		probes = { ...probes, [id]: { at, tiles: [], note: String(e instanceof Error ? e.message : e) } };
	}
}

async function forgetTiles(id: string, src: SatelliteSource): Promise<void> {
	const res = await fetch(squirrelUrl(`/forget/${id}`) ?? "", { method: "POST", body: testTiles(src).zxy.join("\n") });
	const said = res.ok ? ((await res.json()) as { r2: number; edge: number }) : null;
	forgot = { ...forgot, [id]: said ? `dropped ${said.r2} from R2 · ${said.edge} from the edge` : `HTTP ${res.status} ${await res.text()}` };
	const { [id]: _, ...rest } = probes;
	probes = rest;
}
const short = (r: string) => (r === "HIT" || r === "MISS" ? r : r.split(" ")[0]);

// What the page shows, as text an AI can read instead of a screenshot.
let copied = $state(false);
async function copyLog(): Promise<void> {
	const log = {
		page: "/app/squirrel",
		at: new Date().toISOString(),
		worker: { host, failure, active: answer?.active ?? null, standby: answer?.standby ?? null },
		forcedOnThisBrowser: forced,
		sources: rows.map(({ id, cache, standby, lock, z, today, month, up, hits, tiles, gb, free, mtd }) => ({ id, cache, standby, lock, z, today, month, upstream: up, hits, r2Tiles: tiles, r2Gb: gb, freeTier: free, usdMonthToDate: mtd })),
		handTest: probes,
		deleted: forgot,
	};
	await navigator.clipboard.writeText(JSON.stringify(log, null, 1));
	copied = true;
	setTimeout(() => (copied = false), 1500);
}

// A desktop dashboard: it leaves the phone frame for <body>, as SideCard does.
function toBody(node: HTMLElement) {
	document.body.appendChild(node);
	return { destroy: () => node.remove() };
}
</script>

<svelte:head><title>Get Cache | Squirrel</title></svelte:head>

{#snippet dash(v: number | null, show: (v: number) => string = n, cls = "num")}
	{#if v === null}<span class="dim">—</span>{:else}<span class={cls}>{show(v)}</span>{/if}
{/snippet}

{#snippet byHit(v: number[] | null, cls: string)}
	{#if v === null}<span class="dim">—</span>
	{:else if v.every((x) => x === 0)}<span class="dim">$0</span>
	{:else if v.every((x) => x === v[0])}<span class={cls}>{usd(v[0])}</span>
	{:else}{#each HIT_RATES as hr, i (hr)}<span class="hitrow"><i>{hr * 100}% hits</i><span class={cls}>{usd(v[i])}</span></span>{/each}{/if}
{/snippet}

<div class="sq" use:toBody>
	<div class="topbar">
		<span class="gclogo">G¢</span><span class="wordmark">Get Cache</span><span class="crumb">/</span><span class="appname">SQUIRREL</span>
		<span class="hnote">satellite traffic controller · <a href="https://github.com/Ground-Truth-Data/getCache_offlineMap/blob/main/docs/SATELLITE_SOURCES.md" target="_blank" rel="noopener">which source serves what</a></span>
		<span class="spacer"></span>
		<span class="meta">photos bake from <b>{answer ? (SATELLITE_SOURCES[answer.active as keyof typeof SATELLITE_SOURCES]?.name ?? answer.active) : "—"}</b> · active users <b>—</b></span>
		{#if failure}<span class="statuspill bad" title={failure}>✕ worker · {host}</span>
		{:else if answer}<span class="statuspill" class:bad={!answer.counts}>{answer.counts ? "✓" : "✕"} worker up · {host}{answer.counts ? "" : " · no bucket"}</span>
		{:else}<span class="statuspill dimpill">asking {host}…</span>{/if}
		<button class="refresh" onclick={copyLog}>{copied ? "copied ✓" : "copy debug log"}</button>
		<button class="refresh" onclick={load}>refresh</button>
	</div>
	{#if failure}<p class="fail" role="alert">{failure}</p>{/if}

	<div class="page">
		<div class="card">
			<div class="cardhead">
				<span class="dot" style="background:var(--green)"></span><span class="title">SOURCES</span>
				<span class="hnote">{rows.length} rows · {rows.filter((r) => r.cache).length} caching · {rows.filter((r) => r.lic === "tos").length} ToS-flagged</span>
				<span class="spacer"></span>
				<span class="hnote">month to date · {today.toLocaleString("en-US", { month: "short" })} 1–{today.getDate()} UTC</span>
			</div>
			<div class="scroll">
				<div class="sgrid">
					<div class="grp first"></div><div class="grp" style="grid-column:span 3"><span>POLICY</span></div><div class="grp" style="grid-column:span 4"><span>TRAFFIC</span></div><div class="grp" style="grid-column:span 3"><span>IN R2</span></div><div class="grp last" style="grid-column:span 4"><span>COST</span></div>
					{#each ["source", "cache → R2", "licence", "zoom used", "served today", "served month", "upstream fetches", "R2 hit rate", "tiles", "GB", "area km²", "$ / 1k", "month to date", "free tier used", "10k users / mo"] as t, i (t)}
						<div class="hd" class:r={i >= 4 && i !== 13} class:first={i === 0} class:last={i === 14}>{t}</div>
					{/each}

					{#each rows as s (s.id)}
						<div class="first" title={s.licence}><span class="dot big" style="background:{s.color}"></span><span class="srcname"><b>{s.name}</b><i>{s.sub}</i>
							{#if s.standby !== undefined}<label class="standby"><button class="tog" class:on={s.standby} disabled={s.standby === null} aria-label="standby {s.name}" onclick={() => flip("standby", s.id, !s.standby)}></button><span class:grn={s.standby} class:dim={!s.standby}>{s.standby ? "ON · streaming" : s.standby === null ? "—" : "OFF"}</span></label>{/if}</span></div>
						<div>
							<button class="tog" class:on={s.cache} class:locked={!!s.lock} disabled={!!s.lock || !answer} aria-label="cache {s.name} in R2" title={s.lock ?? `R2 ${s.cache ? "keeps" : "skips"} ${s.name}; the Worker follows within a minute`} onclick={() => flip("cache", s.id, !s.cache)}></button>
						</div>
						<div class="lic-cell">
							<span class="lic {s.lic}" title={s.licence}>{s.lic === "ok" ? "✓" : "×"} {s.licText}</span>
							{#if s.lock}<span class="why red">{s.lock}</span>{/if}
						</div>
						<div class="dim">{s.z ?? "—"}</div>
						<div class="r">{@render dash(s.today)}</div>
						<div class="r">{@render dash(s.month)}</div>
						<div class="r">{@render dash(s.up, n, s.up !== null && s.up === s.month && s.up > 0 ? "amb" : "num")}</div>
						<div class="r">
							{#if s.month === null}<span class="dim">—</span>
							{:else if !s.cache}<span class="dim">off</span>
							{:else if !s.month}<span class="dim">no traffic</span>
							{:else}{@const hr = (s.hits ?? 0) / s.month}<span class="hit"><span class="minibar"><i style="width:{hr * 100}%"></i></span><span class="grn b">{(hr * 100).toFixed(1)}%</span></span>{/if}
						</div>
						<div class="r">{@render dash(s.tiles, k)}</div>
						<div class="r">{@render dash(s.gb, (v) => v.toFixed(v < 1 ? 3 : 1))}</div>
						<div class="r"><span class="dim">—</span></div>
						<div class="r"><span class:num={s.price !== "free"} class:dim={s.price === "free"}>{s.price}</span>{#if s.unit}<span class="dim small">&nbsp;{s.unit}</span>{/if}</div>
						<div class="r b">{@render dash(s.mtd, usd, s.mtd ? "gold" : "dim")}</div>
						<div>
							{#if s.free === null}<div class="free"><div class="lab"><span class="dim">no cap</span></div></div>
							{:else}
								{@const used = s.up}
								<div class="free">
									<div class="track">{#if used !== null}<i style="width:{Math.min(used / s.free, 1) * 100}%;background:{freeTone(used / s.free)}"></i>{/if}{#if s.stops}<b class="stop" title="the Worker refuses past 90%"></b>{/if}</div>
									<div class="lab">{#if used === null}<span class="dim">—</span>{:else}<span class="b" style="color:{freeTone(used / s.free)}">{((used / s.free) * 100).toFixed(1)}%</span>{/if}<span>of {k(s.free)}{s.id === "maptiler" ? " incl." : ""}</span></div>
								</div>
							{/if}
						</div>
						<div class="r last proj-cell">{@render byHit(s.proj, "num b")}{#if s.projNote}<span class="why dim">{s.projNote}</span>{/if}</div>
					{/each}

					<div class="first r2row"><span class="dot big" style="background:var(--text)"></span><span class="srcname"><b>R2 bucket</b><i>storage · reads · writes</i></span></div>
					<div class="r2row dim">—</div><div class="r2row"><span class="lic ok">list price</span></div><div class="r2row"></div><div class="r2row"></div><div class="r2row"></div>
					<div class="r2row r dim">{r2 ? `${k(r2.writes)} wr` : "—"}</div><div class="r2row r dim">{r2 ? `${k(r2.reads)} rd` : "—"}</div><div class="r2row"></div><div class="r2row r dim">{r2 ? r2.gb.toFixed(3) : "—"}</div><div class="r2row"></div>
					<div class="r2row r dim small">${R2.storage}/GB</div><div class="r2row r b">{@render dash(r2?.mtd ?? null, usd, "gold")}</div><div class="r2row"><span class="dim small">wr ${R2.write}/M · rd ${R2.read}/M</span></div><div class="r2row r last proj-cell">{@render byHit(r2Proj, "num b")}<span class="why dim">hits read · misses write</span></div>

					<div class="tot first"><span class="lbl">MONTH TOTAL</span></div><div class="tot"></div><div class="tot"></div><div class="tot"></div>
					<div class="tot r">{@render dash(total.today)}</div><div class="tot r">{@render dash(total.month)}</div><div class="tot r">{@render dash(total.up, n, "amb")}</div>
					<div class="tot r">{#if total.month}<span class="grn">{(((total.hits ?? 0) / total.month) * 100).toFixed(1)}%</span>{:else}<span class="dim">—</span>{/if}</div>
					<div class="tot r">{@render dash(total.tiles, k)}</div><div class="tot r">{@render dash(total.gb, (v) => v.toFixed(v < 1 ? 3 : 1))}</div><div class="tot r dim">—</div><div class="tot"></div>
					<div class="tot r">{@render dash(total.mtd, usd, "gold")}</div><div class="tot"></div><div class="tot r last dim">↓</div>

					<div class="proj first"><span class="lbl gold">10K USERS / MO</span></div>
					<div class="proj" style="grid-column:span 7"><span class="dim small">{n(USERS)} planters × {PINS_PER_USER} pin photos a month · crews share tiles, so 50–90% come from R2 · Mapbox map {OPENS_PER_DAY} opens a day · Esri held under its stop · BC unmeasured</span></div>
					<div class="proj"></div><div class="proj"></div><div class="proj"></div><div class="proj"></div><div class="proj"></div><div class="proj"></div>
					<div class="proj r last proj-cell">{@render byHit(total.proj, "bigproj")}</div>
				</div>
			</div>
			<div class="foot">
				<span>upstream = tiles fetched from the provider (R2 miss or uncached)</span>
				<span>hit rate = edge + R2 hits ÷ served</span>
				<span>month to date = max(0, upstream − free) ÷ 1000 × $/1k</span>
				<span>counts land every 100 tiles or 30 s</span>
				<span>the only delete here is the hand test's own tiles</span>
			</div>
		</div>

		<div class="card">
			<div class="cardhead">
				<span class="dot" style="background:var(--amber)"></span><span class="title">HAND TEST</span>
				<span class="hnote">force the online map to one source · 10 tiles at z{TEST_Z} around its last centre, fetched twice through {host}</span>
			</div>
			<div class="scroll">
				<div class="hgrid">
					<div class="hd">source</div><div class="hd">force map</div><div class="hd">cache test</div><div class="hd">10 tiles · 1st → 2nd</div><div class="hd">test tiles</div>
					{#each HAND as id (id)}
						{@const src = sourceOf(id)}
						{@const p = probes[id]}
						<div><span class="dot big" style="background:{src?.color ?? BC_COLOR}"></span><b>{src?.name ?? "BC Imagery"}</b></div>
						{#if !src}
							<div><button class="tog locked" disabled aria-label="force BC"></button></div>
							<div class="red small" style="grid-column:span 3">not wired: needs the Province's written permission</div>
						{:else}
							<div class="hcell">
								<button class="tog" class:on={forced === id} aria-label="force the online map to {src.name}" onclick={() => setForced(id)}></button>
								<span class="small" class:grn={forced === id} class:dim={forced !== id}>{forced === id ? "forced" : "off"}</span>
								{#if src.standby && answer && !answer.standby.includes(id)}<span class="amb small">standby OFF: the Worker 404s it</span>{/if}
							</div>
							<div><button class="refresh" disabled={p === "running"} onclick={() => testCache(id, src)}>{p === "running" ? "testing…" : "test cache"}</button></div>
							<div class="hcell">
								{#if p && p !== "running"}
									<span class="chips">{#each p.tiles as t (t.zxy)}<span class="chip" title={t.zxy}><i class={short(t.first)}>{short(t.first)}</i>→<i class={short(t.second)}>{short(t.second)}</i></span>{/each}</span>
									<span class="dim small">at {ll(p.at[1])}, {ll(p.at[0])}</span>
									{#if src.live}<span class="amb small">live only — not cached</span>{/if}
									{#if p.note}<span class="red small" title={p.note}>{p.note.slice(0, 140)}</span>{/if}
								{:else if src.live}<span class="amb small">live only — not cached</span>{/if}
							</div>
							<div class="hcell">
								{#if src.live}<span class="dim small">nothing kept</span>
								{:else}<button class="refresh" onclick={() => forgetTiles(id, src)}>delete test tiles</button>{#if forgot[id]}<span class="dim small">{forgot[id]}</span>{/if}{/if}
							</div>
						{/if}
					{/each}
				</div>
			</div>
		</div>

		<div class="card">
			<div class="cardhead">
				<span class="dot" style="background:var(--blue)"></span><span class="title">R2 INVENTORY</span>
				<span class="hnote">key {"{source}/{z}/{x}/{y}.jpg"} · from Squirrel's write counts, not a bucket listing</span>
			</div>
			<div class="scroll">
				<div class="inv">
					<section>
						<div class="sublbl">TOTAL</div>
						<div class="bignum">{total.tiles === null ? "—" : k(total.tiles)}</div>
						<div class="bigunit">objects{total.tiles === null ? "" : ` · ${n(total.tiles)}`}</div>
						<div class="gap"></div>
						<div class="bignum">{total.gb === null ? "—" : total.gb.toFixed(total.gb < 1 ? 3 : 1)}</div>
						<div class="bigunit">GB stored{total.gb && total.tiles ? ` · avg ${((total.gb * 1e6) / total.tiles).toFixed(1)} KB/tile` : ""}</div>
						<div class="gap"></div>
						<div class="bignum dim">—</div>
						<div class="bigunit">km² footprint · not measured</div>
					</section>
					<section>
						<div class="sublbl">BY SOURCE<span>GB share</span></div>
						<div class="stack">
							{#each stored as s (s.id)}<i style="width:{((s.gb ?? 0) / (total.gb || 1)) * 100}%;background:{s.color}" title={s.name}></i>{/each}
						</div>
						<div class="leg">
							{#each stored as s (s.id)}
								<span class="sw" style="background:{s.color}"></span><span>{s.name}</span><span class="dim r">{k(s.tiles ?? 0)}</span><span class="num r">{(s.gb ?? 0).toFixed(3)} GB</span><span class="dim r">— km²</span>
							{/each}
							{#each rows.filter((r) => !stored.includes(r) && r.id !== "mapbox-loads") as s (s.id)}
								<span class="sw" style="background:{s.color};opacity:.35"></span><span class="dim">{s.name}</span><span class="dim r">0</span><span class="small r" class:red={!s.cache} class:dim={s.cache}>{s.cache ? "nothing yet" : "not stored"}</span><span></span>
							{/each}
						</div>
					</section>
					<section>
						<div class="sublbl">BY ZOOM<span>{stored.length ? `peak z${zPeak} · ${k(zMax)}` : "nothing stored"}</span></div>
						<div class="zoomcols">
							{#each byZoom as col, z (z)}
								{@const t = col.reduce((a, b) => a + b, 0)}
								<div class="zc" title="z{z} · {n(t)}">
									<div class="bars" style="height:{t ? Math.max((t / zMax) * 100, 1.5) : 0}%">
										{#each stored as s, j (s.id)}<i style="height:{t ? (col[j] / t) * 100 : 0}%;background:{s.color}"></i>{/each}
									</div>
								</div>
							{/each}
						</div>
						<div class="zlabels">{#each ZS as z (z)}<span>{z % 2 === 0 ? z : ""}</span>{/each}</div>
					</section>
					<section>
						<div class="sublbl">NEWEST / OLDEST TILE</div>
						<div class="ages">
							<div class="h">SOURCE</div><div class="h">NEWEST</div><div class="h end">OLDEST</div>
							{#each rows.filter((r) => r.cache) as s (s.id)}
								<div><span class="dot" style="background:{s.color}"></span>{s.name}</div><div class="dim">—</div><div class="dim end">—</div>
							{/each}
						</div>
						<div class="bigunit">not measured: needs a dated index of R2 keys</div>
					</section>
				</div>
			</div>
		</div>

		<div class="card">
			<div class="cardhead">
				<span class="dot" style="background:var(--gold)"></span><span class="title">BLOB LOG</span>
				<span class="hnote">{regions.length > MAX_LOG ? `last ${MAX_LOG} of ${regions.length}` : `${regions.length} blobs`} · {log.reduce((a, b) => a + blobMb(b.parts), 0).toFixed(1)} MB · this browser</span>
				<span class="spacer"></span>
				<span class="hnote">newest first · click a row for its footprint</span>
			</div>
			<div class="scroll">
				<div class="logwrap">
					<div class="log">
						<div class="lhead"><span></span><span>PIN</span><span>LAT, LON</span><span>SAVED</span><span>PARTS · R2 HITS</span><span class="end">ADDED</span></div>
						{#if log.length === 0}<div class="empty dim">no blobs in this browser yet: drop a pin on /app/offlinev10</div>{/if}
						{#each log as { r, parts, hits } (r.id)}
							<button class="lrow" class:open={open.has(r.id)} class:sel={picked?.r.id === r.id} onclick={() => toggle(r.id)}>
								<span class="chev">▶</span>
								<span class="pin">{r.place ? placeLabel(r.place) : r.pin ? r.id : "follow-me"}</span>
								<span class="dim">{ll(r.lat)}, {ll(r.lng)}</span>
								<span class:num={r === regions[0]} class:dim={r !== regions[0]}>{when(r.at)}</span>
								<span class="dotsrow"><span class="dots">{#each parts as p (p.name)}<i style="background:{p.color}"></i>{/each}</span><span class:grn={hits !== null} class:dim={hits === null}>{hits === null ? "—" : `${hits}% photo hits`}</span></span>
								<span class="mb">{blobMb(parts).toFixed(1)} MB</span>
							</button>
							{#if open.has(r.id)}
								<div class="parts">
									<div class="prow ph"><span>PART</span><span>SOURCE</span><span>CAME FROM</span><span>WRITTEN TO R2</span><span class="end">TILES</span><span class="end">MB</span><span></span></div>
									{#each parts as p (p.name)}
										<div class="prow">
											<span class="num">{p.name}</span>
											<span><span class="badge"><i style="background:{p.color}"></i>{p.source}</span></span>
											<span>
												{#if p.name === "roads"}<span class="tag r2">R2</span>
												{:else if p.wire}<span class="grn">{p.wire.hit} hit</span><span class="dim"> · </span><span class:amb={p.wire.miss > 0} class:dim={!p.wire.miss}>{p.wire.miss} upstream</span>{#if p.wire.disk}<span class="dim"> · {p.wire.disk} disk</span>{/if}
												{:else if p.name === "close-up" && p.tiles}<span class="dim">with the photo's</span>
												{:else}<span class="dim">—</span>{/if}
											</span>
											<span>
												{#if p.name === "roads"}<span class="dim">no · already there</span>
												{:else if p.wire}{#if p.wire.kept}<span class="grn">{p.wire.miss} written</span>{:else}<span class="red">no · cache off</span>{/if}
												{:else}<span class="dim">—</span>{/if}
											</span>
											<span class="num end">{p.tiles ?? "—"}</span>
											<span class="num end">{p.mb === null ? "—" : p.mb.toFixed(p.mb < 0.1 ? 2 : 1)}</span>
											<span class="dim pz">{p.note ?? p.zoom}</span>
										</div>
									{/each}
								</div>
							{/if}
						{/each}
					</div>
					<div class="map">
						{#if picked && foot}
							<div class="sublbl">FOOTPRINT<span>{when(picked.r.at)}</span></div>
							<div class="mapttl">{picked.r.place ? placeLabel(picked.r.place) : "follow-me"}</div>
							<div class="mapsub">{blobMb(picked.parts).toFixed(1)} MB added · {picked.r.tiles} road tiles</div>
							<div class="mapbox">
								<svg viewBox="0 0 {W} {H}">
									{#each Array.from({ length: 15 }, (_, i) => i - 7) as i (i)}
										<line x1={W / 2 + i * 30} y1="0" x2={W / 2 + i * 30} y2={H} stroke="rgba(255,255,255,.05)" />
										<line x1="0" y1={H / 2 + i * 30} x2={W} y2={H / 2 + i * 30} stroke="rgba(255,255,255,.05)" />
									{/each}
									<rect x={foot.roads.x} y={foot.roads.y} width={foot.roads.w} height={foot.roads.h} fill="none" stroke={ROADS_COLOR} stroke-width="1.5" stroke-dasharray="5 4" />
									<text x={foot.roads.x + 5} y={foot.roads.y + 13} fill={ROADS_COLOR} class="svgt">roads</text>
									{#if picked.parts[1].id}
										<circle cx={foot.disc.cx} cy={foot.disc.cy} r={foot.disc.r} fill={picked.parts[2].tiles ? picked.parts[1].color : "none"} fill-opacity=".25" stroke={picked.parts[1].color} stroke-width="2" />
									{/if}
									<circle cx={foot.pin.x} cy={foot.pin.y} r="5" fill="var(--gold)" stroke="#0a0a0a" stroke-width="2" />
								</svg>
								<span class="mapcoord">{ll(picked.r.lat)}, {ll(picked.r.lng)}</span>
								<span class="mapscale">{foot.kmWide.toFixed(0)} km wide</span>
							</div>
							<div class="mleg">
								{#each picked.parts as p, j (p.name)}
									<div>
										<span class="k" style="border-color:{p.color};{j === 0 ? 'border-style:dashed' : ''}{j === 2 ? `;background:${p.color};opacity:.6` : ''}"></span>
										<span class="num">{p.name}</span>
										<span><span class="badge"><i style="background:{p.color}"></i>{p.source}</span></span>
										<span class="dim">{p.zoom}{p.tiles === null ? "" : ` · ${p.tiles} tiles`}</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
.sq {
	--bg: #0a0a0a; --panel: #141414; --panel2: #1c1c1c; --panel3: #0f0f0f;
	--border: rgba(255, 255, 255, 0.1); --border2: rgba(255, 255, 255, 0.2);
	--text: #f3f1e9; --muted: #8f8b80; --muted2: #5f5c53;
	--gold: #eab627; --amber: #d99a3d; --green: #7fbf6a; --blue: #6fb3d9; --red: #e2553f;
	--sans: "Inter", -apple-system, sans-serif; --mono: "JetBrains Mono", ui-monospace, monospace;
	background: var(--bg); color: var(--text); font-family: var(--sans);
	position: fixed; inset: 0; z-index: 1000; overflow: auto;
}
.sq button { font-family: var(--mono); }
.topbar { display: flex; align-items: center; gap: 10px; padding: 16px 28px; border-bottom: 3px solid var(--gold); white-space: nowrap; }
.gclogo { font-family: "Lilita One", cursive; font-style: italic; font-size: 28px; color: var(--gold); letter-spacing: -0.02em; }
.wordmark { font-weight: 800; font-size: 20px; color: var(--gold); }
.crumb { font-family: var(--mono); font-size: 13px; color: var(--muted2); }
.appname { font-weight: 800; font-size: 15px; letter-spacing: 0.08em; }
.spacer { flex: 1; }
.statuspill { display: flex; align-items: center; gap: 8px; border: 1px solid rgba(127, 191, 106, 0.4); background: rgba(127, 191, 106, 0.08); color: var(--green); border-radius: 9px; padding: 7px 12px; font-family: var(--mono); font-size: 12px; font-weight: 600; }
.statuspill.bad { border-color: rgba(226, 85, 63, 0.5); background: rgba(226, 85, 63, 0.08); color: var(--red); }
.statuspill.dimpill { border-color: var(--border2); background: none; color: var(--muted); }
.refresh { border: 1px solid var(--border2); background: none; color: var(--muted); border-radius: 7px; padding: 6px 10px; font-size: 11px; cursor: pointer; }
.meta { font-family: var(--mono); font-size: 11.5px; color: var(--muted); }
.meta b { color: var(--text); }
.fail { margin: 12px 28px 0; color: var(--red); font-family: var(--mono); font-size: 12px; }
.page { max-width: 1720px; margin: 0 auto; padding: 22px 28px 80px; display: flex; flex-direction: column; gap: 18px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.cardhead { display: flex; align-items: center; gap: 10px; padding: 14px 18px; background: var(--panel2); border-bottom: 1px solid var(--border); white-space: nowrap; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex: none; }
.dot.big { width: 9px; height: 9px; }
.title { font-weight: 800; font-size: 14px; letter-spacing: 0.06em; color: var(--gold); }
.hnote { font-family: var(--mono); font-size: 11.5px; color: var(--muted); }
.scroll { overflow-x: auto; }
.num { color: var(--text); font-weight: 600; }
.dim { color: var(--muted2); }
.amb { color: var(--amber); }
.grn { color: var(--green); }
.red { color: var(--red); }
.gold { color: var(--gold); }
.b { font-weight: 700; }
.small { font-size: 10px; }
.end { text-align: right; justify-content: flex-end; }

.sgrid { display: grid; grid-template-columns: 190px 64px 190px 62px 78px 86px 86px 104px 72px 62px 64px 92px 90px 140px 150px; min-width: 1500px; font-family: var(--mono); font-size: 12px; }
.sgrid > div { padding: 10px 8px; display: flex; align-items: center; border-bottom: 1px solid var(--border); min-width: 0; }
.sgrid .r { justify-content: flex-end; text-align: right; }
.sgrid .grp { padding: 10px 8px 4px; border-bottom: none; font-size: 9.5px; font-weight: 800; letter-spacing: 0.12em; color: var(--muted2); }
.sgrid .grp span { flex: 1; border-bottom: 1px solid var(--border2); padding-bottom: 4px; }
.sgrid .hd { font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em; color: var(--muted); text-transform: uppercase; padding-top: 4px; padding-bottom: 8px; border-bottom: 1px solid var(--border2); line-height: 1.3; }
.sgrid .first { padding-left: 18px; }
.sgrid .last { padding-right: 18px; }
.srcname { display: flex; flex-direction: column; gap: 2px; margin-left: 9px; min-width: 0; }
.srcname b { font-family: var(--sans); font-size: 13.5px; font-weight: 700; }
.srcname i { font-style: normal; font-size: 10.5px; color: var(--muted2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tog { width: 34px; height: 19px; border-radius: 10px; border: 1px solid var(--border2); background: var(--panel3); position: relative; padding: 0; flex: none; }
.tog::after { content: ""; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--muted2); }
.tog.on { background: rgba(127, 191, 106, 0.18); border-color: rgba(127, 191, 106, 0.55); }
.tog.on::after { left: 17px; background: var(--green); }
.standby { display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: 10px; font-weight: 700; }
.tog:not(:disabled) { cursor: pointer; }
.tog.locked { border-color: rgba(226, 85, 63, 0.45); }
.tog.locked::before { content: "🔒"; position: absolute; right: -17px; top: 1px; font-size: 10px; }
.lic-cell { flex-direction: column; align-items: flex-start !important; justify-content: center; gap: 3px; }
.lic { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 700; padding: 3px 7px; border-radius: 5px; border: 1px solid; white-space: nowrap; }
.lic.ok { color: var(--green); border-color: rgba(127, 191, 106, 0.4); }
.lic.tos { color: var(--red); border-color: rgba(226, 85, 63, 0.5); background: rgba(226, 85, 63, 0.08); }
.why { font-size: 9.5px; line-height: 1.25; white-space: normal; }
.proj-cell { flex-direction: column; align-items: flex-end !important; justify-content: center; gap: 2px; }
.hit { display: flex; align-items: center; gap: 7px; justify-content: flex-end; }
.minibar { width: 36px; height: 6px; border-radius: 3px; background: var(--panel3); border: 1px solid var(--border); overflow: hidden; }
.minibar i { display: block; height: 100%; background: var(--green); }
.free { display: flex; flex-direction: column; gap: 4px; width: 100%; }
.free .track { height: 8px; border-radius: 3px; background: var(--panel3); border: 1px solid var(--border); position: relative; overflow: hidden; }
.free .track i { position: absolute; left: 0; top: 0; bottom: 0; }
.free .track .stop { position: absolute; left: 90%; top: -1px; bottom: -1px; width: 2px; background: var(--red); }
.free .lab { display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); }
.tag { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 5px; border: 1px solid; width: max-content; }
.tag.r2 { color: var(--green); border-color: rgba(127, 191, 106, 0.4); }
.r2row { background: rgba(255, 255, 255, 0.015); }
.tot { border-bottom: none !important; border-top: 1px solid var(--border2); background: var(--panel2); font-weight: 700; }
.lbl { font-size: 10.5px; font-weight: 800; letter-spacing: 0.1em; color: var(--muted); }
.lbl.gold { color: var(--gold); }
.proj { background: rgba(234, 182, 39, 0.06); border-bottom: none !important; border-top: 1px dashed rgba(234, 182, 39, 0.35); }
.hitrow { display: flex; align-items: baseline; gap: 6px; }
.hitrow i { font-style: normal; font-size: 9.5px; color: var(--muted2); }
.bigproj { font-size: 15px; font-weight: 800; color: var(--gold); }
.hgrid { display: grid; grid-template-columns: 220px 230px 130px 1fr 300px; min-width: 1100px; }
.hgrid .refresh { white-space: nowrap; }
.hgrid > div { padding: 10px 14px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
.hgrid > .hd { border-top: 0; }
.hcell { flex-wrap: wrap; }
.chips { display: flex; gap: 4px; flex-wrap: wrap; }
.chip { font-family: var(--mono); font-size: 10px; border: 1px solid var(--border2); border-radius: 5px; padding: 2px 4px; color: var(--muted2); }
.chip i { font-style: normal; color: var(--red); }
.chip i.MISS { color: var(--amber); }
.chip i.HIT { color: var(--green); }
.foot { padding: 10px 18px; font-family: var(--mono); font-size: 10.5px; color: var(--muted2); display: flex; gap: 18px; flex-wrap: wrap; border-top: 1px solid var(--border); }

.inv { display: grid; grid-template-columns: 210px minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1.1fr); min-width: 1100px; }
.inv > section { padding: 16px 18px; border-right: 1px solid var(--border); min-width: 0; }
.inv > section:last-child { border-right: none; }
.sublbl { font-family: var(--mono); font-size: 10px; font-weight: 800; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 12px; display: flex; justify-content: space-between; gap: 8px; }
.sublbl span { color: var(--muted2); font-weight: 600; letter-spacing: 0; }
.bignum { font-family: var(--mono); font-size: 30px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
.bigunit { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 4px; }
.gap { height: 18px; }
.stack { display: flex; height: 22px; border-radius: 5px; overflow: hidden; border: 1px solid var(--border); background: var(--panel3); }
.stack i { display: block; height: 100%; border-right: 1px solid var(--panel); }
.leg { display: grid; grid-template-columns: auto 1fr auto auto auto; gap: 6px 12px; margin-top: 14px; font-family: var(--mono); font-size: 11.5px; align-items: center; }
.leg .r { text-align: right; }
.sw { width: 8px; height: 8px; border-radius: 50%; }
.zoomcols { display: flex; align-items: flex-end; gap: 4px; height: 120px; border-bottom: 1px solid var(--border); }
.zc { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; min-width: 0; }
.zc .bars { display: flex; flex-direction: column-reverse; border-radius: 2px 2px 0 0; overflow: hidden; }
.zc .bars i { display: block; }
.zlabels { display: flex; gap: 4px; margin-top: 5px; }
.zlabels span { flex: 1; text-align: center; font-family: var(--mono); font-size: 9.5px; color: var(--muted2); }
.ages { display: grid; grid-template-columns: auto 1fr auto; gap: 0 12px; font-family: var(--mono); font-size: 11.5px; margin-bottom: 8px; }
.ages > div { padding: 7px 0; border-bottom: 1px dashed var(--border); display: flex; align-items: center; gap: 7px; }
.ages .h { font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em; color: var(--muted2); border-bottom: 1px solid var(--border2); padding-top: 0; }

.logwrap { display: grid; grid-template-columns: minmax(0, 1fr) 440px; min-width: 1180px; }
.log { border-right: 1px solid var(--border); min-width: 0; }
.lhead, .lrow { display: grid; grid-template-columns: 28px minmax(140px, 1.4fr) 170px 150px 130px 90px; align-items: center; font-family: var(--mono); font-size: 12px; padding: 0 18px 0 10px; }
.lhead { font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em; color: var(--muted); padding-top: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border2); }
.lrow { all: unset; box-sizing: border-box; width: 100%; display: grid; grid-template-columns: 28px minmax(140px, 1.4fr) 170px 150px 130px 90px; align-items: center; font-family: var(--mono); font-size: 12px; padding: 10px 18px 10px 10px; border-bottom: 1px solid var(--border); cursor: pointer; }
.lrow:hover { background: rgba(255, 255, 255, 0.025); }
.lrow.sel { background: rgba(234, 182, 39, 0.06); box-shadow: inset 3px 0 0 var(--gold); }
.chev { color: var(--muted); font-size: 10px; transition: transform 0.15s; display: inline-block; text-align: center; }
.open .chev { transform: rotate(90deg); color: var(--gold); }
.pin { font-family: var(--sans); font-weight: 700; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dotsrow { display: flex; gap: 10px; align-items: center; }
.dots { display: flex; gap: 4px; }
.dots i { width: 8px; height: 8px; border-radius: 50%; }
.mb { text-align: right; font-weight: 700; color: var(--gold); }
.empty { padding: 18px; font-family: var(--mono); font-size: 12px; }
.parts { background: var(--panel3); border-bottom: 1px solid var(--border); padding: 6px 18px 10px 38px; }
.prow { display: grid; grid-template-columns: 76px 190px 110px 140px 60px 64px 1fr; align-items: center; font-family: var(--mono); font-size: 11.5px; padding: 6px 0; border-bottom: 1px dashed var(--border); }
.prow:last-child { border-bottom: none; }
.prow.ph { font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em; color: var(--muted2); }
.pz { padding-left: 16px; }
.badge { white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 11px; padding: 3px 8px; border-radius: 5px; border: 1px solid var(--border2); width: max-content; }
.badge i { width: 7px; height: 7px; border-radius: 50%; }
.map { padding: 16px 18px; position: sticky; top: 0; align-self: start; }
.mapbox { position: relative; border: 1px solid var(--border); border-radius: 9px; overflow: hidden; background: var(--panel3); }
.mapbox svg { display: block; width: 100%; height: auto; }
.svgt { font-family: var(--mono); font-size: 10px; font-weight: 700; }
.mapcoord { position: absolute; left: 10px; bottom: 8px; font-family: var(--mono); font-size: 10px; color: var(--muted); }
.mapscale { position: absolute; right: 10px; bottom: 8px; font-family: var(--mono); font-size: 10px; color: var(--muted2); }
.mleg { margin-top: 12px; display: flex; flex-direction: column; font-family: var(--mono); font-size: 11.5px; }
.mleg > div { display: grid; grid-template-columns: 22px 70px 1fr auto; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px dashed var(--border); }
.mleg .k { width: 16px; height: 10px; border: 1.5px solid; }
.mapttl { font-weight: 700; font-size: 15px; margin-bottom: 3px; }
.mapsub { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-bottom: 12px; }
</style>
