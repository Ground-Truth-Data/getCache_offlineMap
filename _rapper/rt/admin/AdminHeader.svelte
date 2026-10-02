<!--
  Two bands for every (admin) route, driven by adminRoutes.ts, replacing the
  public marketing navbar. Band 1 (PARENTS): the three products plus the
  🎬 stage-controls link to the Get Cache host, tier-1 because clicking it
  doesn't change which product you're in. Band 2 (THE STRIP): everything inside the
  active parent as ONE wrapping run of captioned groups — TOOLS (the apps
  inside the parent), screens/views (uncaptioned, not tables), CRUD (rust),
  LOOKUP (sage, reference vocabularies) — flowing like words in a sentence so
  a row per group doesn't push the grid under the fold; a caption can never
  separate from its first pill (see .grp). A table appears only under the
  TOOL that owns it, never a parent-level fallback.
-->
<script lang="ts">
import { dev } from "$app/environment";
import { goto } from "$app/navigation";
import { onMount } from "svelte";
import { lastTool, rememberTool } from "./lastTool";
import { tableCount } from "./tableCounts.svelte";
import { page } from "$app/state";
import Icon from "$gc/Icon.svelte";
import { getcacheUrl, urlOnSite } from "../sites";
import {
	ADMIN_PARENTS,
	FOUNDR_REPORTS,
	SITE_PARAM,
	STAGE_TOOLS,
	activeParent,
	activeTables,
	activeTool,
	foundrReportHref,
	withSiteParam,
	foundrReportPath,
} from "./adminRoutes";
import type {
	AdminLink,
	AdminParent,
	AdminTool,
	FoundrProject,
} from "./adminRoutes";
import tentIcon from "$rt/assets/tentV5_white.webp";


const adminHref = (href: string): string =>
	urlOnSite("admin", href, page.url);

/**
 * SQLite and Blobs live on the Get Cache host (a separate deployment; its
 * browser storage is per-origin), so their pills must resolve against THAT
 * hostname, not admin. The site rides on the TOOL, not the parent — Get
 * Cache's three tools disagree on hostname.
 */
const onSite = (site: AdminTool["site"], href: string): string =>
	site === "getcache" ? getcacheUrl(href, page.url) : adminHref(href);

const toolHref = (tool: AdminTool, href: string): string =>
	tool.external ?? onSite(tool.site, href);

/** A parent's pill returns to the last tool used under it; only admin-hosted tools are remembered (a getcache one resolved against admin 404s). */
let remembered = $state<Record<string, string>>({});
onMount(() => {
	for (const p of ADMIN_PARENTS) {
		const t = lastTool(p.key);
		if (t) remembered[p.key] = t;
	}
});
$effect(() => {
	const tool = currentTool;
	if (!tool || tool.external || (tool.site && tool.site !== "admin")) return;
	const here = page.url.pathname + page.url.search;
	remembered[current.key] = here;
	rememberTool(current.key, here);
});
const parentHref = (parent: AdminParent): string =>
	urlOnSite("admin", remembered[parent.key] ?? parent.home, page.url);

/** ReTreever's table pages live outside any tool's prefix, so `currentTool` is null there — requiring one here vanished the whole CRUD row on click. */
const crudHref = (href: string): string => onSite(currentTool?.site, href);

const current = $derived(activeParent(page.url.pathname));
const currentTool = $derived(activeTool(page.url.pathname));
const path = $derived(page.url.pathname);

// Foundr only: one Platform key, chosen in tier 1, carried in `?site=` — the same param missMap reads, so picking "B" here lands on B there too.
const isFoundr = $derived(current.key === "foundr");
const projects = $derived((page.data.foundrProjects ?? []) as FoundrProject[]);
const projectsFromFile = $derived(page.data.foundrProjectsSource === "file");
const currentProject = $derived(projects.find((p) => p.id === site) ?? null);
const site = $derived(page.url.searchParams.get(SITE_PARAM) ?? "");

function pickProject(e: Event) {
	const v = (e.currentTarget as HTMLSelectElement).value;
	const url = new URL(page.url);
	if (v) url.searchParams.set(SITE_PARAM, v);
	else url.searchParams.delete(SITE_PARAM);
	goto(`${url.pathname}${url.search}`, { keepFocus: true });
}

// A pill whose page ignores ?site= stays bare, so a URL never claims a scope the screen doesn't honour.
const withSite = (tool: AdminTool): string =>
	withSiteParam(tool.href, isFoundr && tool.scopedToSite ? site || null : null);

