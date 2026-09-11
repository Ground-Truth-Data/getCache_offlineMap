<script lang="ts">
/**
 * THE PHONE. Backdrop, hand and frame — the one place this markup exists.
 * Geometry and fit rules are the .mobile-preview-* block in gc/theme.css;
 * every tier renders this component and gets the identical rig. Children land
 * inside .mobile-preview-frame, which clips and is the containing block for
 * position:fixed, so a page that fills its slot fills the phone.
 *
 * `viewport` = this page is NOTHING BUT the phone, so it may have the whole
 * window. Default false: the phone fills whatever box its parent gives it, so
 * a nav above it is simply above it. Pass true only where there is no chrome
 * at all — the Capacitor app, rapper's (gc) routes.
 *
 * `landscape` = turn the phone a quarter turn clockwise, the way you would in
 * your hand to read a wide document. OPT-IN AND IT MUST STAY THAT WAY: this
 * one component draws the rig for every tier, so a default-on turn would
 * rotate the landing page and the Capacitor app along with the page that
 * wanted it.
 *
 * Turned, the children go inside .mobile-preview-screen — ONE box, turned back
 * upright, that they then lay out inside normally. It has to be one box and
 * not a rule applied to each child: children are static blocks that stack, so
 * rotating each about its own corner sends the second one out of the frame
 * (measured — the second child landed 200px to the LEFT of the phone). With
 * one box, normal flow happens in the upright box and the turn is applied to
 * the result. The page inside is handed a screen that is wide instead of tall
 * and needs to know nothing else. */
import type { Snippet } from "svelte";
import handPhoneUrl from "./assets/hand_phoneV3.webp";
import backdropUrl from "./assets/getcache_DT_bg.webp";

let {
	children,
	viewport = false,
	landscape = false,
}: { children?: Snippet; viewport?: boolean; landscape?: boolean } = $props();

const year = new Date().getFullYear();
</script>

{#snippet rig()}
<div
	class="mobile-preview-backdrop"
	class:rig-landscape={landscape}
	style="background-image: url({backdropUrl})"
>
	<div class="mobile-preview-wrapper">
		<img class="mobile-preview-hand" src={handPhoneUrl} alt="" draggable="false" />
		<div class="mobile-preview-frame">
			{#if landscape}
				<div class="mobile-preview-screen">{@render children?.()}</div>
			{:else}
				{@render children?.()}
			{/if}
		</div>
	</div>

	<!-- ON THE BACKDROP, NOT IN THE PHONE. Only the framed widths show any
	     backdrop, so the CSS hides this below the phone-frame breakpoint —
	     on a real phone the art fills the box and there is no margin to sit in.
	     Outside .mobile-preview-wrapper so --fit never scales the type. -->
	<div class="rig-legal" aria-hidden="false">
		<span class="rig-legal__item">&copy; {year} Get Cache</span>
		<a class="rig-legal__item" href="/getcache/privacy">Privacy policy</a>
	</div>
</div>
{/snippet}

{#if viewport}
	<div class="phone-viewport">{@render rig()}</div>
{:else}
	{@render rig()}
{/if}
