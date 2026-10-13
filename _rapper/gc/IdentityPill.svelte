<script lang="ts" module>
/** A person as every surface draws them. `picked`: the book owner chose this
 *  colour (ring); otherwise it was handed out on arrival (solid). */
export type Identity = { label: string; color: string; self: boolean; picked: boolean };
</script>

<script lang="ts">
import Icon from "./Icon.svelte";

/** The second half is ONE segment, clobber first: `hammer` (your version was
 *  replaced) shows the hammer and the editor; else `editor` (someone else's
 *  edit) the pen and their name; else `edited` (saved again) the pen alone. */
let {
    who,
    editor = null,
    hammer = false,
    edited = false,
}: { who: Identity; editor?: Identity | null; hammer?: boolean; edited?: boolean } = $props();
const second = $derived(hammer || !!editor || edited);
</script>

<!-- A ring is the "chosen on purpose" look, the same build as you. Never a
     plain outline: the count chips beside it are outlines. -->
<span class="id-pill-wrap" class:id-pill-wrap--double={second}>
    <span
        class="id-pill"
        class:id-pill--ring={who.self || who.picked}
        class:id-pill--self={who.self}
        style:--id-c={who.color || null}
        title={who.label}>{who.label}</span
    >
    {#if hammer}
        <span class="id-pill id-pill--editor id-pill--hammer" title="Your edit was replaced"><Icon name="hammer" size={10} stroke={2.6} />{editor?.label ?? ""}</span>
    {:else if editor}
        <span class="id-pill id-pill--editor" title={`edited by ${editor.label}`}><Icon name="edit" size={10} stroke={2.6} />{editor.label}</span>
    {:else if edited}
        <span class="id-pill id-pill--editor" title="Edited since it was made"><Icon name="edit" size={10} stroke={2.6} /></span>
    {/if}
</span>

<style>
    .id-pill-wrap {
        display: inline-flex;
        align-items: center;
        flex: none;
        min-width: 0;
    }
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
    .id-pill-wrap--double .id-pill:first-child {
        border-radius: 999px 0 0 999px;
        padding-right: 0.4rem;
    }
    .id-pill--editor {
        gap: 3px;
        max-width: 7rem;
        border-radius: 0 999px 999px 0;
        background: #3a2f22;
        color: #e9c79c;
        font-size: 0.72rem;
    }
    .id-pill--hammer {
        background: #4a2a1f;
        color: #ffb39f;
    }
</style>
