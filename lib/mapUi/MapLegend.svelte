<!-- ⚠️ Must render via overlayPortal — .mobile-content's z:0 stacking context otherwise traps the drawer under the nav. -->
<script lang="ts">
import { untrack } from "svelte";
import { cubicOut } from "svelte/easing";
import { fly } from "svelte/transition";
import {
	REARM_TTL_MS,
	REARMING,
	type OverlayKind,
	overlayVisibility,
} from "../mapState/overlayVisibility.svelte";
import {
	overlayOpacity,
	polygonOpacity,
} from "../mapState/overlayOpacity.svelte";
import type { MapHostPorts } from "../shared/mapHostPorts";
import fireIconUrl from "../assets/fire_icon.webp";
import pdfMapsIconUrl from "../assets/pdf_maps_icon.webp";
import pinDefaultUrl from "../assets/pin_library_small/pin_default_sm.webp";
import clusterPinUrl from "../assets/pin_library_small/pin_cluster_gold_sm.webp";
import hospitalPinUrl from "../../routes/hospitals/hospitalPin.webp";

let {
	ports,
	onClose,
	basemapRows = [],
}: {
	ports: MapHostPorts;
	onClose: () => void;
	basemapRows?: readonly LegendRow[];
} = $props();
// `use:` wants a plain identifier, so the host's action is bound locally.
const overlayPortal = $derived(ports.ui.overlayPortal);

// One eye per mount, destroyed with it.
const eyeToggle = untrack(() => ports.ui.createEyeToggle());
$effect(() => () => eyeToggle.destroy());

function toggleKind(kind: OverlayKind) {
	overlayVisibility.toggle(kind);
	eyeToggle.play(overlayVisibility.isVisible(kind), kind);
}

type Swatch =
	| "line"
	| "dashed"
	| "fill"
	| "rail"
	| "pin"
	| "plot"
	| "pdf"
	| "fire"
	| "block"
	| "cluster"
	| "plaque"
	| "dots"
	| "hospital";
export type LegendRow = {
	label: string;
	swatch: Swatch;
	color?: string;
	/** An eye toggle; absent → the row only explains. */
	kind?: OverlayKind;
	slider?: { percent: number; setPercent: (p: number) => void };
	note?: string;
};
type Section = { title: string; rows: readonly LegendRow[] };

const SWATCH_IMG: Partial<Record<Swatch, string>> = {
	pin: pinDefaultUrl,
	pdf: pdfMapsIconUrl,
	fire: fireIconUrl,
	cluster: clusterPinUrl,
	hospital: hospitalPinUrl,
};

// Colours mirror the map paints: drawStyle.ts (BLOCK_GOLD, POLYGON_FILL, --color-draw), the plaque and dots in pinMarkers.ts.
// ⚠️ Wildfire is terracotta, never red — red means a destructive action in this app.
const SECTIONS: readonly Section[] = [
	{
		title: "Your marks · tap to show / hide",
		rows: [
			{ label: "Pin", swatch: "pin", kind: "pins" },
			{ label: "Polygon", swatch: "fill", color: "#e8a06a", kind: "shapes", slider: polygonOpacity },
			{ label: "PDF map", swatch: "pdf", kind: "pdf", slider: overlayOpacity },
		],
	},
	{
		title: "Survey plots",
		rows: [
			{ label: "Quality plot", swatch: "plot", color: "#f5d565", kind: "plots" },
			{ label: "Several plots", swatch: "plaque", note: "How many, and their quality. Tap to fan them out." },
			{ label: "Plot status", swatch: "dots", note: "− short of its spots · + planted extra · ● has a fault" },
		],
	},
	{
		title: "Get Cache features · always shown",
		rows: [
			{ label: "Block", swatch: "block", note: "Too small to see, it huddles into a gold egg with a count." },
			{ label: "Line / polygon", swatch: "line", color: "#b36940" },
			{ label: "Track", swatch: "rail", color: "#ffd700", note: "Your recorded GPS trail." },
			{ label: "Several pins", swatch: "cluster", note: "Tap to fan them out." },
		],
	},
	{
		title: "Not your marks · tap to show / hide",
		rows: [
			{
				label: "Wildfire",
				swatch: "fire",
				kind: "fires",
				note: "Satellite heat detections, refreshed hourly. A ring means several detections grouped together; fainter means older.",
			},
			{
				label: "Hospitals",
				swatch: "hospital",
				kind: "hospitals",
				note: "The nearest hospitals around you. Tap one for its phone number.",
			},
		],
	},
];

