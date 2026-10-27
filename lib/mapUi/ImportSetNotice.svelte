<!-- A big import on screen that was never saved offline: the planter saves the pins in view or the whole set, sizes shown first. -->
<script lang="ts">
import { onBlob, saveSpots, type Spot, type WaitingSet } from "../../routes/offlinev10/blobService";
import { budgetBytes } from "../../routes/offlinev10/budget";
import { estimateBytes } from "../../routes/offlinev10/download";
import FancyButton from "$gc/FancyButton.svelte";

let set = $state<WaitingSet | null>(null);
let sizes = $state<{ here: number; all: number } | null>(null);
let asked = 0;
// The whole set's size doesn't move when the map does; only "on screen" is re-asked on a pan.
const allSizes = new Map<string, Promise<number>>();
const allOf = (s: WaitingSet): Promise<number> => {
	const key = `${s.key}:${s.all.length}`;
	let size = allSizes.get(key);
	if (!size) allSizes.set(key, (size = estimateBytes(s.all)));
	return size;
};

$effect(() =>
	onBlob((e) => {
		if (e.kind !== "waiting") return;
		const next = e.sets[0] ?? null;
		const same = next && set && next.key === set.key && next.here.length === set.here.length && next.all.length === set.all.length;
		set = next;
		if (same) return;
		sizes = null;
		const ask = ++asked;
		if (next)
			void Promise.all([estimateBytes(next.here), allOf(next)]).then(([here, all]) => {
				if (ask === asked) sizes = { here, all };
			});
	}),
);

const mb = (b: number): string => (b >= 1e9 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`);

function save(spots: Spot[]): void {
	saveSpots(spots);
	set = null;
}
</script>

{#if set}
	<div class="import-set" role="status">
		<p>{set.all.length} imported pins in {set.name || "this map"} aren't saved offline.</p>
		<div class="choices">
			<FancyButton size="xs" onclick={() => set && save(set.here)}>
				{set.here.length === 1 ? "Save this pin" : `Save ${set.here.length} on screen`}{sizes ? ` · about ${mb(sizes.here)}` : ""}
			</FancyButton>
			{#if set.all.length > set.here.length}
				<FancyButton size="xs" variant="rust" disabled={!sizes || sizes.all > budgetBytes()} onclick={() => set && save(set.all)}>
					Save all {set.all.length}{sizes ? ` · about ${mb(sizes.all)}` : ""}{sizes && sizes.all > budgetBytes() ? " — more than this phone keeps" : ""}
				</FancyButton>
			{/if}
		</div>
	</div>
{/if}

<style>
.import-set {
	position: absolute;
	left: 12px;
	right: 84px;
	top: calc(var(--top-bar-h, 4rem) + 12px);
	z-index: 5;
	padding: 10px 14px;
	border-radius: 12px;
	background: rgb(17 17 17 / 0.92);
	border: 1px solid var(--color-accent-gold);
	color: #fff;
	font-size: 14px;
}
p {
	margin: 0 0 8px;
}
.choices {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
</style>
