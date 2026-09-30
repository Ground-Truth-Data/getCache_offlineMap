<!--
    The tab icon — the ONLY <link rel="icon"> on a ReTreever page, asked once
    from the root layout. A second one anywhere (app.html, a header) races
    this one and the browser shows whichever it likes. Admin serves three
    products' dashboards, so there the lit pill names the icon, not the host.
-->
<script lang="ts">
import { page } from "$app/state";
import { SITES, siteOf } from "./sites";
import { adminTabIcon } from "./admin/adminRoutes";

// `siteOf` returns null for a tunnel or LAN device — no site identity to read an icon off.
const site = $derived(siteOf(page.url.hostname));
const icon = $derived(
    (site?.id === "admin" && adminTabIcon(page.url.pathname)) || site?.icon || SITES[0].icon,
);

// `type` must match the file or Chrome silently falls back to /favicon.ico, which doesn't exist here.
const type = $derived(icon.endsWith(".webp") ? "image/webp" : "image/png");
</script>

<svelte:head>
    <link rel="icon" {type} href={icon} />
</svelte:head>
