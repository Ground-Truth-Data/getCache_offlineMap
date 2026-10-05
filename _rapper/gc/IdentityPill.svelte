<script lang="ts" module>
/** A person as every surface draws them. `picked`: the book owner chose this
 *  colour (ring); otherwise it was handed out on arrival (solid). */
export type Identity = { label: string; color: string; self: boolean; picked: boolean };
</script>

<script lang="ts">
let { who }: { who: Identity } = $props();
</script>

<!-- A ring is the "chosen on purpose" look, the same build as you. Never a
     plain outline: the count chips beside it are outlines. -->
<span
    class="id-pill"
    class:id-pill--ring={who.self || who.picked}
    class:id-pill--self={who.self}
    style:--id-c={who.color || null}
    title={who.label}>{who.label}</span
>

<style>
    .id-pill {
        --id-ink: var(--id-c, var(--rt-row-sender, #c3c8ac));
        display: inline-flex;
        align-items: center;
        flex: none;
        max-width: 9rem;
        height: 1.15rem;
        padding: 0 0.45rem;
        border-radius: 999px;
        background: var(--id-ink);
        color: #15170f;
        font-family: var(--rt-font-body);
        font-size: 0.7rem;
        font-weight: 700;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .id-pill--ring {
        background: #000;
        color: var(--id-ink);
        box-shadow: inset 0 0 0 1.5px var(--id-ink);
    }
    .id-pill--self {
        font-weight: 800;
    }
</style>
