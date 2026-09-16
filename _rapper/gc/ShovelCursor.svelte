<script lang="ts">
/**
 * The hand-and-shovel pointer, drawn in the DOM in place of the OS cursor.
 * A CSS `cursor: url(...)` flickers against the OS-reported cursor under
 * screen recorders, so the native pointer is hidden (`body.shovel-cursor`
 * in mobile.css) and this image is the only visible one. A click adds an
 * expanding ring, so a recorded tap shows WHEN as well as where.
 */
import { onMount } from "svelte";
import handShovelCursor100 from "./assets/hand_shovel_cursor_100.webp";

let el: HTMLImageElement | undefined = $state();

// The fingertip, in px from the image's top-left at the rendered 74×100.
// The image is pinned so THIS point sits on the real pointer.
const HOTSPOT_X = 11;
const HOTSPOT_Y = 5;

onMount(() => {
	document.body.classList.add("shovel-cursor");

	const onMouseMove = (e: MouseEvent) => {
		if (!el) return;
		el.style.transform = `translate3d(${e.clientX - HOTSPOT_X}px, ${e.clientY - HOTSPOT_Y}px, 0)`;
		if (el.style.visibility !== "visible") el.style.visibility = "visible";
	};
	const onMouseLeave = () => {
		if (el) el.style.visibility = "hidden";
	};
	// Appended to <body> and self-removing, so it needs no state and cannot leak.
	const onMouseDown = (e: MouseEvent) => {
		const ring = document.createElement("span");
		ring.className = "click-splash";
		ring.style.left = `${e.clientX}px`;
		ring.style.top = `${e.clientY}px`;
		ring.addEventListener("animationend", () => ring.remove());
		document.body.appendChild(ring);
	};
	window.addEventListener("mousemove", onMouseMove, { passive: true });
	window.addEventListener("mousedown", onMouseDown, { passive: true });
	document.addEventListener("mouseleave", onMouseLeave);

	return () => {
		window.removeEventListener("mousemove", onMouseMove);
		window.removeEventListener("mousedown", onMouseDown);
		document.removeEventListener("mouseleave", onMouseLeave);
		document.body.classList.remove("shovel-cursor");
	};
});
</script>

<!-- Hidden until the first mousemove places it. -->
<img
	bind:this={el}
	class="fake-cursor"
	src={handShovelCursor100}
	alt=""
	draggable="false"
	style="visibility: hidden"
/>
