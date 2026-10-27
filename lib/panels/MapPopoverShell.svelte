<script lang="ts">
import type { Snippet } from "svelte";
import { leaderLine, placePopover } from "./mapPopoverGeom";
import { readFloorY } from "../shared/mapKeepOut";

let {
	bbox,
	containerWidth,
	containerHeight,
	isPoint = false,
	wide = false,
	scrollLocked = false,
	children,
}: {
	bbox: { minX: number; minY: number; maxX: number; maxY: number };
	containerWidth: number;
	containerHeight: number;
	isPoint?: boolean;
	wide?: boolean;
	/** ⚠️ Must stay frozen during edit-spotlight or the focused row slides out from under the scrim. */
	scrollLocked?: boolean;
	children: Snippet;
} = $props();

const TOP_RESERVE = 150;
const FLOOR_GAP = 8;

let el = $state<HTMLDivElement | null>(null);

// No map canvas (the v2preview page stages the shell alone) means no tab bar to clear.
function floorReserve(): number {
	const canvas = typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".maplibregl-canvas");
	return canvas ? containerHeight - readFloorY(canvas) + FLOOR_GAP : FLOOR_GAP;
}

// Measured, not hardcoded: safe-area insets move the crow tile.
function crowExclusion(): { left: number; top: number; bottom: number } | null {
	if (typeof document === "undefined") return null;
	const crow = document.querySelector(".crow-slot") as HTMLElement | null;
	const host = el?.offsetParent as HTMLElement | null;
	if (!crow || !host) return null;
	const cr = crow.getBoundingClientRect();
	const hr = host.getBoundingClientRect();
	if (!cr.width) return null;
	return { left: cr.left - hr.left, top: cr.top - hr.top, bottom: cr.bottom - hr.top };
}

// ⚠️ NO ResizeObserver — measuring height to flip above/below loops forever unless width/top/max-height are proven independent of it.
const geom = $derived(
	placePopover({
		bbox,
		containerWidth,
		containerHeight,
		isPoint,
		wide,
		topReserve: TOP_RESERVE,
		bottomReserve: floorReserve(),
		crow: crowExclusion(),
	}),
);
const style = $derived(
	`left:${geom.left}px;top:${geom.top}px;width:${geom.width}px;max-height:${geom.maxH}px`,
);

const leader = $derived(isPoint ? leaderLine(bbox, geom) : null);

// A gesture is owned by where it begins: one starting outside the popover makes the surface pointer-transparent for that gesture, so the tap lands on the map
$effect(() => {
	if (!el) return;
	const node = el;

	let passthrough = false;
	const pointers = new Set<number>();

	function setPassthrough(on: boolean) {
		if (passthrough === on) return;
		passthrough = on;
		node.style.pointerEvents = on ? "none" : "";
	}

	function onPointerDown(e: PointerEvent) {
		const inside = node.contains(e.target as Node);
		if (pointers.size === 0) setPassthrough(!inside);
		else if (!inside) setPassthrough(true);
		pointers.add(e.pointerId);
	}
	function onPointerEnd(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pointers.size === 0) setPassthrough(false);
	}

	window.addEventListener("pointerdown", onPointerDown, true);
	window.addEventListener("pointerup", onPointerEnd, true);
	window.addEventListener("pointercancel", onPointerEnd, true);
	return () => {
		window.removeEventListener("pointerdown", onPointerDown, true);
		window.removeEventListener("pointerup", onPointerEnd, true);
		window.removeEventListener("pointercancel", onPointerEnd, true);
	};
});
</script>

{#if leader}
	<!-- Outside the surface so it never scrolls with content or eats taps. -->
	<svg
		class="rt-fmp-leader"
		width={containerWidth}
		height={containerHeight}
		viewBox="0 0 {containerWidth} {containerHeight}"
		aria-hidden="true"
	>
		<line x1={leader.x0} y1={leader.y0} x2={leader.x1} y2={leader.y1} />
	</svg>
{/if}
<div class="rt-fmp rt-popover-surface" class:rt-fmp--locked={scrollLocked} {style} bind:this={el}>
	{@render children()}
</div>

<style>
	@keyframes rt-fmp-in {
		from { opacity: 0; transform: scale(0.92); }
		to   { opacity: 1; transform: scale(1); }
	}

	/* ⚠️ No bigger dot at the pin end — it reads as another map pin. */
	.rt-fmp-leader {
		position: absolute;
		inset: 0;
		z-index: 17; /* just under the popover surface (18) */
		pointer-events: none;
		animation: rt-fmp-in 0.15s ease-out;
	}
	.rt-fmp-leader line {
		stroke: var(--rt-yellow, #ffd700);
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-dasharray: 0.1 7;
		opacity: 0.85;
	}

	.rt-fmp {
		position: absolute;
		/* BELOW the mob drawer (z 22). */
		z-index: 18;
		max-width: calc(100% - 16px);
		padding: 8px 5px;
		animation: rt-fmp-in 0.15s ease-out;
		overflow-y: auto;
		/* The deck fits the width; a sideways scrollbar here is always a phantom. */
		overflow-x: hidden;
		-webkit-overflow-scrolling: touch;
	}
	.rt-fmp--locked {
		/* BOTH axes: overflow-y:hidden alone promotes overflow-x to auto — a phantom sideways scrollbar. */
		overflow: hidden;
	}
	.rt-fmp::-webkit-scrollbar {
		width: 8px;
	}
	.rt-fmp::-webkit-scrollbar-track {
		margin: var(--rt-radius-sm) 0;
	}
	.rt-fmp::-webkit-scrollbar-thumb {
		background: var(--rt-border-active);
		border-radius: 4px;
	}

	/* The focused description expands and must float over the map, unclipped. */
	.rt-fmp:has(:global(.rt-fd__desc:focus)) {
		overflow: visible;
	}
</style>
