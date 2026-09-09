<script lang="ts">
import PhoneRig from "$gc/PhoneRig.svelte";
import { configureTilesFromEnv } from "$parent/siblings/getCache_OfflineMap/lib/worker/worker-local-dev/tilesFromEnv";

configureTilesFromEnv();

let { children } = $props();
</script>

<PhoneRig viewport>{@render children()}</PhoneRig>
