<script lang="ts">
/**
 * SIDE CARD — the card that sits in the gutter beside the phone, and becomes
 * a centred card over the app when there is no phone to sit beside.
 *
 * ONE COMPONENT, BOTH STATES. The desktop/mobile split is not the caller's
 * problem: a caller has a card's worth of content and this decides where it
 * goes. Splitting it was the bug — every caller then re-derived "is there a
 * phone" from a media query, and a media query is the wrong question (debug
 * routes are wide with no frame, and the frame mounts after the page does).
 *
 * THREE PLACEMENTS, ONE RULE. Beside the phone when the gutter is at least
 * MIN_LANE_REM wide; floating over the phone screen when there is a frame but
 * the gutter is narrower than that — a card squeezed to a column of five-word
 * lines is unreadable, and the phone is the one box on the page guaranteed
 * to be wide enough; centred in the viewport when there is no phone at all,
 * like every other Get Cache popover. Nothing slides off an edge.
 *
 * IT ESCAPES TO <body> ON MOUNT, and must. The phone rig is drawn with a
 * transform, and a transformed ancestor becomes the containing block for
 * `position: fixed` — so a card rendered inside the rig measures its `left`
 * from the PHONE's edge and lands on top of it. This is not an optional extra
 * a caller could bolt on: a side card that has not escaped is a card over the
 * phone. It lived in <EphemeralDock> behind a dev gate, which is why every
 * public attempt at this landed in the wrong place.
 *
 * <EphemeralCard> and <EphemeralDock> are this card with a dev gate and a
 * content portal. Fix the box here and all three move.
 */
import type { Snippet } from "svelte";
import { onMount } from "svelte";
import { type FrameBox, watchPhoneFrame } from "./phoneFrame.svelte";

/** Narrowest gutter a card will sit in. ~300px at the default root size. */
const MIN_LANE_REM = 18.75;
import "$rig/dev/devCard.css";

let {
	side = "left",
	title = "",
	top = "0px",
	el = $bindable<HTMLElement | undefined>(undefined),
	class: className = "",
	children,
	...rest
}: {
	side?: "left" | "right";
	/** Small label in the header row. Omitted = no header. */
	title?: string;
	/** Extra offset below the host chrome. */
	top?: string;
	/** The element itself, for a caller that portals DOM into it. */
	el?: HTMLElement;
	/** Merged with the box's own classes, never in place of them. */
	class?: string;
	children?: Snippet;
	[key: string]: unknown;
} = $props();

// The measured frame, not a breakpoint. `undefined` until it has been looked
// for — painting a guess first is the flash of a card in the wrong place that
// every reload used to show. `null` is a page with no frame.
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

<!-- `class` is taken out of `rest` above. Left in, a caller's `class="dock"`
     replaces this attribute wholesale and the card loses its shell. -->
<aside
	bind:this={el}
	class="dev-card side-card {className}"
	class:gc-lane={beside}
	class:gc-lane--left={beside && side === "left"}
	class:gc-lane--right={beside && side === "right"}
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
/* .dev-card owns the look, .gc-lane owns the gutter geometry. Only the
   vertical extent is left to decide. */
.side-card {
	display: flex;
	flex-direction: column;
	gap: 10px;
	overflow-y: auto;
	max-height: calc(100dvh - var(--host-chrome, 0px) - 4rem);
	z-index: 40;
}

/* Beside the phone: hovering in the middle of the space under the host
   chrome, equal air above and below. Translated from its own centre so the
   card's height never enters into it. */
.side-card.gc-lane {
	top: calc(50% + var(--host-chrome, 0px) / 2);
	transform: translateY(calc(-50% + var(--nudge, 0px)));
}

/* Floating, gold-edged, centred on its box from its own centre. */
.side-card--centred,
.side-card--over {
	position: fixed;
	transform: translate(-50%, -50%);
	border-color: var(--rt-yellow, #e8b923);
}

/* No phone: the box is the VIEWPORT. Sized with a gutter rather than a
   percentage, so there is padding off the edge at every width — 88vw of a
   narrow phone is still a card touching both sides. */
.side-card--centred {
	left: 50%;
	top: 50%;
	width: min(480px, calc(100vw - 2 * var(--card-gutter, 20px)));
	max-height: calc(100dvh - 2 * var(--card-gutter, 20px));
}

/* Gutter too narrow: the box is the PHONE SCREEN, as the frame publishes it. */
.side-card--over {
	left: calc(var(--phone-frame-left) + var(--phone-frame-width) / 2);
	top: calc(var(--phone-frame-top) + var(--phone-frame-height) / 2);
	width: min(480px, calc(var(--phone-frame-width) - 2 * var(--card-gutter, 20px)));
	max-height: calc(var(--phone-frame-height) - 2 * var(--card-gutter, 20px));
}

/* Not yet placed: it exists and has measured, but nothing is painted until we
   know WHERE. Rendering it centred first and moving it is a visible jump. */
.side-card--unplaced {
	position: fixed;
	visibility: hidden;
}
</style>
