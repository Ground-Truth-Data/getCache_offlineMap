<!-- The "route there" button, shown only once a road there is found and is within MAX_KM — no road, no button.
     `km` makes it the popover's distance pill: metadata, not an action. -->
<script lang="ts">
import { m } from "$parent/src/lib/paraglide/messages";
import type { LngLat } from "../shared/kmGeo";
import { distanceText, roadKm } from "./routeLayer";
import sign from "./routeSign.svg";
import signSm from "./routeSignSm.svg";

let {
	at,
	km = false,
	onGo,
}: {
	at: Readonly<LngLat>;
	km?: boolean;
	onGo: () => void;
} = $props();
</script>

{#await roadKm(at) then road}
	{#if road !== null}
		{@const [num, unit] = distanceText(road).split(" ")}
		<button
			type="button"
			class="rt-go"
			class:rt-go--pill={km}
			aria-label={m.ofmap_route_directions()}
			onclick={(e) => {
				e.stopPropagation();
				onGo();
			}}
		>
			<img src={km ? signSm : sign} alt="" />
			{#if km}<b>{num}</b><small>{unit}</small>{/if}
		</button>
	{/if}
{/await}

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
	/* The `you` chip's box and type (IdentityPill), so the two sit level. */
	.rt-go--pill {
		position: relative;
		width: auto;
		height: 1.15rem;
		gap: 3px;
		padding: 0 0.45rem 0 0.2rem;
		margin-left: auto;
		border-color: rgba(248, 216, 72, 0.55);
		border-radius: 999px;
		background: transparent;
		font-family: var(--rt-font-body);
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1;
	}
	/* 44px to the thumb; the pill itself stays small. */
	.rt-go--pill::after {
		content: "";
		position: absolute;
		inset: -12px -4px;
	}
	.rt-go--pill img {
		width: 0.85rem;
		height: 0.85rem;
	}
	.rt-go--pill b {
		font-weight: inherit;
		color: #d8dbc6;
	}
	.rt-go--pill small {
		font-size: inherit;
		color: #9a9e86;
	}
	.rt-go:active {
		transform: scale(0.95);
	}
</style>