const REARM_HOURS = Math.round(REARM_TTL_MS / 3_600_000);
const sections = $derived(
	basemapRows.length ? [...SECTIONS, { title: "Basemap", rows: basemapRows }] : SECTIONS,
);

function noteFor(row: LegendRow, on: boolean): string | undefined {
	if (row.kind && !on && REARMING.includes(row.kind))
		return `Hidden for now — back on its own within ${REARM_HOURS} h.`;
	return row.note;
}
</script>

{#snippet swatch(row: LegendRow)}
	<span class="legend-swatch legend-swatch--{row.swatch}" style:--swatch-color={row.color}>
		{#if SWATCH_IMG[row.swatch]}
			<img class="legend-swatch-img" src={SWATCH_IMG[row.swatch]} alt="" />
		{/if}
		{#if row.swatch === "plot"}<span class="legend-plot-n">1</span>
		{:else if row.swatch === "cluster"}<span class="legend-cluster-n">3</span>
		{:else if row.swatch === "plaque"}<span class="legend-plot-n">3</span><span class="legend-plaque-pct">92%</span>
		{:else if row.swatch === "dots"}
			<span class="legend-dot legend-dot--under">−</span>
			<span class="legend-dot legend-dot--over">+</span>
			<span class="legend-dot legend-dot--fault"></span>
		{/if}
	</span>
{/snippet}

<!-- |global — parents mount/unmount this via {#if legendOpen}, so the transition needs the global modifier. -->
<div
	class="legend-card"
	role="dialog"
	aria-label="Map legend"
	use:overlayPortal
	in:fly|global={{ y: -420, duration: 500, easing: cubicOut, opacity: 1 }}
	out:fly|global={{ y: -420, duration: 380, easing: cubicOut, opacity: 1 }}
>
	<div class="legend-head">
		<h2 class="legend-title">legend</h2>
		<button type="button" class="legend-ok" aria-label="Close legend" onclick={onClose}>OK</button>
	</div>

	{#each sections as section (section.title)}
		<p class="legend-group-label">{section.title}</p>
		<ul class="legend-list">
			{#each section.rows as row (row.label)}
				{@const on = row.kind ? overlayVisibility.isVisible(row.kind) : true}
				{@const note = noteFor(row, on)}
				<li class="legend-row" class:legend-row--info={!row.kind}>
					{#if row.kind}
						{@const kind = row.kind}
						<!-- A <range> can't nest inside a <button>, so the card is a div and the eye button stretches over it. -->
						<div
							class="legend-toggle"
							class:is-off={eyeToggle.isSettledOff(on, kind)}
							class:legend-toggle--slider={!!row.slider}
						>
							{@render swatch(row)}
							<span class="legend-label">{row.label}</span>
							{#if row.slider}
								{@const slider = row.slider}
								<span class="legend-slider-wrap">
									<input
										class="legend-slider"
										type="range"
										min="0"
										max="100"
										step="1"
										value={slider.percent}
										oninput={(e) => slider.setPercent(Number(e.currentTarget.value))}
										aria-label="{row.label} opacity"
									/>
								</span>
							{/if}
							<button
								type="button"
								class="legend-eye-btn"
								aria-pressed={on}
								aria-label="Show or hide {row.label}"
								onclick={() => toggleKind(kind)}
							>
								<img class="legend-eye" src={eyeToggle.srcFor(on, kind)} alt="" aria-hidden="true" />
							</button>
						</div>
					{:else}
						{@render swatch(row)}
						<span class="legend-label">{row.label}</span>
					{/if}
				</li>
				{#if note}
					<li class="legend-note">{note}</li>
				{/if}
			{/each}
		</ul>
	{/each}
</div>

<style>
	/* position:fixed + overlayPortal is frame-local on dt-web — the phone frame's contain:layout is the containing block. */
	.legend-card {
		position: fixed;
		z-index: 51;
		top: 0;
		left: 0;
		right: 0;
		max-height: min(72%, 32rem);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: max(0.9rem, env(safe-area-inset-top)) 1rem 1rem;
		border-radius: 0 0 1.4rem 1.4rem;
		background: var(--color-background, #16130f);
		border: 1px solid color-mix(in srgb, var(--color-accent), transparent 55%);
		border-top: none;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
	}
	.legend-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.legend-title {
		margin: 0;
		padding-left: 5px;
		color: var(--rt-yellow);
		font-size: 1.5rem;
		font-weight: 500;
		text-transform: lowercase;
	}
	/* The ONLY way out of the drawer — no tap-outside dismiss. */
	.legend-ok {
		position: relative;
		flex-shrink: 0;
		padding: 0.46rem 1.35rem;
		border-radius: 0.7rem;
		border: 1px solid color-mix(in srgb, var(--rt-yellow) 70%, #000);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--rt-yellow) 88%, #fff) 0%,
				var(--rt-yellow) 46%,
				color-mix(in srgb, var(--rt-yellow) 78%, #000) 100%
			);
		color: var(--rt-gold-ink);
		font-family: inherit;
		font-size: 1.1rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, #fff 60%, transparent),
			inset 0 -1px 1px color-mix(in srgb, var(--rt-gold-ink) 45%, transparent),
			0 2px 5px color-mix(in srgb, var(--rt-yellow) 45%, transparent),
			0 1px 2px rgba(0, 0, 0, 0.4);
		transition:
			transform 0.08s ease,
			box-shadow 0.12s ease,
			filter 0.12s ease;
	}
	.legend-ok::before {
		content: "";
		position: absolute;
		inset: 1px 1px auto 1px;
		height: 45%;
		border-radius: 0.6rem 0.6rem 0.9rem 0.9rem / 0.6rem 0.6rem 1.4rem 1.4rem;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, #fff 55%, transparent),
			transparent
		);
		pointer-events: none;
	}
	.legend-ok:active {
		transform: translateY(1px) scale(0.96);
		filter: brightness(0.94);
		box-shadow:
			inset 0 1px 2px color-mix(in srgb, var(--rt-gold-ink) 55%, transparent),
			0 1px 2px rgba(0, 0, 0, 0.4);
	}
	.legend-group-label {
		margin: 0.15rem 0 0;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-accent-sage, #9bb07a);
	}
	.legend-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
	/* Sage, never grey — read outdoors. */
	.legend-note {
		margin: -0.2rem 0 0;
		padding: 0 0.2rem;
		font-size: 0.72rem;
		font-weight: 600;
		line-height: 1.35;
		color: var(--color-accent-sage, #9bb07a);
	}
	.legend-row { display: flex; align-items: center; gap: 0.65rem; }
	/* Lines up with the swatch inside a bordered card. */
	.legend-row--info { padding: 0.1rem calc(0.45rem + 1px); }
	.legend-label { font-size: 0.85rem; line-height: 1.2; color: var(--rt-fg, #f3efe9); }
	.legend-swatch { flex: none; width: 1.5rem; height: 1rem; display: block; }

	.legend-toggle {
		position: relative;
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		width: 100%;
		padding: 0.3rem 0.45rem;
		margin: 0;
		border: 1px solid color-mix(in srgb, var(--color-accent), transparent 70%);
		border-radius: 0.5rem;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: opacity 160ms ease, border-color 160ms ease, background 160ms ease;
	}
	.legend-toggle:active { background: color-mix(in srgb, var(--color-accent), transparent 88%); }
	.legend-toggle.is-off {
		opacity: 0.45;
		border-color: color-mix(in srgb, var(--color-accent), transparent 85%);
	}
	.legend-toggle--slider .legend-label {
		flex: 0 0 8ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Above the stretched eye button, so the thumb still drags. */
	.legend-slider-wrap {
		position: relative;
		z-index: 1;
		flex: 1;
		min-width: 3rem;
		display: flex;
		align-items: center;
	}
	.legend-slider-wrap::before {
		content: "";
		position: absolute;
		left: 50%;
		top: -0.18rem;
		transform: translateX(-50%);
		width: 2px;
		height: 0.32rem;
		border-radius: 1px;
		background: color-mix(in srgb, #fff 85%, transparent);
		pointer-events: none;
	}
	.legend-slider {
		width: 100%;
		accent-color: var(--accent-gold, #f5d04a);
	}
	.legend-eye-btn {
		flex: none;
		margin: -0.2rem -0.25rem -0.2rem auto;
		padding: 0.2rem 0.25rem;
		border: none;
		background: transparent;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
	}
	/* The whole card is the tap target. */
	.legend-eye-btn::before {
		content: "";
		position: absolute;
		inset: 0;
	}
	.legend-eye {
		width: 1.7rem;
		height: auto;
		display: block;
		flex: none;
	}

	.legend-swatch--line { height: 0; border-top: 3px solid var(--swatch-color); align-self: center; }
	.legend-swatch--dashed { height: 0; border-top: 3px dashed var(--swatch-color); align-self: center; }
	.legend-swatch--rail {
		align-self: center;
		height: 0.7rem;
		background:
			repeating-linear-gradient(90deg, var(--swatch-color) 0 2px, transparent 2px 7px),
			linear-gradient(var(--swatch-color), var(--swatch-color)) center / 100% 2px no-repeat;
	}
	.legend-swatch--block {
		position: relative;
		align-self: center;
		height: 0;
		border-top: 4px solid #ffd700;
		box-shadow: 0 0 0 1.5px rgba(14, 16, 8, 0.55);
	}
	/* One block node — the egg in eggs.ts. */
	.legend-swatch--block::after {
		content: "";
		position: absolute;
		left: 50%;
		top: -2px;
		width: 12px;
		height: 12px;
		transform: translate(-50%, -50%);
		border-radius: 50%;
		border: 1.5px solid rgba(14, 16, 8, 0.55);
		background: radial-gradient(circle, rgba(14, 16, 8, 0.85) 0 2px, #ffd700 2.6px);
	}
	.legend-swatch--fill {
		height: 1rem;
		border-radius: 0.25rem;
		background: color-mix(in srgb, var(--swatch-color), transparent 60%);
		border: 1.5px solid var(--swatch-color);
	}
	.legend-swatch--fire,
	.legend-swatch--pin,
	.legend-swatch--pdf,
	.legend-swatch--hospital,
	.legend-swatch--cluster {
		position: relative;
		align-self: center;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.35rem;
	}
	.legend-swatch-img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		display: block;
	}
	.legend-cluster-n {
		position: absolute;
		top: 40%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-family: var(--rt-font-display), sans-serif;
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1;
		color: #fff;
		text-shadow: 0 0 2px #000, 0 1px 2px #000;
	}
	.legend-swatch--plot,
	.legend-swatch--plaque {
		align-self: center;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1rem;
		border-radius: 0.28rem;
		background: #161616;
		border: 1.5px solid #ffd700;
	}
	.legend-swatch--plaque {
		flex-direction: column;
		gap: 1px;
		width: 1.5rem;
		height: auto;
		padding: 2px 0;
	}
	.legend-plot-n {
		font-family: var(--rt-font-display), sans-serif;
		font-size: 0.62rem;
		font-weight: 700;
		line-height: 1;
		color: #ffd700;
	}
	.legend-plaque-pct {
		font-family: var(--rt-font-display), sans-serif;
		font-size: 0.48rem;
		font-weight: 700;
		line-height: 1;
		color: #3fb6c8;
	}
	.legend-swatch--dots {
		align-self: center;
		display: inline-flex;
		align-items: center;
		gap: 2px;
		width: auto;
		min-width: 1.5rem;
	}
	.legend-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		border: 1.25px solid #1a1a1a;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font: 700 8px/1 sans-serif;
		color: #1a1a1a;
	}
	.legend-dot--under { background: #ec6c9c; }
	.legend-dot--over { background: #3fb6c8; }
	.legend-dot--fault { background: #ec6a3a; }
</style>
