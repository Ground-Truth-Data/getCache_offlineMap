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
 */
import type { Snippet } from "svelte";
import handPhoneUrl from "./assets/hand_phoneV3.webp";
import backdropUrl from "./assets/getcache_DT_bg.webp";

let { children, viewport = false }: { children?: Snippet; viewport?: boolean } =
	$props();
</script>

{#snippet rig()}
<div class="mobile-preview-backdrop" style="background-image: url({backdropUrl})">
	<div class="mobile-preview-wrapper">
		<img class="mobile-preview-hand" src={handPhoneUrl} alt="" draggable="false" />
		<div class="mobile-preview-frame">
			{@render children?.()}
		</div>
	</div>
</div>
{/snippet}

{#if viewport}
	<div class="phone-viewport">{@render rig()}</div>
{:else}
	{@render rig()}
{/if}
