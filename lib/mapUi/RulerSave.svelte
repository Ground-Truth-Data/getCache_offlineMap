<!-- A drawn polygon's Save: a block on open ground, a piece on a block, re-asked whenever a corner moves. -->
<script lang="ts">
import type { Polygon } from "geojson";
import type { Snippet } from "svelte";
import { iconPath } from "../shared/icons";
import { m } from "$parent/src/lib/paraglide/messages";

let { ring, bornAs, onSave, share }: {
    ring: [number, number][];
    /** Absent (no host store): a block. */
    bornAs?: ((where: Polygon) => Promise<{ block: boolean }>) | undefined;
    onSave: (asBlock: boolean) => void;
    /** Drawn above Save, handed the same kind. */
    share?: Snippet<[boolean]> | undefined;
} = $props();

let asBlock = $state(true);
$effect(() => {
    const where: Polygon = { type: "Polygon", coordinates: [[...ring, ring[0]]] };
    if (!bornAs) return;
    let live = true;
    void bornAs(where).then((v) => live && (asBlock = v.block));
    return () => (live = false);
});
</script>

{@render share?.(asBlock)}
<button class="measure-btn measure-save" onclick={() => onSave(asBlock)} title={m.ofmap_ui_save()}>
    <img class="measure-pin-ic" src={iconPath(asBlock ? "block" : "poly")} alt="" />
    {m.ofmap_ui_save()}
</button>
