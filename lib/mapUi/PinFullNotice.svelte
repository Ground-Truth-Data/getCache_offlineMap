<!-- A pin whose offline map could not fit says so on the map until the next one lands. -->
<script lang="ts">
import { onBlob } from "../../routes/offlinev10/blobService";
import { BudgetError } from "../../routes/offlinev10/budget";

let message = $state<string | null>(null);

$effect(() =>
	onBlob((e) => {
		if (e.kind === "failed" && e.error instanceof BudgetError) message = e.error.message;
		else if (e.kind === "landed") message = null;
	}),
);
</script>

{#if message}
	<p class="pin-full" role="alert">{message}</p>
{/if}

<style>
.pin-full {
	position: absolute;
	left: 12px;
	right: 12px;
	bottom: calc(env(safe-area-inset-bottom) + 72px);
	z-index: 5;
	margin: 0;
	padding: 10px 14px;
	border-radius: 12px;
	background: rgb(17 17 17 / 0.92);
	border: 1px solid var(--color-accent-terracotta);
	color: #fff;
	font-size: 14px;
	pointer-events: none;
}
</style>
