<script lang="ts">
// Draws ONE frame clip: steps its folder at the declared fps and stops, or
// loops. No placement, no anchors, no targets — the surface around it decides
// where it sits. Size comes from the clip's facts, so every surface that plays
// a clip inherits one width instead of re-deriving it.

import { onDestroy } from "svelte";
import { frameUrls, type ClipFacts } from "./frameClips";

let {
	root,
	clip,
	facts,
	loop = false,
	from = 1,
	to = undefined,
	onDone = undefined,
	onFrame = undefined,
}: {
	/** where the frame folders are served from, no trailing slash */
	root: string;
	clip: string;
	facts: ClipFacts;
	/** loop forever instead of holding the last frame */
	loop?: boolean;
	/** play a 1-based range of the clip; a wipe plays its closing half, waits, then its opening half */
	from?: number;
	to?: number;
	/** called when a non-looping clip reaches its last frame */
	onDone?: () => void;
	/** called with each 1-based frame as it shows; the curtains swap the page at their midpoint */
	onFrame?: (frame: number) => void;
} = $props();

const urls = $derived(frameUrls(root, clip, facts));

let i = $state(0);
let timer: ReturnType<typeof setInterval> | undefined;

function stop() {
	clearInterval(timer);
	timer = undefined;
}

// Cleanup kills the previous interval, so two clips never step the same <img> at once.
$effect(() => {
	const first = Math.max(0, from - 1);
	const last = Math.min(urls.length, to ?? urls.length);
	const ms = 1000 / facts.fps;
	i = first;
	stop();
	onFrame?.(first + 1);
	timer = setInterval(() => {
		if (i + 1 < last) {
			i += 1;
			onFrame?.(i + 1);
			return;
		}
		if (loop) {
			i = first;
			return;
		}
		stop();
		onDone?.();
	}, ms);
	return stop;
});

onDestroy(stop);

// Without the preload the first play of a 163-frame clip stutters once, during the take.
$effect(() => {
	for (const u of urls) {
		const img = new Image();
		img.src = u;
	}
});
</script>

<!-- One <img>, src swapped per frame — not 163 stacked elements the browser keeps in the layer tree. -->
<img
	class="frame-clip"
	src={urls[i]}
	alt=""
	draggable="false"
	style="width: {facts.widthRem}rem"
/>

<style>
	/* No object-fit and no crop: a clip set shares one coordinate space, so
	   squeezing any one breaks entrance → turn → exit alignment. Raise widthRem instead. */
	.frame-clip {
		display: block;
		height: auto;
		max-width: none;
		user-select: none;
		-webkit-user-drag: none;
	}
</style>
