<!-- The "route there" button: the sign when a road route can be tried, a dashed line when it can only be a
     straight line, so the answer shows before the tap. `km` makes it the popover's distance pill, which looks the
     same either way — it is metadata, not an action. -->
<script lang="ts">
import { m } from "$parent/src/lib/paraglide/messages";
import { distanceText, type Reach } from "./routeLayer";
import sign from "./routeSign.svg";
import signSm from "./routeSignSm.svg";
import line from "./crowLine.svg";

/** Past this, a route from here is no use to anyone: the pill goes. */
const PILL_MAX_KM = 2000;

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

{#if !(km && reach && reach.km > PILL_MAX_KM)}
	<button
		type="button"
		class="rt-go"
		class:rt-go--pill={km}
		class:rt-go--crow={!km && !road}
		aria-label={m.ofmap_route_directions()}
		onclick={(e) => {
			e.stopPropagation();
			onGo();
		}}
	>
		<img src={km ? signSm : road ? sign : line} alt="" />
		{#if km && num}<b>{num}</b><small>{unit}</small>{/if}
	</button>
{/if}

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
		position: relative;
		width: auto;
		height: 26.5px;
		gap: 4px;
		padding: 0 10px 0 4px;
		margin-left: auto;
		border-color: rgba(248, 216, 72, 0.55);
		border-radius: 999px;
		background: transparent;
		font-family: var(--rt-font-display);
		line-height: 1;
	}
	/* 44px to the thumb; the pill itself stays small. */
	.rt-go--pill::after {
		content: "";
		position: absolute;
		inset: -9px -4px;
	}
	.rt-go--pill img {
		width: 17px;
		height: 17px;
	}
	.rt-go--pill b {
		font-weight: 400;
		font-size: 18px;
		color: #d8dbc6;
	}
	.rt-go--pill small {
		font-size: 14px;
		color: #9a9e86;
	}
	.rt-go:active {
		transform: scale(0.95);
	}
</style>
