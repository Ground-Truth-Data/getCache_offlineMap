<script lang="ts">
import { dev } from "$app/environment";
/**
 * /offline — a normal Get Cache page. The (getcache) shell supplies the
 * phone, top bar and tab bar. The map's dev rails — memory, config, blobs —
 * go to two EphemeralDocks outside the phone; they exist only under
 * `vite dev`, and the map draws no rail without a dock.
 */
import OfflineMapPage from "../../lib/OfflineMapPage.svelte";
import EphemeralDock from "$rig/dev/EphemeralDock.svelte";

let railLeftHost = $state<HTMLElement>();
let railRightHost = $state<HTMLElement>();
</script>

<OfflineMapPage {railLeftHost} {railRightHost} />
{#if dev}
	<EphemeralDock side="left" bind:host={railLeftHost} />
	<EphemeralDock side="right" bind:host={railRightHost} />
{/if}
