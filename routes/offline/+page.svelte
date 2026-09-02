<script lang="ts">
import { dev } from "$app/environment";
/**
 * /offline — the URL; the page is ../../lib/OfflineMapPage.svelte.
 *
 * A route file is just a mount — keep the logic in the component; two copies of the wiring drift the first time either is touched.
 *
 * Dev chrome (tier pill, debug toggle, instrument rails) lives in `$rig/…` — rapper's shared tree, imported in place by both tiers — and renders only in `vite dev`, never a build.
 *
 * ⚠️ CORRECTED 28 Aug 2026 — ReTreever no longer has /offline (a2980549d deleted its map route trees) and RAPPER is the only tier that mounts this page now, but the components live in rapper/rig/ (since 29 Aug 2026; nothing is synced) — owning the shared tree and mounting a child are separate things.
 */
import OfflineMapPage from "../../lib/OfflineMapPage.svelte";
import EphemeralCard from "$rig/dev/EphemeralCard.svelte";
import ParentGuardLight from "../../lib/dev/ParentGuardLight.svelte";
import EphemeralDock from "$rig/dev/EphemeralDock.svelte";

let debugHost = $state<HTMLElement>();
let railLeftHost = $state<HTMLElement>();
let railRightHost = $state<HTMLElement>();
</script>

<OfflineMapPage {debugHost} {railLeftHost} {railRightHost} />
<!-- Gated at the CALL SITE, not only inside the dock. EphemeralDock and
     EphemeralCard each carry their own `{#if dev}`, which stops them
     rendering but cannot stop them shipping: an unconditional mount is a
     live reference the bundler must keep, so the dev card and devCard.css
     travelled into production builds. A component gating itself can never
     delete its own call site — only the caller can. -->
{#if dev}
	<EphemeralDock side="left" bind:host={railLeftHost}>
		<EphemeralCard title="offline map" bind:host={debugHost}><ParentGuardLight /></EphemeralCard>
	</EphemeralDock>
	<EphemeralDock side="right" bind:host={railRightHost} />
{/if}
