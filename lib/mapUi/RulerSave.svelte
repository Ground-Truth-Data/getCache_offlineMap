<!-- A drawn polygon's Save: a block or a piece, as the host would make it, re-asked whenever a corner moves.
  The switch overrides it until the next move. -->
<script lang="ts">
import type { Polygon } from "geojson";
import { iconPath } from "../shared/icons";
import { m } from "$parent/src/lib/paraglide/messages";
import ShapeSwitch from "./ShapeSwitch.svelte";

type Verdict = { block: boolean; overlaps: string | null };
let { ring, bornAs, onSave }: {
    ring: [number, number][];
    /** Absent (no host store): a block. */
    bornAs?: ((where: Polygon) => Promise<Verdict>) | undefined;
    onSave: (asBlock: boolean) => void;
} = $props();

let verdict = $state<Verdict>({ block: true, overlaps: null });
let picked = $state<boolean | null>(null);
$effect(() => {
    const where: Polygon = { type: "Polygon", coordinates: [[...ring, ring[0]]] };
    picked = null;
    if (!bornAs) return;
    let live = true;
    void bornAs(where).then((v) => live && (verdict = v));
    return () => (live = false);
});
const asBlock = $derived(!verdict.overlaps && (picked ?? verdict.block));
</script>

<button class="measure-btn measure-save" onclick={() => onSave(asBlock)} title={m.ofmap_ui_save()}>
    <img class="measure-pin-ic" src={iconPath(asBlock ? "block" : "poly")} alt="" />
    {m.ofmap_ui_save()}
</button>
<ShapeSwitch isBlock={asBlock} overlaps={verdict.overlaps} onclick={() => (picked = !asBlock)} />
