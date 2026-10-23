<script lang="ts">
import { m } from "$parent/src/lib/paraglide/messages";
import contactGold from "./assets/contact_gold.webp";
import orgGold from "./assets/org_gold.webp";

let { tab = $bindable("people") }: { tab?: "people" | "orgs" } = $props();
</script>

<div class="tabs" role="tablist" aria-label={m.gc_people_or_orgs()}>
    {#each [["people", m.gc_people(), contactGold], ["orgs", m.gc_orgs(), orgGold]] as const as [key, label, icon] (key)}
        <button type="button" role="tab" aria-selected={tab === key} class:rt-fancy-btn={tab === key} onclick={() => (tab = key)}>
            <img src={icon} alt="" />{label}
        </button>
    {/each}
</div>

<style>
.tabs {
    display: flex;
    gap: 6px;
    margin: 0 0 14px;
    padding: 6px;
    background: #111;
    border: 1px solid #2a2722;
    border-radius: 18px;
    box-shadow: inset 0 2px 6px rgb(0 0 0 / 0.6);
}
.tabs button {
    flex: 1;
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 12px;
    font-family: var(--rt-font-display);
    font-size: 22px;
}
.tabs button:not(.rt-fancy-btn) {
    border: none;
    background: none;
    color: #8d8c85;
}
.tabs img {
    width: 26px;
    height: 26px;
    object-fit: contain;
    filter: grayscale(1) brightness(0.62);
}
.tabs .rt-fancy-btn img {
    filter: brightness(0);
}
</style>
