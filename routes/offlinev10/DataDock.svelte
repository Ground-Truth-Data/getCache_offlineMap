<script lang="ts">
/**
 * DATA — bytes off the network, by feature, per day.
 *
 * The one number the other docks cannot give: CURRENT SESSION resets on
 * reload and OFFLINE BLOBS counts what is on disk, so neither answers "how
 * much did this app cost me today". This one survives reloads, so a spike is
 * still visible tomorrow.
 *
 * The daily average is the point of the history: a single day says nothing
 * about whether today was unusual.
 */
import { onMount } from "svelte";
import { dailyAverage, pastDays, startDataMeter, todayBytes, todayTotal } from "../../lib/shared/dataMeter.svelte";

// NOT `$effect`. Starting the meter counts the entries already in the
// performance buffer, synchronously, into the same reactive map this
// component reads below — an effect that writes what it reads, which Svelte
// stops as `effect_update_depth_exceeded`. The error boundary then replaces
// the whole page, so the one dock that mounts this took the debug route down
// with it. onMount runs once, outside the read path; its return is the stop.
onMount(() => startDataMeter());

const rows = $derived(todayBytes());
const total = $derived(todayTotal());
const avg = $derived(dailyAverage());
const history = $derived(pastDays().slice(0, 7));

function fmt(b: number): string {
	if (b <= 0) return "—";
	if (b < 1024) return `${b} B`;
	if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
	return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const dayTotal = (kinds: Record<string, number>) =>
	Object.values(kinds).reduce((n, b) => n + b, 0);

/** Share of today's total, for the bar — 0 when nothing has arrived yet. */
const share = (b: number) => (total > 0 ? Math.round((b / total) * 100) : 0);
</script>

<div class="data dev-card">
	<div class="dev-card__head">
		<span class="dev-card__title">data today</span>
	</div>

	<div class="big">{fmt(total)}</div>
	<div class="sub">
		{#if avg.days > 0}
			{fmt(avg.bytesPerDay)}/day over {avg.days} {avg.days === 1 ? "day" : "days"}
		{:else}
			first day — no average yet
		{/if}
	</div>

	{#each rows as r (r.kind)}
		<div class="row">
			<span class="label">{r.kind}</span>
			<span class="bytes">{fmt(r.bytes)}</span>
			<span class="bar"><i style="width:{share(r.bytes)}%"></i></span>
		</div>
	{:else}
		<div class="note">nothing measured yet — pan the map</div>
	{/each}

	{#if history.length > 0}
		<div class="sep"></div>
		<div class="title">earlier days</div>
		{#each history as d (d.day)}
			<div class="row">
				<span class="label">{d.day.slice(5)}</span>
				<span class="bytes">{fmt(dayTotal(d.kinds))}</span>
				<span class="bar"></span>
			</div>
		{/each}
	{/if}

	<!-- A zero row is "free or unmeasurable", never "no request": transferSize is
	     0 for a cache hit and for a cross-origin response with no
	     Timing-Allow-Origin. The satellite row also reads low whenever the
	     worker bakes tiles on its own thread (dataMeter.svelte.ts). -->
	<div class="note dim">compressed wire bytes · a total is a floor, not a ceiling</div>
</div>

<style>
/* Shell + title from devCard.css (.dev-card) — same look as CURRENT SESSION. */
.big { font-family: "Inter", -apple-system, sans-serif; font-weight: 800; font-size: 30px; line-height: 1.05; color: #ffd24a; margin: 6px 0 0; }
.sub { color: var(--muted2); font-size: 0.85em; margin: 2px 0 8px; }
.title { font-family: "Inter", -apple-system, sans-serif; font-weight: 800; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 10px 0 6px; }
.row { display: flex; align-items: center; gap: 8px; padding: 2px 0; color: var(--muted); }
.label { flex: 0 0 auto; min-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bytes { flex: 0 0 auto; min-width: 58px; text-align: right; font-variant-numeric: tabular-nums; }
.bar { flex: 1 1 auto; height: 6px; border-radius: 999px; background: #3a3a3a; overflow: hidden; }
.bar i { display: block; height: 100%; background: #ffd24a; }
.sep { border-top: 1px solid #3a3a3a; margin: 7px 0 5px; }
.note { color: var(--muted2); margin-top: 6px; line-height: 1.3; font-size: 0.85em; }
.note.dim { opacity: 0.75; }
</style>
