<!-- The "route there" button: the sign when a road route can be tried, a dashed line when it can only be a
     straight line, so the answer shows before the tap. `km` puts the distance inside it (the popover pill). -->
<script lang="ts">
import { m } from "$parent/src/lib/paraglide/messages";
import { distanceText, type Reach } from "./routeLayer";
import sign from "./routeSign.svg";
import line from "./crowLine.svg";

let {
	reach,
	km = false,
	onGo,
}: {
	/** From `fromYou` — null before the first GPS fix: the sign alone, no number. */
	reach: Reach | null;
	km?: boolean;
	/** Starts the route — `directionsTo` handles both the road and the straight line. */
	onGo: () => void;
} = $props();

const road = $derived(reach?.road ?? true);
const [num, unit] = $derived(reach ? distanceText(reach.km).split(" ") : []);
</script>

<button
	type="button"
	class="rt-go"
	class:rt-go--pill={km}
	class:rt-go--crow={!road}
	aria-label={m.ofmap_route_directions()}
	onclick={(e) => {
		e.stopPropagation();
		onGo();
	}}
>
	<img src={road ? sign : line} alt="" />
	{#if km && num}<b>{num}</b><small>{unit}</small>{/if}
</button>

<style>
	.rt-go {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border-radius: 13px;
		border: 2px solid var(--color-accent-gold);
		background: rgba(0, 0, 0, 0.3);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.rt-go img {
		width: 26px;
		height: 26px;
	}
	.rt-go--crow {
		border-style: dashed;
		border-color: color-mix(in srgb, var(--color-accent-gold) 50%, transparent);
	}
	.rt-go--crow img {
		width: 24px;
		height: 24px;
	}
	.rt-go--pill {
		width: auto;
		height: 34px;
		gap: 6px;
		padding: 0 12px 0 6px;
		margin-left: auto;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.35);
		font-family: var(--rt-font-display);
	}
	.rt-go--pill img {
		width: 22px;
		height: 22px;
	}
	.rt-go b {
		font-weight: 400;
		font-size: 20px;
		line-height: 1;
		color: #fff;
	}
	.rt-go small {
		font-size: 16px;
		line-height: 1;
		color: #b8bba6;
	}
	.rt-go:active {
		transform: scale(0.95);
	}
</style>
