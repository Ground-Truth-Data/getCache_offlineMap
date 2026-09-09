<script lang="ts">
/**
 * THE TRAY, MOUNTED ONCE PER TIER — never per page.
 *
 * Every page wants the same tray: the `dev` pill, the tier switch, the page
 * name. Mounting it per page made that a LIST — ten call sites across five
 * repos, each of which had to remember to mount it AND to wrap the mount in
 * `{#if dev}` so it did not ship. Both halves were forgettable, and both were
 * forgotten: pages had no tray, and production bundles carried the card and
 * devCard.css to every visitor because an unconditional mount is a live
 * reference the bundler must keep.
 *
 * One mount in the root layout deletes the list. Every route passes through
 * the layout, so the tray is on every page by construction — including pages
 * nobody has written yet. There is nothing to add and nothing to forget.
 *
 * WHY THE GATE IS HERE AND NOT ONLY INSIDE THE CARD. EphemeralCard has its
 * own `{#if dev}`, which stops it RENDERING but cannot stop it SHIPPING — a
 * component gating itself can never delete its own call site. This is the
 * only call site now, so this is the only gate that has to be right.
 *
 * `import.meta.env.DEV` is a build-time literal: in a build the condition
 * folds to false, Svelte drops the block, and Rollup drops the import. False
 * on Vercel, on TestFlight and in any `vite build`.
 *
 * A page that wants to ADD to the tray reads `trayHost` and portals into it —
 * it never mounts a second one. A page that wants its own side rails mounts an
 * EphemeralDock, which stays per-page because `bind:host` is per-page wiring.
 */
import { onMount } from "svelte";
import { page } from "$app/state";
import EphemeralCard from "./EphemeralCard.svelte";
import EphemeralDock from "./EphemeralDock.svelte";
import { trayHost } from "./trayHost.svelte";
import arrowGold from "../assets/arrowIconGold.webp";

let { title }: { title?: string } = $props();

const dev = import.meta.env.DEV;

/**
 * FOLDED BY DEFAULT — the tray is dev chrome over the page under test, so it
 * starts out of the way and comes back from a small tab in the corner.
 * `?ephem=1` / `?ephem=0` force the starting state for one load; otherwise
 * the last fold is remembered per tab (sessionStorage, so a fresh tab starts
 * clean). Storage is read after mount: the tray renders on the server too,
 * and the param is the only input both sides can agree on.
 */
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

// Same escape SideCard makes: a transformed ancestor (the phone rig) would
// otherwise become the containing block and pin the tab to the phone's corner.
$effect(() => {
	const el = tab;
	if (!el) return;
	document.body.appendChild(el);
	return () => el.remove();
});

/**
 * The page name is READ FROM THE URL, not passed in. Passing it was the last
 * reason a page had to know the tray existed; deriving it means a new route
 * is labelled correctly the day it is created. `/` is the tier's own home.
 */
const derived = $derived(
	page.url.pathname.split("/").filter(Boolean).join(" / ") || "home",
);

let host = $state<HTMLElement>();

// Published for pages that portal their own panels in. Cleared on destroy so
// a stale element can never outlive the tray that owned it.
$effect(() => {
	trayHost.el = host;
	return () => {
		trayHost.el = undefined;
	};
});
</script>

{#if dev}
	{#if collapsed}
		<button type="button" class="ephem-tab" bind:this={tab} onclick={toggleFold} aria-label="Show dev tray">
			<img src={arrowGold} alt="" />
		</button>
	{:else}
		<EphemeralDock side="left">
			<EphemeralCard title={title ?? derived} bind:host onfold={toggleFold} />
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
