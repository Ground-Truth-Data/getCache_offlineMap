<!-- A shape's block / piece switch: the header says what it is, the button names what it can become.
  The drawer's ledger and the ruler's Save both wear this one. -->
<script lang="ts">
import { iconPath } from "../shared/icons";
import { m } from "$parent/src/lib/paraglide/messages";

let { isBlock, overlaps = null, onclick }: {
    isBlock: boolean;
    /** The block this piece covers part of: it can't be a block, so the switch greys out. */
    overlaps?: string | null;
    onclick: () => void;
} = $props();
</script>

<button type="button" class="cl-switch" disabled={!!overlaps} title={overlaps ? m.ofmap_ui_overlaps({ name: overlaps }) : undefined} {onclick}>
    <img src={iconPath(isBlock ? "poly" : "block")} alt="" />{isBlock ? m.ofmap_ui_make_piece() : m.ofmap_ui_make_block()}
</button>

<style>
    .cl-switch {
        flex: 1;
        min-width: 0;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 9px;
        overflow: hidden;
        border-radius: 11px;
        border: 1px solid #1c1d20;
        background: linear-gradient(#55585e, #2c2e32);
        box-shadow:
            inset 0 1px 0 #6e7177,
            0 2px 5px rgba(0, 0, 0, 0.45);
        font-family: var(--rt-font-display);
        font-size: 1.05rem;
        line-height: 1;
        white-space: nowrap;
        color: var(--rt-yellow);
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .cl-switch:disabled {
        cursor: default;
        opacity: 0.35;
        filter: grayscale(1);
    }
    img {
        width: 26px;
        height: 26px;
        flex: none;
        object-fit: contain;
        filter: drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.8));
    }
</style>
