<script lang="ts">
import { dev } from "$app/environment";
/**
 * /offline — a normal Get Cache page. The (getcache) shell supplies the
 * phone, top bar and tab bar, so the child is told not to draw its own
 * (`framed={false}`). Its dev chrome goes to two kinds of dev-only surface,
 * both outside the phone:
 *   - the TRAY: mounted once in the root layout, on every page. This page only
 *     adds to it — `debugHost` is the tray's content box, and <TrayItem> puts
 *     the parent-guard light in it.
 *   - two EphemeralDocks: this map's instrument rails, left and right. These
 *     stay per-page: they are this map's own panels, and bind:host is wiring
 *     only this page can do.
 */
import OfflineMapPage from "../../lib/OfflineMapPage.svelte";
import { trayHost } from "$rig/dev/trayHost.svelte";
import TrayItem from "$rig/dev/TrayItem.svelte";
import ParentGuardLight from "../../lib/dev/ParentGuardLight.svelte";
import EphemeralDock from "$rig/dev/EphemeralDock.svelte";

const debugHost = $derived(trayHost.el);
let railLeftHost = $state<HTMLElement>();
let railRightHost = $state<HTMLElement>();
</script>

<OfflineMapPage {debugHost} {railLeftHost} {railRightHost} />
<!-- ONLY THE RAILS. The tray is mounted once in the root layout and is on every
     page, so `debugHost` reads THAT tray's content box rather than mounting a
     second card beside it. These docks stay per-page because they are the
     page's own instruments — the map's memory/blobs/config panels — and
     bind:host is per-page wiring. -->
{#if dev}
	<TrayItem><ParentGuardLight /></TrayItem>
	<EphemeralDock side="left" bind:host={railLeftHost} />
	<EphemeralDock side="right" bind:host={railRightHost} />
{/if}
