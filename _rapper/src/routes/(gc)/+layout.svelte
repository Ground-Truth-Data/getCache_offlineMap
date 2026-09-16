<script lang="ts">
import { page } from "$app/state";
import PhoneRig from "$gc/PhoneRig.svelte";
import ShovelCursor from "$gc/ShovelCursor.svelte";
import { Toaster } from "svelte-sonner";
import { isLandscapeRoute } from "$gc/rigOrientation";
import { configureTilesFromEnv } from "$parent/siblings/getCache_OfflineMap/lib/worker/worker-local-dev/tilesFromEnv";

configureTilesFromEnv();

let { children } = $props();
</script>

<!-- No `viewport`: rapper draws a nav above every page in dev, so the phone
     takes the box under it, never the window. -->
<PhoneRig landscape={isLandscapeRoute(page.url.pathname)}>
	<!-- The children toast through svelte-sonner; without a viewport every
	     toast, including an import refusal, goes nowhere. {top} object form,
	     not a bare string: a string offsets all four sides. -->
	<Toaster
		position="top-center"
		theme="dark"
		offset={{ top: "5rem" }}
		mobileOffset={{ top: "5rem" }}
	/>
	{@render children()}
</PhoneRig>
<ShovelCursor />
