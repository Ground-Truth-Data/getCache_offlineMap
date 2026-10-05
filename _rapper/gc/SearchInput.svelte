<!--
  SearchInput — text input with leading magnifier icon and trailing clear button.
  Use for any in-app search field. Wraps TextInput visuals so all inputs share
  the same surface tokens.
-->
<script lang="ts">
import Icon from "./Icon.svelte";
import type { Snippet } from "svelte";

type Props = {
    value?: string;
    placeholder?: string;
    autofocus?: boolean;
    oninput?: (e: Event) => void;
    onclear?: () => void;
    /** Optional control rendered between the magnifier and the input —
     *  e.g. a field-selector pill (stats plots filter). */
    prefix?: Snippet;
    /** Display-only mode: the input can't be typed in (and never summons
     *  the keyboard) — pair with onclick to open a typing surface that
     *  respects the keyboard rule (InputPopover top drawer). */
    readonly?: boolean;
    onclick?: (e: MouseEvent) => void;
};
let {
    value = $bindable(""),
    placeholder = "Search…",
    autofocus = false,
    oninput,
    onclear,
    prefix,
    readonly = false,
    onclick,
}: Props = $props();

function handleClear() {
    value = "";
    onclear?.();
}
</script>

<div class="rt-search">
    <span class="rt-search__icon" aria-hidden="true">
        <Icon name="search" size={16} />
    </span>
    {#if prefix}{@render prefix()}{/if}
    <!-- svelte-ignore a11y_autofocus -->
    <input
        class="rt-search__input"
        type="search"
        {placeholder}
        bind:value
        {oninput}
        {autofocus}
        {readonly}
        {onclick}
    />
    {#if value}
        <button type="button" class="rt-search__clear" aria-label="Clear" onclick={handleClear}>×</button>
    {/if}
</div>

<style>
    .rt-search {
        display: flex;
        align-items: center;
        gap: var(--rt-space-2);
        padding: var(--rt-space-2) var(--rt-space-3);
        background: var(--rt-input);
        border: 1px solid var(--rt-border);
        border-radius: var(--rt-radius-sm);
    }
    .rt-search:focus-within { border-color: var(--rt-yellow); }

    .rt-search__icon {
        flex-shrink: 0;
        color: var(--rt-yellow);
        display: flex;
    }

    .rt-search__input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: var(--rt-fg);
        font-family: var(--rt-font-body);
        font-size: 0.95rem;
        -webkit-appearance: none;
        appearance: none;
    }
    .rt-search__input::-webkit-search-cancel-button { display: none; }
    .rt-search__input::placeholder { color: var(--rt-fg-muted); }

    .rt-search__clear {
        flex-shrink: 0;
        width: 1.5rem;
        height: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.1);
        border: none;
        border-radius: 50%;
        color: var(--rt-fg);
        font-size: 1rem;
        line-height: 1;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
</style>
