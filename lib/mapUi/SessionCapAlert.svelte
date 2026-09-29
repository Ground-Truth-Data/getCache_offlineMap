<script lang="ts">
import { SESSION_BYTE_CAP, sessionCap } from "../shared/sessionByteCap.svelte";
</script>

{#if sessionCap.tripped}
	<div class="cap-alert" role="alert">
		Map downloads stopped: this session fetched over {SESSION_BYTE_CAP / 1048576} MB. Reload to start a new session.
	</div>
{/if}

<style>
.cap-alert { position: fixed; top: 0; left: 0; right: 0; z-index: 9999; padding: 10px 14px; background: #8a2f14; color: #fff; font: 600 13px/1.35 system-ui, sans-serif; text-align: center; }
</style>
