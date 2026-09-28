<script lang="ts">
// Three placements from the MEASURED frame, never a media query. Escapes to <body> on
// mount: the rig's transform would otherwise be the containing block for `position: fixed`.
import type { Snippet } from "svelte";
import { onMount } from "svelte";
import { type FrameBox, watchPhoneFrame } from "./phoneFrame.svelte";

const MIN_LANE_REM = 18.75;
import "$rig/dev/devCard.css";

let {
	side = "left",
	title = "",
	top = "0px",
	align = "centre",
	el = $bindable<HTMLElement | undefined>(undefined),
	class: className = "",
	children,
	...rest
}: {
	side?: "left" | "right";
	/** Omitted = no header. */
	title?: string;
	top?: string;
	/** "top": hangs from the phone's top edge, so a growing card grows down, not into the nav. */
	align?: "centre" | "top";
	el?: HTMLElement;
	class?: string;
	children?: Snippet;
	[key: string]: unknown;
} = $props();

// `undefined` until looked for — painting a guess first flashes a card in the wrong place.
let frame = $state<FrameBox | null | undefined>(undefined);
$effect(() => watchPhoneFrame((box) => (frame = box)));

const remPx = () =>
	Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const placement = $derived.by((): "beside" | "over" | "centred" | undefined => {
	if (frame === undefined) return undefined;
	if (frame === null) return "centred";
	const lane = side === "left" ? frame.left : frame.right;
	return lane >= MIN_LANE_REM * remPx() ? "beside" : "over";
});
const beside = $derived(placement === "beside");

onMount(() => {
	if (!el) return;
	document.body.appendChild(el);
	return () => el?.remove();
});
</script>

<!-- `class` is taken out of `rest`: left in, a caller's class replaces this attribute wholesale. -->
<aside
	bind:this={el}
	class="dev-card side-card {className}"
	class:gc-lane={beside}
	class:gc-lane--left={beside && side === "left"}
	class:gc-lane--right={beside && side === "right"}
	class:side-card--top={beside && align === "top"}
	class:side-card--over={placement === "over"}
	class:side-card--centred={placement === "centred"}
	class:side-card--unplaced={placement === undefined}
	style="--nudge:{top}"
	{...rest}
>
	{#if title}<div class="dev-card__head"><span class="dev-card__title">{title}</span></div>{/if}
	{@render children?.()}
</aside>

<style>
/* .dev-card owns the look, .gc-lane owns the gutter geometry. */
.side-card {
	display: flex;
	flex-direction: column;
	gap: 10px;
	overflow-y: auto;
	max-height: calc(100dvh - var(--host-chrome, 0px) - 4rem);
	z-index: 40;
	border-color: var(--rt-yellow, #e8b923);
	/* .dev-card's 12px is a debugger's padding; --card-pad lets a dense panel ask for it back. */
	padding: var(--card-pad, 20px 22px);
}

.side-card.gc-lane {
	top: calc(50% + var(--host-chrome, 0px) / 2);
	transform: translateY(calc(-50% + var(--nudge, 0px)));
}
.side-card.gc-lane.side-card--top {
	top: max(var(--phone-frame-top, 0px), var(--host-chrome, 0px) + 12px);
	transform: translateY(var(--nudge, 0px));
}

.side-card--centred,
.side-card--over {
	position: fixed;
	transform: translate(-50%, -50%);
}

/* A gutter, not a percentage, so there is padding off the edge at every width; the bars
   are not symmetrical, so centring shifts by half their difference. */
.side-card--centred {
	left: 50%;
	top: calc(50% + var(--host-chrome-top, 0px) / 2 - var(--host-chrome-bottom, 0px) / 2);
	width: min(480px, calc(100vw - 2 * var(--card-gutter, 20px)));
	max-height: calc(
		100dvh - var(--host-chrome, 0px) - 2 * var(--card-gutter, 20px)
	);
}

/* Gutter too narrow: the box is the phone screen, as the frame publishes it. */
.side-card--over {
	left: calc(var(--phone-frame-left) + var(--phone-frame-width) / 2);
	top: calc(var(--phone-frame-top) + var(--phone-frame-height) / 2);
	width: min(480px, calc(var(--phone-frame-width) - 2 * var(--card-gutter, 20px)));
	max-height: calc(var(--phone-frame-height) - 2 * var(--card-gutter, 20px));
}

/* Nothing is painted until placed: rendering centred first and moving is a visible jump. */
.side-card--unplaced {
	position: fixed;
	visibility: hidden;
}
</style>
