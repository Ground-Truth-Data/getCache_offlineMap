<script lang="ts">
/** The snake ruler's hold timer: a faint full ring the solid ruler fills clockwise, half-way tick at six o'clock. */
let { progress = 0, done = false, r = 30, bw = 9 }: { progress?: number; done?: boolean; r?: number; bw?: number } = $props();

const YEL = "#FFC81F";
const RUST = "#c4552b";
const BAND = "#2a2c31";
const N = 16;
const id = `hr${Math.random().toString(36).slice(2, 8)}`;

const box = $derived(2 * (r + bw + 14));
const d = $derived(`M0 ${-r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`);
const ticks = $derived(
	Array.from({ length: N - 1 }, (_, k) => {
		const i = k + 1;
		const a = (i / N) * Math.PI * 2;
		const maj = i === N / 2;
		const h = maj ? bw * 0.55 : bw * 0.24;
		const s = Math.sin(a);
		const c = -Math.cos(a);
		return { maj, x1: (r - h) * s, y1: (r - h) * c, x2: (r + h) * s, y2: (r + h) * c };
	}),
);
const p = $derived(Math.max(0, Math.min(1, progress)));
const hx = $derived(r * Math.sin(p * Math.PI * 2));
const hy = $derived(-r * Math.cos(p * Math.PI * 2));
</script>

{#snippet track(cls: string)}
	<path {d} fill="none" stroke="#000" stroke-width={bw + 3} stroke-opacity="0.85" />
	<path class={cls} {d} fill="none" stroke={BAND} stroke-width={bw} />
	{#each ticks as t}
		<line class:tk={!t.maj} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.maj ? YEL : "#f2f2ee"} stroke-width={t.maj ? 2.2 : 1.5} stroke-linecap="round" />
	{/each}
{/snippet}

{#snippet bullseye(x: number, y: number)}
	<g transform="translate({x} {y})">
		<circle r="7" fill="rgba(20,22,26,.72)" stroke={YEL} stroke-width="2.2" />
		<circle r="2.5" fill={RUST} />
	</g>
{/snippet}

<svg class="hold-ring" class:done width={box} height={box} viewBox="{-box / 2} {-box / 2} {box} {box}" aria-hidden="true">
	<defs>
		<mask {id} maskUnits="userSpaceOnUse" x={-box / 2} y={-box / 2} width={box} height={box}>
			<path {d} pathLength="100" fill="none" stroke="#fff" stroke-width={bw + 14} stroke-dasharray="{p * 100} 101" />
		</mask>
	</defs>
	<g opacity="0.42">{@render track("")}</g>
	<g mask="url(#{id})" class="pop">{@render track("band")}</g>
	<circle class="burst" cy={-r} r="8" />
	{@render bullseye(0, -r)}
	{#if p > 0.001 && p < 1}{@render bullseye(hx, hy)}{/if}
</svg>

<style>
	.hold-ring {
		display: block;
		overflow: visible;
		pointer-events: none;
	}
	.hold-ring :global(.band),
	.tk {
		transition: stroke 0.2s;
	}
	.done :global(.band) {
		stroke: #ffc81f;
	}
	.done .pop .tk {
		stroke: #15171c;
	}
	.burst {
		fill: none;
		stroke: #ffc81f;
		stroke-width: 3;
		opacity: 0;
		transform-box: fill-box;
		transform-origin: center;
	}
	.done .burst {
		animation: burst 0.4s ease-out;
	}
	.pop {
		transform-box: fill-box;
		transform-origin: center;
	}
	.done .pop {
		animation: pop 0.35s ease-out;
	}
	@keyframes burst {
		to {
			opacity: 0;
			transform: scale(2.4);
		}
		from {
			opacity: 1;
			transform: scale(1);
		}
	}
	@keyframes pop {
		50% {
			transform: scale(1.08);
		}
	}
</style>
