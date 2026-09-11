<script lang="ts">
import { page } from "$app/state";
import PhoneRig from "$gc/PhoneRig.svelte";
import { isLandscapeRoute } from "$gc/rigOrientation";
import { configureTilesFromEnv } from "$parent/siblings/getCache_OfflineMap/lib/worker/worker-local-dev/tilesFromEnv";

configureTilesFromEnv();

let { children } = $props();
</script>

<PhoneRig viewport landscape={isLandscapeRoute(page.url.pathname)}>
	{@render children()}
</PhoneRig>