const email = $derived(page.data.adminEmail as string | undefined);
// Just the name part — the full address is in the title tooltip.
const who = $derived(email ? email.split("@")[0] : "");

const tools = $derived(current.tools);
// Derived once: re-filtering per strip slice would let the halves disagree.
const visibleTools = $derived(tools.filter((t) => !t.devOnly || dev));
const rowTools = $derived(visibleTools.filter((t) => !t.ownRow));
const ownRowTools = $derived(visibleTools.filter((t) => t.ownRow));
// Foundr splits tier 2 by what follows the dropdown: a `scopedToSite` pill means nothing until a site is picked, so it sits in its own group right of the rule.
const corpusTools = $derived(
	isFoundr ? rowTools.filter((t) => !t.scopedToSite) : rowTools,
);
const projectTools = $derived(
	isFoundr ? rowTools.filter((t) => t.scopedToSite) : [],
);
// Never a parent-level fallback — that hung ReTreever's twenty tables under all five hand-built screens. An own-row tool's tables are already on its line.
const tables = $derived(
	currentTool?.ownRow ? [] : activeTables(page.url.pathname),
);

// A link with no `kind` is a table (the common case); `tool` entries are SCREENS, so they sit ahead of the CRUD caption they'd otherwise misdescribe.
const crudScreens = $derived(tables.filter((l) => l.kind === "tool"));
const crudTables = $derived(tables.filter((l) => l.kind === "table" || !l.kind));
const crudLookups = $derived(tables.filter((l) => l.kind === "lookup"));
const crudViews = $derived(tables.filter((l) => l.kind === "view"));

/**
 * Not a pathname test like every other pill: the views share ONE path,
 * differing only in `?view=`. Both halves are required — the param alone
 * would light "Table" on any other page carrying `?view=table`.
 * DEFAULT_VIEW must match the inspector's own default (adminRoutes.ts).
 */
const DEFAULT_VIEW = "cards";
const viewIsActive = (href: string): boolean => {
	const link = new URL(href, page.url);
	if (link.pathname !== page.url.pathname) return false;
	const want = link.searchParams.get("view") ?? DEFAULT_VIEW;
	return (page.url.searchParams.get("view") ?? DEFAULT_VIEW) === want;
};

/**
 * `.account` is pinned out of the flex flow, so tier 1 can't see it and would
 * wrap a hop underneath it — measured here and reserved via `padding-right`.
 * No constant works: the block's width depends on the signed-in name.
 */
let accEl = $state<HTMLElement | null>(null);
$effect(() => {
    const root = document.documentElement;
    if (!accEl) {
        root.style.setProperty("--admin-acc-w", "0px");
        return;
    }
    const publish = () =>
        root.style.setProperty(
            "--admin-acc-w",
            // +gap, so the pill stops short of the block rather than touching.
            `${Math.ceil(accEl!.getBoundingClientRect().width) + 12}px`,
        );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(accEl);
    return () => ro.disconnect();
});
</script>

<!-- Floor, not policy: several admin pages declare no <title>, and a page's own <svelte:head><title> still wins (layout head renders first). -->
<svelte:head>
    <title>{current.label ? `${current.label} — Admin` : "Admin"}</title>
</svelte:head>

