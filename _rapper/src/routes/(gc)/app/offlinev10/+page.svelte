<script lang="ts">
/**
 * /app/offlinev10 — the offline map, served open-core.
 *
 * The child needs a host; rapper has no app behind it, so it hands over the
 * solo ports (the child's own honest empties) and no tool drawer. The drawer
 * and the anchor set live in a PRIVATE repo, and rapper is the tier a stranger
 * installs from npm — reaching for them here is the build failure that install
 * would hit. The map itself is whole: pan, zoom, blobs, roads, fires, hospitals.
 */
import Page from "$parent/siblings/getCache_OfflineMap/routes/offlinev10/+page.svelte";
import {
	soloHostPorts,
	soloMapPorts,
} from "$parent/siblings/getCache_OfflineMap/lib/shared/soloPorts";
</script>

<Page mapPorts={soloMapPorts()} places={soloHostPorts()} />
