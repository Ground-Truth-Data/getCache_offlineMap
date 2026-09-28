<script lang="ts">
/**
 * The tray, mounted once per tier in the root layout — never per page. The
 * `{#if dev}` gate is HERE because a component gating itself cannot delete its
 * own call site; this is the only one, so it is the only gate that must be right.
 */
import { onMount } from "svelte";
import { page } from "$app/state";
import EphemeralCard from "./EphemeralCard.svelte";
import EphemeralDock from "./EphemeralDock.svelte";
import arrowGold from "../assets/arrowIconGold.webp";

let { title }: { title?: string } = $props();

const dev = import.meta.env.DEV;

// Folded by default. `?ephem=1|0` forces one load; otherwise the last fold is
// remembered per tab. Storage is read after mount: the tray renders on the
// server too, and the param is the only input both sides agree on.
const FOLD_KEY = "rt-ephem-collapsed";
const urlEphem = page.url.searchParams.get("ephem");
let collapsed = $state(urlEphem !== "1");
let tab = $state<HTMLElement>();

onMount(() => {
	if (urlEphem === null) collapsed = sessionStorage.getItem(FOLD_KEY) !== "0";
});

function toggleFold() {
	collapsed = !collapsed;
	sessionStorage.setItem(FOLD_KEY, collapsed ? "1" : "0");
}

// The phone rig's transform would otherwise be the containing block and pin the tab to the phone.
$effect(() => {
	const el = tab;
	if (!el) return;
	document.body.appendChild(el);
	return () => el.remove();
});

const derived = $derived(
	page.url.pathname.split("/").filter(Boolean).join(" / ") || "home",
);

</script>

{#if dev}
	{#if collapsed}
		<button type="button" class="ephem-tab" bind:this={tab} onclick={toggleFold} aria-label="Show dev tray">
			<img src={arrowGold} alt="" />
		</button>
	{:else}
		<EphemeralDock side="left">
			<EphemeralCard title={title ?? derived} onfold={toggleFold} />
		</EphemeralDock>
	{/if}
{/if}

<style>
.ephem-tab {
	all: unset;
	position: fixed;
	bottom: 14px;
	left: 14px;
	z-index: 8900;
	cursor: pointer;
	width: 36px;
	opacity: 0.6;
	transition: opacity 0.15s;
}
.ephem-tab:hover { opacity: 1; }
/* The asset points left; flipped, it points into the page — "bring it out". */
.ephem-tab img {
	display: block;
	width: 100%;
	height: auto;
	transform: scaleX(-1);
	filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}
</style>
