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
	/* The owner pill's size and ink, not gold: a rarely used tool must not out-shout the row it sits in. */
	.rt-go--pill {
		width: auto;
		height: 1.15rem;
		gap: 3px;
		padding: 0 0.45rem 0 0.2rem;
		margin-left: auto;
		border-color: #c3c8ac;
		border-radius: 999px;
		background: #111;
		color: #c3c8ac;
		font-family: var(--rt-font-body);
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1;
	}
	.rt-go--pill.rt-go--crow {
		border-color: #c3c8ac;
	}
	.rt-go--pill img {
		width: 14px;
		height: 14px;
	}
	.rt-go b {
		font-weight: inherit;
	}
	.rt-go small {
		font-size: inherit;
		opacity: 0.75;
	}
	.rt-go:active {
		transform: scale(0.95);
	}
</style>
