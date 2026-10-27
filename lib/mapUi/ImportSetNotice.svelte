<!-- An import on screen that isn't saved offline: one line, its size, one Download. A single pin downloads when it is opened. -->
<script lang="ts">
import { onBlob, saveSpots, type WaitingSet } from "../../routes/offlinev10/blobService";
import { budgetBytes } from "../../routes/offlinev10/budget";
import { estimateBytes } from "../../routes/offlinev10/download";
import FancyButton from "$gc/FancyButton.svelte";

let set = $state<WaitingSet | null>(null);
let size = $state<number | null>(null);
// A set's size doesn't move with the map, so it is asked once per set and pin count.
const sizes = new Map<string, Promise<number>>();

$effect(() =>
	onBlob((e) => {
		if (e.kind !== "waiting") return;
		const next = e.sets[0] ?? null;
		set = next;
		if (!next) return;
		const key = `${next.key}:${next.all.length}`;
		let ask = sizes.get(key);
		if (!ask) sizes.set(key, (ask = estimateBytes(next.all)));
		size = null;
		void ask.then((b) => {
			if (set && `${set.key}:${set.all.length}` === key) size = b;
		});
	}),
);

const mb = (b: number): string => (b >= 1e9 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`);

function download(s: WaitingSet): void {
	saveSpots(s.all);
	set = null;
}
</script>

{#if set}
	<div class="import-set" role="status">
		<p>{set.name || "This import"} · {set.all.length} {set.all.length === 1 ? "pin" : "pins"}{size !== null ? ` · about ${mb(size)}` : ""}</p>
		<FancyButton size="xs" disabled={size === null || size > budgetBytes()} onclick={() => set && download(set)}>
			{size !== null && size > budgetBytes() ? "More than this phone keeps" : "Download"}
		</FancyButton>
	</div>
{/if}

<style>
.import-set {
	position: absolute;
	left: 12px;
	right: 84px;
	top: calc(var(--top-bar-h, 4rem) + 12px);
	z-index: 5;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 10px 14px;
	border-radius: 12px;
	background: rgb(17 17 17 / 0.92);
	border: 1px solid var(--color-accent-gold);
	color: #fff;
	font-size: 14px;
}
p {
	margin: 0;
}
</style>
