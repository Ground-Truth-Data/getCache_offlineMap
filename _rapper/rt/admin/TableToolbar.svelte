<!--
  Copy ▾ / Export ▾ toolbar. Acts on the SELECTED rows when any are checked,
  else on all `filteredRows`. Pure presentation + clipboard/file side effects
  — the parent owns selection state; this only reads the resolved rows.
-->
<script lang="ts">
import { cubicOut } from "svelte/easing";
import {
    copyText,
    downloadText,
    rowsToCsv,
    rowsToJson,
    rowsToMarkdown,
    rowsToSql,
    type Row,
} from "./exportRows";

let {
    columns,
    filteredRows,
    selectedRows,
    tableName,
    onClearSelection,
}: {
    columns: string[];
    filteredRows: Row[];
    selectedRows: Row[];
    tableName: string;
    onClearSelection?: () => void;
} = $props();

let targetRows = $derived(selectedRows.length > 0 ? selectedRows : filteredRows);
let usingSelection = $derived(selectedRows.length > 0);

let openMenu = $state<"copy" | "export" | null>(null);
let flash = $state<string | null>(null);

function toggle(which: "copy" | "export") {
    openMenu = openMenu === which ? null : which;
}
function closeMenu() {
    openMenu = null;
}

function flashLabel(msg: string) {
    flash = msg;
    setTimeout(() => {
        if (flash === msg) flash = null;
    }, 1400);
}

async function doCopy(fmt: "json" | "csv" | "md") {
    const text =
        fmt === "json"
            ? rowsToJson(columns, targetRows)
            : fmt === "csv"
              ? rowsToCsv(columns, targetRows)
              : rowsToMarkdown(columns, targetRows);
    const ok = await copyText(text);
    flashLabel(ok ? `✓ copied ${targetRows.length}` : "✗ copy failed");
    closeMenu();
}

function doExport(fmt: "csv" | "json" | "sql") {
    const base = `${tableName || "table"}-${targetRows.length}rows`;
    if (fmt === "csv") {
        downloadText(`${base}.csv`, rowsToCsv(columns, targetRows), "text/csv");
    } else if (fmt === "json") {
        downloadText(`${base}.json`, rowsToJson(columns, targetRows), "application/json");
    } else {
        downloadText(`${base}.sql`, rowsToSql(tableName, columns, targetRows), "application/sql");
    }
    flashLabel(`⬇ ${targetRows.length} rows`);
    closeMenu();
}

const still = () =>
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Same hinge as the column picker — a short one, because a six-item menu is a smaller claim on the screen than a thirty-two-column panel. */
const hinge = (_node: Element) => ({
    duration: still() ? 0 : 150,
    easing: cubicOut,
    css: (t: number, u: number) =>
        `opacity:${t};transform:perspective(700px) rotateX(${-10 * u}deg) translateY(${-3 * u}px)`,
});
</script>

<svelte:window onclick={closeMenu} />

<div class="tt" role="group" aria-label="Copy and export selected rows">
    <div class="tt-btnwrap">
        <button
            type="button"
            class="tt-btn"
            class:open={openMenu === "copy"}
            onclick={(e) => { e.stopPropagation(); toggle("copy"); }}
        >
            Copy <span class="caret">▾</span>
        </button>
        {#if openMenu === "copy"}
            <div class="tt-menu" role="menu" transition:hinge>
                <button type="button" role="menuitem" onclick={(e) => { e.stopPropagation(); doCopy("json"); }}>Copy as JSON</button>
                <button type="button" role="menuitem" onclick={(e) => { e.stopPropagation(); doCopy("csv"); }}>Copy as CSV</button>
                <button type="button" role="menuitem" onclick={(e) => { e.stopPropagation(); doCopy("md"); }}>Copy as Markdown</button>
            </div>
        {/if}
    </div>

    <div class="tt-btnwrap">
        <button
            type="button"
            class="tt-btn"
            class:open={openMenu === "export"}
            onclick={(e) => { e.stopPropagation(); toggle("export"); }}
        >
            Export <span class="caret">▾</span>
        </button>
        {#if openMenu === "export"}
            <div class="tt-menu" role="menu" transition:hinge>
                <button type="button" role="menuitem" onclick={(e) => { e.stopPropagation(); doExport("csv"); }}>Export CSV</button>
                <button type="button" role="menuitem" onclick={(e) => { e.stopPropagation(); doExport("json"); }}>Export JSON</button>
                <button type="button" role="menuitem" onclick={(e) => { e.stopPropagation(); doExport("sql"); }}>Export SQL (INSERTs)</button>
            </div>
        {/if}
    </div>

    <span class="tt-scope" class:sel={usingSelection}>
        {#if usingSelection}
            {selectedRows.length} selected
            {#if onClearSelection}
                <button type="button" class="tt-clear" onclick={(e) => { e.stopPropagation(); onClearSelection?.(); }}>clear</button>
            {/if}
        {:else}
            all {filteredRows.length} rows
        {/if}
    </span>

    {#if flash}
        <span class="tt-flash">{flash}</span>
    {/if}
</div>

<style>
    .tt { display: inline-flex; align-items: center; gap: 0.5rem; }
    .tt-btnwrap { position: relative; }
    .tt-btn {
        background: #161616; border: 1px solid #333; color: #e8e8e8;
        padding: 0.35rem 0.7rem; border-radius: 8px; font-size: 0.8rem;
        cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem;
        font-family: system-ui, sans-serif;
    }
    .tt-btn:hover { border-color: #555; }
    .tt-btn:active { background: #1f1f1f; }
    .tt-btn.open { border-color: #7ba6d4; color: #bdd8f0; }
    .tt-btn:focus-visible,
    .tt-menu button:focus-visible,
    .tt-clear:focus-visible {
        outline: 1px solid var(--at-gold, #eab627);
        outline-offset: 1px;
    }
    .caret { color: #888; font-size: 0.7rem; }

    .tt-menu {
        position: absolute; top: calc(100% + 4px); left: 0; z-index: 40;
        background: #0f0f0f; border: 1px solid #333; border-radius: 8px;
        padding: 0.25rem; min-width: 12rem;
        box-shadow:
            var(--at-lift-3, 0 24px 48px -12px rgb(0 0 0 / 80%)),
            var(--at-edge-hi, inset 0 1px 0 rgb(255 255 255 / 6%));
        display: flex; flex-direction: column;
        /* The hinge line — the edge this menu is anchored by. */
        transform-origin: top left;
    }
    .tt-menu button {
        background: transparent; border: none; color: #ddd; text-align: left;
        padding: 0.45rem 0.6rem; border-radius: 5px; font-size: 0.8rem;
        cursor: pointer; white-space: nowrap; font-family: system-ui, sans-serif;
    }
    .tt-menu button:hover { background: #1c2a38; color: #fff; }

    .tt-scope { color: #777; font-size: 0.75rem; }
    .tt-scope.sel { color: #7ba6d4; }
    .tt-clear {
        background: transparent; border: none; color: #888;
        text-decoration: underline; cursor: pointer; font-size: 0.72rem;
        padding: 0 0 0 0.2rem;
    }
    .tt-clear:hover { color: #ddd; }

    .tt-flash { color: #7dba6b; font-size: 0.78rem; font-weight: 500; }
</style>
