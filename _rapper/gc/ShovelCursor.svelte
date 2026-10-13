<script lang="ts" module>
/** The fingertip, in px from the image's top-left at the rendered 72×100. Every frame shares the one box, so it holds for all of them. */
export const HOTSPOT_X = 11;
export const HOTSPOT_Y = 5;
</script>

<script lang="ts">
/**
 * The hand-and-shovel pointer, drawn in the DOM in place of the OS cursor.
 * A CSS `cursor: url(...)` flickers against the OS-reported cursor under
 * screen recorders, so the native pointer is hidden (`body.shovel-cursor`
 * in mobile.css) and this is the only visible one. A click adds an
 * expanding ring, so a recorded tap shows WHEN as well as where.
 *
 * A map press (doubleTapToPin.ts emits `gc-press`) turns the hand gold and
 * fills a HoldRing up-left of the press; held still it fires the snake
 * ruler. Moving past slop drops the ring and closes the hand to a fist for
 * the rest of that press. On touch the hand shows only during a map press.
 */
import { onMount } from "svelte";
import HoldRing from "./HoldRing.svelte";
import handPoint from "./assets/hand_point.webp";
import handOpen from "./assets/hand_open.webp";
import handFist from "./assets/hand_fist.webp";
import handGold from "./assets/hand_gold.webp";

type Frame = "point" | "open" | "fist" | "gold";
// All four stay mounted and decoded; swapping a src flickers under a recorder like the old CSS variants did.
const FRAMES: [Frame, string][] = [
	["point", handPoint],
	["open", handOpen],
	["fist", handFist],
	["gold", handGold],
];
const LET_GO_MS = 500;
const RETRACT_MS = 300;
const DONE_HOLD_MS = 400;
// The ring's centre sits up-left of the press so the finger never covers it.
const RING_DX = 38;
const RING_DY = 37;

let el: HTMLDivElement | undefined = $state();
let frame: Frame = $state("point");
let pressing = $state(false);
let ring: { x: number; y: number; progress: number; done: boolean } | null = $state(null);

$effect(() => {
	document.body.classList.toggle("gc-map-pressing", pressing);
});

onMount(() => {
	document.body.classList.add("shovel-cursor");
	let frameTimer: ReturnType<typeof setTimeout> | undefined;
	let ringTimer: ReturnType<typeof setTimeout> | undefined;
	let raf = 0;
	let dragging = false;

	const place = (x: number, y: number) => {
		if (!el) return;
		el.style.transform = `translate3d(${x - HOTSPOT_X}px, ${y - HOTSPOT_Y}px, 0)`;
		if (el.style.visibility !== "visible") el.style.visibility = "visible";
	};
	// Linear from `from` to `to` over `ms`, then `then`.
	const animateRing = (from: number, to: number, ms: number, then?: () => void) => {
		cancelAnimationFrame(raf);
		const t0 = performance.now();
		const step = (t: number) => {
			if (!ring) return;
			const f = Math.min(1, (t - t0) / ms);
			ring.progress = from + (to - from) * f;
			if (f < 1) raf = requestAnimationFrame(step);
			else then?.();
		};
		raf = requestAnimationFrame(step);
	};
	const dropRing = () => {
		cancelAnimationFrame(raf);
		clearTimeout(ringTimer);
		ring = null;
	};

	const release = () => {
		clearTimeout(frameTimer);
		if (!dragging) {
			frame = "point";
			pressing = false;
			return;
		}
		dragging = false;
		frameTimer = setTimeout(() => {
			frame = "open";
			frameTimer = setTimeout(() => {
				frame = "point";
				pressing = false;
			}, LET_GO_MS);
		}, LET_GO_MS);
	};

	const onPress = (e: Event) => {
		const { phase, x, y, ms } = (e as CustomEvent<{ phase: "arm" | "drag" | "end" | "fire"; x: number; y: number; ms: number }>).detail;
		if (phase === "arm") {
			clearTimeout(frameTimer);
			dropRing();
			dragging = false;
			pressing = true;
			frame = "gold";
			place(x, y);
			ring = { x: x - RING_DX, y: y - RING_DY, progress: 0, done: false };
			animateRing(0, 1, ms);
		} else if (phase === "drag") {
			dropRing();
			dragging = true;
			frame = "fist";
		} else if (phase === "end") {
			if (ring && !ring.done) animateRing(ring.progress, 0, RETRACT_MS, dropRing);
		} else if (ring) {
			cancelAnimationFrame(raf);
			ring.progress = 1;
			ring.done = true;
			navigator.vibrate?.(30);
			ringTimer = setTimeout(dropRing, DONE_HOLD_MS);
		}
	};

	const onMouseMove = (e: MouseEvent) => place(e.clientX, e.clientY);
	const onTouchMove = (e: TouchEvent) => {
		const t = e.touches[0];
		if (pressing && t) place(t.clientX, t.clientY);
	};
	const onMouseLeave = () => {
		if (el) el.style.visibility = "hidden";
	};
	// Appended to <body> and self-removing, so it needs no state and cannot leak.
	const onMouseDown = (e: MouseEvent) => {
		const splash = document.createElement("span");
		splash.className = "click-splash";
		splash.style.left = `${e.clientX}px`;
		splash.style.top = `${e.clientY}px`;
		splash.addEventListener("animationend", () => splash.remove());
		document.body.appendChild(splash);
	};
	const onMouseUp = (e: MouseEvent) => e.button === 0 && release();
	const onTouchEnd = (e: TouchEvent) => e.touches.length === 0 && release();

	window.addEventListener("mousemove", onMouseMove, { passive: true });
	window.addEventListener("mousedown", onMouseDown, { passive: true });
	window.addEventListener("mouseup", onMouseUp, { passive: true });
	window.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
	window.addEventListener("touchend", onTouchEnd, { passive: true });
	window.addEventListener("touchcancel", onTouchEnd, { passive: true });
	window.addEventListener("gc-press", onPress);
	document.addEventListener("mouseleave", onMouseLeave);

	return () => {
		clearTimeout(frameTimer);
		clearTimeout(ringTimer);
		cancelAnimationFrame(raf);
		window.removeEventListener("mousemove", onMouseMove);
		window.removeEventListener("mousedown", onMouseDown);
		window.removeEventListener("mouseup", onMouseUp);
		window.removeEventListener("touchmove", onTouchMove, true);
		window.removeEventListener("touchend", onTouchEnd);
		window.removeEventListener("touchcancel", onTouchEnd);
		window.removeEventListener("gc-press", onPress);
		document.removeEventListener("mouseleave", onMouseLeave);
		document.body.classList.remove("shovel-cursor", "gc-map-pressing");
	};
});
</script>

<!-- Hidden until the first mousemove places it. -->
<div bind:this={el} class="fake-cursor" data-frame={frame} style="visibility: hidden">
	{#each FRAMES as [name, src] (name)}
		<img class="fake-cursor-{name}" {src} alt="" draggable="false" />
	{/each}
</div>

{#if ring}
	<div class="hold-ring-at" style="left:{ring.x}px; top:{ring.y}px">
		<HoldRing progress={ring.progress} done={ring.done} />
	</div>
{/if}