<!-- Each group renders its FIRST pill inside `.lead` (with the caption) and the rest outside it, or every pill's markup would appear twice per group. -->
{#snippet toolPill(tool: AdminTool, dim = false)}
    <a
        class="lnk tool-lnk"
        class:dim
        class:active={tool.key === currentTool?.key}
        href={toolHref(tool, withSite(tool))}
        title={tool.title}
        target={tool.external ? "_blank" : null}
        rel={tool.external ? "noreferrer" : null}
    >
        {tool.label}{tool.external ? " ↗" : ""}
    </a>
{/snippet}
{#snippet tablePill(link: AdminLink, lookup = false)}
    {@const n = tableCount(link.label)}
    <a
        class="lnk {lookup ? 'lookup-lnk' : 'table-lnk'}"
        class:active={path === link.href}
        href={crudHref(withSiteParam(link.href, link.scopedToSite ? site || null : null))}
        title={n === undefined ? link.title : `${link.title} — ${n} rows`}
    >
        {link.label}
        <!-- Only the EMPTY table is marked, to pick out the exception. `=== 0`, not falsy: undefined means the sweep hasn't run and must not claim empty. -->
        {#if n === 0}<span class="empty-dot" aria-hidden="true"></span>{/if}
    </a>
{/snippet}
{#snippet tableGroup(links: AdminLink[], lookup = false)}
    <span class="grp">
        {#each links as link, i (link.href)}
            {#if i === 0}
                <span class="lead">
                    {#if lookup}<span class="grp-tag sage-tag">LOOKUP</span>{:else}<span class="grp-tag">CRUD</span>{/if}
                    {@render tablePill(link, lookup)}
                </span>
            {:else}
                {@render tablePill(link, lookup)}
            {/if}
        {/each}
    </span>
{/snippet}

<header class="admin-hd">
    <div class="tier1">
        <span class="admin-tag">ADMIN</span>
        {#each STAGE_TOOLS as tool}
            <a
                class="tool"
                href={getcacheUrl(tool.href, page.url)}
                title={tool.title}
            >
                <span class="tool-clap">🎬</span>
                <img src={tool.logo} alt={tool.label} class="tool-logo" />
            </a>
        {/each}
        {#each ADMIN_PARENTS as parent}
            <a
                class="hop"
                class:active={parent.key === current.key}
                href={parentHref(parent)}
            >
                <img src={parent.logo} alt="" class="hop-logo" />
                <span>{parent.label}</span>
            </a>
        {/each}
        <!-- <select>, not pills: the list is every scrape target and would out-crowd the products beside it. The ↗ is a sibling, not a select gesture (touch collides with the native long-press); it appears only once a site is picked. -->
        {#if isFoundr}
            <select
                class="proj"
                class:unset={!site}
                value={site}
                onchange={pickProject}
                aria-label="Foundr site"
                title={projectsFromFile
                    ? "The database could not be read — sites listed from Foundr/scripts/data/platforms.json"
                    : "The site every Foundr pill below acts on"}
            >
                <option value="">{projectsFromFile ? "site… (from platforms.json)" : "site…"}</option>
                {#each projects as p (p.id)}
                    <option value={p.id}>{p.id.toUpperCase()} - {p.name}</option>
                {/each}
            </select>
            {#if currentProject?.url}
                <a
                    class="projgo"
                    href={currentProject.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={currentProject.url}
                    aria-label="Open {currentProject.name} in a new tab">↗</a
                >
            {/if}
        {/if}

        <!-- A real POST form, never a link: a GET logout fires on any prefetch or link preview. -->
        {#if email}
            <form class="account" method="POST" action="/logout" bind:this={accEl}>
                <span class="who" title={email}>
                    <img
                        src={tentIcon}
                        alt="Account"
                        class="who-icon"
                    />
                    <span class="who-name">{who}</span>
                </span>
                <button class="signout" type="submit">Sign out</button>
            </form>
        {/if}
    </div>
    <!-- Tiers 2-4 are one wrapping strip, not three fixed rows, so captions travel beside their pills. Empty on the stage/unclaimed paths (see activeParent()). -->
    {#if tools.length || tables.length || crudLookups.length}
        <nav class="strip">
            {#if corpusTools.length}
                <span class="grp">
                    <!-- Sliced rather than `{#if i === 0}`: Svelte requires balanced tags inside a block. -->
                    {#each corpusTools.slice(0, 1) as tool}
                        <span class="lead">
                            <span class="grp-tag gold-tag">TOOLS</span>
                            {@render toolPill(tool)}
                        </span>
                    {/each}
                    {#each corpusTools.slice(1) as tool}
                        {@render toolPill(tool)}
                    {/each}
                </span>
            {/if}
            <!-- Everything right of the rule follows the dropdown, dimmed while nothing is picked. -->
            {#if isFoundr && (projectTools.length || FOUNDR_REPORTS.length)}
                <span class="rule" aria-hidden="true"></span>
                <span class="grp">
                    {#each projectTools.slice(0, 1) as tool}
                        <span class="lead">
                            <span class="grp-tag proj-tag" class:unset={!site}
                                >{site ? site.toUpperCase() : "SITE"}</span
                            >
                            {@render toolPill(tool, !site)}
                        </span>
                    {/each}
                    {#each projectTools.slice(1) as tool}
                        {@render toolPill(tool, !site)}
                    {/each}
                    {#each FOUNDR_REPORTS as r (r.key)}
                        <a
                            class="lnk scr-lnk"
                            class:dim={!site}
                            class:active={path === foundrReportPath(r.key)}
                            href={adminHref(foundrReportHref(r.key, site || null))}
                            title={site ? `${site}${r.suffix}` : `Pick a site to open its ${r.suffix}`}
                        >
                            {r.label}
                        </a>
                    {/each}
                </span>
            {/if}
            <!-- Own-row tools: a forced break, the tool's pill, a rule, then its CRUD/LOOKUP groups — unlike the active-tool ones below, these stay up on every page of the parent. -->
            {#each ownRowTools as tool (tool.key)}
                {@const own = tool.tables ?? []}
                {@const ownTables = own.filter((l) => l.kind === "table" || !l.kind)}
                {@const ownLookups = own.filter((l) => l.kind === "lookup")}
                <span class="break" aria-hidden="true"></span>
                {@render toolPill(tool)}
                {#if ownTables.length}
                    <span class="rule" aria-hidden="true"></span>
                    {@render tableGroup(ownTables)}
                {/if}
                {#if ownLookups.length}
                    {@render tableGroup(ownLookups, true)}
                {/if}
            {/each}
            <!-- The active tool's own pages. No caption: not tables, so CRUD would be lying about them. -->
            {#if crudScreens.length}
                <span class="grp">
                    {#each crudScreens as link}
                        <a
                            class="lnk scr-lnk"
                            class:active={path === link.href}
                            href={crudHref(link.href)}
                            title={link.title}
                        >
                            {link.label}
                        </a>
                    {/each}
                </span>
            {/if}
            <!-- Plain pills, not a segmented control (a group outline reads as a separate widget). <a href>, not <button>: state lives in the URL. -->
            {#if crudViews.length}
                <span class="grp">
                    {#each crudViews as link}
                        <a
                            class="lnk view-lnk"
                            class:active={viewIsActive(link.href)}
                            href={crudHref(link.href)}
                            title={link.title}
                        >
                            {#if link.icon}<Icon name={link.icon} size={12} />{/if}
                            {link.label}
                        </a>
                    {/each}
                </span>
            {/if}
            {#if crudTables.length}
                {@render tableGroup(crudTables)}
            {/if}
            {#if crudLookups.length}
                {@render tableGroup(crudLookups, true)}
            {/if}
        </nav>
    {/if}
</header>

<style>
    /* Must clear the page tables' own sticky `thead` (z-10), or the table header parks ON TOP of the nav. */
    .admin-hd {
        /* --rt-sage resolves to EMPTY STRING on the admin host (dropped between
           mobile.css's :root and app.css's Tailwind-processed @import), so this
           header hardcodes the literal rather than fail silently and look styled.
           Keep it in step with --palette-sage (app.css) / --rt-sage (mobile.css). */
        --rt-sage: var(--palette-sage, #838963);
        /* Every grey in this band is one of these three, mixed onto the band's
           OWN floor rather than the sheet's, so moving the floor moves them with
           it instead of leaving three hand-picked greys behind. */
        --hd-txt: color-mix(in srgb, var(--at-fg) 66%, var(--at-panel));
        --hd-dim: color-mix(in srgb, var(--at-fg) 52%, var(--at-panel));
        --hd-edge: color-mix(in srgb, var(--at-fg) 26%, var(--at-panel));
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        padding-top: 0.75rem;
        padding-bottom: 0.6rem;
        padding-inline: 24px;
        /* NOT sticky — the header scrolls away with the page; only the table's own column-header row freezes. `relative` positions .account. */
        position: relative;
        /* CHROME, not page: the band used to be --at-bg, the same black the grid
           sits on, so it read as the top of the sheet rather than as a thing
           above it — and it stayed put when the kit's blacks were re-stepped.
           --at-panel is the kit's first step off the sheet. */
        background: var(--at-panel);
        border-bottom: 1px solid var(--at-line);
        z-index: 50;
        box-sizing: border-box;
    }

    /* Without `flex-wrap` a narrow window has nowhere to put the overflow and pills OVERLAP instead of clipping. Looser row-gap for a wrapped second line. */
    .tier1 {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
        row-gap: 0.45rem;
        /* Keeps the first line clear of the pinned account block (measured width, --admin-acc-w above; fallback covers first paint). */
        padding-right: var(--admin-acc-w, 10rem);
    }
    .admin-tag {
        font-size: 0.62rem;
        font-weight: 700;
        flex-shrink: 0;
        white-space: nowrap;
        letter-spacing: 0.12em;
        color: var(--rt-rust); /* same rust as the CRUD group it introduces — see .table-lnk */
        border: 1px solid color-mix(in srgb, var(--rt-rust), var(--at-panel) 68%);
        border-radius: 4px;
        padding: 0.1rem 0.35rem;
        margin-right: 0.35rem;
    }
    .hop {
        display: flex;
        align-items: center;
        /* Never shrink narrower than its label — the ROW wraps instead. */
        flex-shrink: 0;
        white-space: nowrap;
        gap: 0.4rem;
        text-decoration: none;
        color: var(--hd-dim);
        font-size: 0.95rem;
        font-weight: 600;
        padding: 0.15rem 0.7rem;
        /* Visible grey: --at-line on this floor vanishes and an inactive hop doesn't read as clickable. */
        border: 1px solid var(--hd-edge);
        border-radius: 999px;
        background: transparent;
        transition: color 0.12s ease, border-color 0.12s ease;
    }
    .hop:hover {
        color: var(--at-gold);
        border-color: var(--hd-dim);
    }
    .hop.active {
        color: var(--at-gold);
        border-color: var(--at-gold);
    }
    .hop-logo {
        height: 1.5rem;
        width: auto;
        object-fit: contain;
    }

    /* Rust: CONTEXT (what the pills act on), not a place you go. Native chrome would be the one grey box in a row of outlines, hence the hand-drawn caret. */
    .proj {
        appearance: none;
        -webkit-appearance: none;
        flex-shrink: 0;
        max-width: 18rem;
        margin-left: 0.5rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--rt-rust);
        /* The native popup is OS-drawn and unstyleable; `color-scheme` is the one
           lever that keeps it dark instead of dropping a white menu on the band. */
        color-scheme: dark;
        background-color: var(--at-inset);
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%23c97a4a' stroke-width='1.5'/></svg>");
        background-repeat: no-repeat;
        background-position: right 0.75rem center;
        border: 1px solid color-mix(in srgb, var(--rt-rust), var(--at-panel) 45%);
        border-radius: 999px;
        padding: 0.4rem 2rem 0.4rem 0.9rem;
        text-overflow: ellipsis;
        cursor: pointer;
        transition: border-color 0.12s ease, color 0.12s ease;
    }
    /* Unfilled and smaller than the select — an action ON the picked project, not a second control beside it. */
    .projgo {
        flex-shrink: 0;
        margin-left: 0.3rem;
        padding: 0.25rem 0.35rem;
        font-size: 0.9rem;
        line-height: 1;
        text-decoration: none;
        color: color-mix(in srgb, var(--rt-rust), var(--at-panel) 30%);
        border-radius: 5px;
        transition: color 0.12s ease, background-color 0.12s ease;
    }
    .projgo:hover,
    .projgo:focus-visible {
        color: var(--rt-rust);
        background-color: var(--at-hover);
        outline: none;
    }

    .proj:hover,
    .proj:focus-visible {
        border-color: var(--rt-rust);
        outline: none;
    }
    .proj.unset {
        color: color-mix(in srgb, var(--rt-rust), var(--at-panel) 42%);
        border-color: color-mix(in srgb, var(--rt-rust), var(--at-panel) 68%);
    }

    /* Deliberately NOT hop-shaped: it doesn't switch hops, so shouldn't wear the "you are in this section" pill. */
    .tool {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        gap: 0.3rem;
        text-decoration: none;
        color: var(--hd-dim);
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        padding: 0.25rem 0.5rem;
        border: 1px solid var(--hd-edge);
        border-radius: 6px;
        background: transparent;
        transition: color 0.12s ease, border-color 0.12s ease;
    }
    /* The gap keeps the controls button beside ADMIN, separate from the hops. */
    .tool:last-of-type {
        margin-right: 0.5rem;
    }
    /* Emoji don't inherit `color` — dimmed to match the greyed logo, restored on hover. */
    .tool-clap {
        font-size: 0.95rem;
        line-height: 1;
        opacity: 0.5;
        transition: opacity 0.12s ease;
    }
    .tool:hover .tool-clap {
        opacity: 1;
    }
    /* Smaller than .hop-logo, or the row reads as five hops instead of four.
       Never greyscale it — the logo IS the label. The GC asset is a
       black-background WebP; `mix-blend-mode: screen` drops black to
       transparent so the glyph floats on the bar. */
    .tool-logo {
        height: 1.05rem;
        width: auto;
        object-fit: contain;
        mix-blend-mode: screen;
        opacity: 0.75;
        transition: opacity 0.12s ease;
    }
    .tool:hover .tool-logo {
        opacity: 1;
    }
    .tool:hover {
        color: var(--at-gold);
        border-color: var(--hd-dim);
    }

    /* One strip for tiers 2-4, deliberately no indent/left rule — those cue nesting, which only reads while each tier owns a whole row. Captions carry the grouping instead. */
    .strip {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.35rem;
        row-gap: 0.4rem;
    }
    /* A GROUP DRAWS NOTHING: never give it a box — a flex ITEM is atomic, so an
       18-pill CRUD group would claim a whole row. `display: contents`
       promotes the caption and every pill to direct children of `.strip`, so
       the wrap can land between ANY two pills; the one break still prevented
       (a stranded caption) is handled on .lead. */
    .grp {
        display: contents;
    }
    /* Caption + first pill as one unbreakable item — a caption's meaning is
       positional, so `display: contents` on .grp must never let the line
       break between "CRUD" and the first table. Narrowest guarantee: keeps
       ONE pill, not "the group never breaks" (which would force a scrollbar). */
    .lead {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        white-space: nowrap;
    }
    /* The strip's one divider — the two sides differ in KIND and share a caption-less line, unlike the captioned groups which mark their own boundary. */
    .rule {
        width: 1px;
        height: 1.15rem;
        flex-shrink: 0;
        margin: 0 0.35rem;
        background: var(--at-line-strong);
    }
    /* A forced line break — the one place a row boundary is meant, not incidental. */
    .break {
        flex-basis: 100%;
        height: 0;
    }
    /* inline-flex + line-height:1, not padding: with `display:inline` the mono font's line box sits the baseline high, so symmetric padding looks bottom-heavy. */
    .lnk {
        display: inline-flex;
        align-items: center;
        line-height: 1;
        font-size: 0.78rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--hd-txt);
        text-decoration: none;
        padding: 0.32rem 0.75rem;
        /* A step darker than the hops (subordinate to tier 1), never as dark as --at-line (reads as no border). */
        border: 1px solid var(--at-line-strong);
        border-radius: 999px;
        background: var(--at-inset);
        transition: color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
    }
    .tool-lnk:hover {
        color: var(--at-gold);
        border-color: var(--hd-dim);
    }
    /* Where you are, in every row of this header: the kit's selected plane, gold
       on it. OPAQUE, not rgba — the band would otherwise show through the one
       pill that has to stand off it. */
    .tool-lnk.active {
        color: var(--at-gold);
        background: var(--at-selected);
        border-color: var(--at-gold);
        font-weight: 600;
    }

    /* RUST like everything at rank 3 — gold would read as a tier-2 tool that wrapped onto the wrong line. Full strength: the busiest pills in the row. */
    .scr-lnk {
        font-size: 0.72rem;
        padding: 0.27rem 0.66rem;
        color: var(--rt-rust);
        border-color: color-mix(in srgb, var(--rt-rust), var(--at-panel) 55%);
    }
    .scr-lnk:hover {
        color: var(--rt-rust);
        border-color: var(--rt-rust);
    }
    /* Active is GOLD — see .tool-lnk.active. */
    .scr-lnk.active {
        color: var(--at-gold);
        background: var(--at-selected);
        border-color: var(--at-gold);
        font-weight: 600;
    }

    /* Identical to .scr-lnk (same rank); the only addition is `gap` for the glyph. */
    .view-lnk {
        gap: 0.34rem;
        font-size: 0.72rem;
        padding: 0.27rem 0.66rem;
        color: var(--rt-rust);
        border-color: color-mix(in srgb, var(--rt-rust), var(--at-panel) 55%);
    }
    .view-lnk:hover {
        color: var(--rt-rust);
        background: color-mix(in srgb, var(--rt-rust) 10%, var(--at-panel));
    }
    .view-lnk.active {
        color: var(--at-gold);
        background: var(--at-selected);
        border-color: var(--at-gold);
        font-weight: 600;
    }
    /* Drawn with `currentColor` so it tracks the label. */
    .view-lnk :global(svg) {
        flex-shrink: 0;
    }

    /* RUST, smaller — subordinate to the tools. Every shade derives from the ONE --rt-rust token, so a fifth hand-rolled orange can't creep in. */
    .table-lnk {
        font-size: 0.7rem;
        padding: 0.26rem 0.62rem;
        color: color-mix(in srgb, var(--rt-rust), var(--at-panel) 12%);
        border-color: color-mix(in srgb, var(--rt-rust), var(--at-panel) 68%);
    }
    .table-lnk:hover {
        color: var(--rt-rust);
        border-color: color-mix(in srgb, var(--rt-rust), var(--at-panel) 45%);
    }
    /* SAGE, the third accent (gold = commit, rust = context, sage = nature): the fixed vocabularies the rust tables point AT. Flat sage: any mix toward the floor drops it under 4.5:1. */
    .lookup-lnk {
        font-size: 0.7rem;
        padding: 0.26rem 0.62rem;
        color: var(--rt-sage);
        border-color: color-mix(in srgb, var(--rt-sage), var(--at-panel) 68%);
    }
    .lookup-lnk:hover {
        border-color: color-mix(in srgb, var(--rt-sage), var(--at-panel) 45%);
    }
    .empty-dot {
        display: inline-block;
        width: 5px;
        height: 5px;
        margin-left: 0.3rem;
        border-radius: 50%;
        background: #b3423a;
        /* Nudged off the text baseline, or it reads as a full stop ending the table name. */
        vertical-align: 0.12em;
    }
    /* Active is GOLD in every row: accent marks the group at rest, gold marks where you are. */
    .table-lnk.active,
    .lookup-lnk.active {
        color: var(--at-gold);
        background: var(--at-selected);
        border-color: var(--at-gold);
        font-weight: 600;
    }

    /* Not a pill: pill-shaped here reads as clickable, and a caption isn't. */
    .grp-tag {
        align-self: center;
        font-size: 0.58rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-weight: 700;
        letter-spacing: 0.12em;
        /* Retuned for this band's floor: a caption is 9px uppercase and the old
           mixes left CRUD at 2.1:1. Still quieter than every pill it names —
           what stops a caption reading as clickable is its shape, not its dimness. */
        color: color-mix(in srgb, var(--rt-rust), var(--at-panel) 12%);
        /* Asymmetric on purpose: must sit further from the previous group's last pill than from the pill it names, or the boundary it marks is the tightest gap on the bar. */
        margin-left: 0.4rem;
        margin-right: 0.15rem;
        white-space: nowrap;
    }
    /* Wears its own group's accent — default rust over sage/gold pills would name the group in a colour it doesn't wear. */
    .sage-tag {
        color: color-mix(in srgb, var(--rt-sage), var(--at-panel) 5%);
    }
    .gold-tag {
        color: color-mix(in srgb, var(--at-gold), var(--at-panel) 35%);
    }
    /* Full-strength rust matching the dropdown — it IS the picked project. */
    .proj-tag {
        color: var(--rt-rust);
    }
    .proj-tag.unset {
        color: color-mix(in srgb, var(--rt-rust), var(--at-panel) 42%);
    }
    /* Follows the dropdown with nothing picked: still a link, visibly not yet meaningful. */
    .lnk.dim {
        opacity: 0.45;
    }

    /* PINNED top-right, never part of the wrap: `margin-left: auto` would be the first item pushed onto a new line, dropping below the hops mid-header.
       Out of flow, so wrapping can't relocate it; `.tier1` reserves the width via padding-right. */
    .account {
        position: absolute;
        top: 0.75rem;
        right: 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-shrink: 0;
    }
    .who {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.78rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--hd-txt);
        /* Deliberately NOT a pill: a status readout, only the button beside it should look pressable. */
        white-space: nowrap;
    }
    /* Same tent as the mobile app's Account, sized to this header's type rather than the mobile nav's, which would tower over the row. */
    .who-icon {
        width: 16px;
        height: 16px;
        object-fit: contain;
        display: block;
    }
    .signout {
        font-size: 0.72rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--hd-dim);
        background: var(--at-inset);
        border: 1px solid var(--at-line-strong);
        border-radius: 999px;
        padding: 0.3rem 0.7rem;
        cursor: pointer;
        transition: color 0.12s ease, border-color 0.12s ease;
    }
    /* Grey, never red or gold: gold means "do this next", red means destructive. Signing out is plain and reversible. */
    .signout:hover {
        color: var(--at-fg);
        border-color: var(--hd-dim);
    }
</style>
