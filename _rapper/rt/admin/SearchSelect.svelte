<script lang="ts">
/**
 * A <select> replacement with a search box pinned inside the open dropdown,
 * for a list too big to ship as options but not big enough to need
 * server-side search (tool/orgs' trigram search).
 *
 * Not bits-ui's Popover: its focus trap reinitializes on re-render and snaps
 * focus away mid-typing (see "Popover dismiss pattern" in
 * mobileGetCacheApp.md) — this is a plain <div> with a transparent overlay.
 *
 * Matching is deliberately dumb: case- and accent-insensitive substring, no token splitting or ranking.
 */
import { cubicOut } from "svelte/easing";

interface Item {
	value: string;
	label: string;
	/** Optional second line — a website, a key, a category. Also searched. */
	sublabel?: string;
	/** Optional heading this item files under; groups appear in first-seen order, matching <optgroup>. For some lists the group IS the information. */
	group?: string;
}

let {
	items,
	value = $bindable(""),
	name,
	id,
	placeholder = "Select...",
	searchPlaceholder = "Type to search…",
	required = false,
	disabled = false,
	clearable = false,
	emptyText = "Nothing to choose from",
	/** Show the search box only once the list is long enough to need one. */
	searchThreshold = 8,
	onChange,
}: {
	items: Item[];
	value?: string;
	/** Omit for a control that is not posting a form field (stage_controls). */
	name?: string;
	id?: string;
	placeholder?: string;
	searchPlaceholder?: string;
	required?: boolean;
	disabled?: boolean;
	clearable?: boolean;
	emptyText?: string;
	searchThreshold?: number;
	onChange?: (value: string) => void;
} = $props();

let open = $state(false);
let query = $state("");
/** -1 = nothing highlighted, so Enter can't pick blind. */
let activeIndex = $state(-1);
/** Set when the menu would overflow the viewport, flipping it above the field. */
let dropUp = $state(false);

let searchEl = $state<HTMLInputElement | null>(null);
let listEl = $state<HTMLDivElement | null>(null);
let triggerEl = $state<HTMLButtonElement | null>(null);

/** Fold case AND accents, so "accion" finds "Acción". */
const fold = (s: string): string =>
	s
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();

const showSearch = $derived(items.length >= searchThreshold);

const filtered = $derived.by(() => {
	const q = fold(query);
	if (!q) return items;
	return items.filter(
		(it) =>
			fold(it.label).includes(q) ||
			(it.sublabel ? fold(it.sublabel).includes(q) : false),
	);
});

const selected = $derived(items.find((it) => it.value === value));

/** `filtered` in render order plus group headings, built from the filtered list so an emptied group disappears too. A flat index rides each row for the keyboard cursor. */
const rendered = $derived.by(() => {
	const out: (
		| { kind: "heading"; label: string }
		| { kind: "item"; item: Item; index: number }
	)[] = [];
	let seen: string | null = null;
	filtered.forEach((item, index) => {
		const g = item.group ?? null;
		if (g && g !== seen) out.push({ kind: "heading", label: g });
		seen = g;
		out.push({ kind: "item", item, index });
	});
	return out;
});

/** Flip upward when there is not room below — measured, never assumed. */
const decideDirection = () => {
	const rect = triggerEl?.getBoundingClientRect();
	if (!rect) return;
	const spaceBelow = window.innerHeight - rect.bottom;
	dropUp = spaceBelow < 320 && rect.top > spaceBelow;
};

const openMenu = () => {
	if (disabled || !items.length) return;
	decideDirection();
	open = true;
	query = "";
	// Highlight the current selection so Enter re-picks it rather than jumping to an unrelated first row.
	activeIndex = items.findIndex((it) => it.value === value);
	// After paint — the input doesn't exist until `open` renders.
	queueMicrotask(() => (showSearch ? searchEl : listEl)?.focus());
};

const closeMenu = (returnFocus = false) => {
	open = false;
	query = "";
	activeIndex = -1;
	if (returnFocus) queueMicrotask(() => triggerEl?.focus());
};

const commit = (next: string) => {
	value = next;
	onChange?.(next);
};

const choose = (item: Item) => {
	commit(item.value);
	closeMenu(true);
};

/** Keep the highlighted row in view when arrowing past the fold. */
const scrollActiveIntoView = () => {
	queueMicrotask(() => {
		const row = listEl?.querySelector<HTMLElement>('[data-active="true"]');
		row?.scrollIntoView({ block: "nearest" });
	});
};

const onMenuKeydown = (e: KeyboardEvent) => {
	if (e.key === "ArrowDown" || e.key === "ArrowUp") {
		e.preventDefault();
		if (!filtered.length) return;
		const dir = e.key === "ArrowDown" ? 1 : -1;
		// Wrap; -1 is "before the first row" so one ArrowUp from nothing lands on the last item.
		const from = activeIndex < 0 ? (dir === 1 ? -1 : 0) : activeIndex;
		activeIndex = (from + dir + filtered.length) % filtered.length;
		scrollActiveIntoView();
		return;
	}
	if (e.key === "Enter") {
		e.preventDefault();
		// Exactly one match picks it even without arrowing — the whole point of narrowing by typing.
		const pick =
			activeIndex >= 0
				? filtered[activeIndex]
				: filtered.length === 1
					? filtered[0]
					: null;
		if (pick) choose(pick);
		return;
	}
	if (e.key === "Escape") {
		e.preventDefault();
		closeMenu(true);
	}
	if (e.key === "Tab") closeMenu();
};

/** Open on keyboard without forcing a mouse trip to the trigger. */
const onTriggerKeydown = (e: KeyboardEvent) => {
	if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
		e.preventDefault();
		openMenu();
	}
};

const still = () =>
	typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The admin kit's hinge. `up` flips the rotation with `dropUp`, so a menu that flipped above the field still swings off the edge it is anchored to. */
const hinge = (_node: Element, { up = false }: { up?: boolean } = {}) => ({
	duration: still() ? 0 : 160,
	easing: cubicOut,
	css: (t: number, u: number) =>
		`opacity:${t};transform:perspective(700px) rotateX(${(up ? 10 : -10) * u}deg) translateY(${(up ? 3 : -3) * u}px)`,
});

/** Typing resets the cursor: the old index pointed into a different list. */
$effect(() => {
	void query;
	activeIndex = -1;
});

/** A value no longer in `items` would leave the hidden <select> submitting a stale key while the trigger shows the placeholder. */
$effect(() => {
	if (value && items.length && !items.some((it) => it.value === value)) {
		commit("");
	}
});
</script>

<!-- Hidden so the browser can't render its own native popup over ours; `required` still blocks submit natively. -->
<select
	{name}
	{id}
	bind:value
	{required}
	{disabled}
	class="sr-only"
	tabindex="-1"
	aria-hidden="true"
>
	<option value="" disabled>{placeholder}</option>
	{#each items as item (item.value)}
		<option value={item.value}>{item.label}</option>
	{/each}
</select>

<!-- `bg-background` pairs with `text-foreground` below — don't tidy the foreground away: a UA default of `color: buttontext` beats inherited color, rendering black-on-black on a dark host (/stage_controls did). -->
<div class="relative">
	<div class="flex items-center gap-1">
		<button
			type="button"
			bind:this={triggerEl}
			{disabled}
			onclick={() => (open ? closeMenu() : openMenu())}
			onkeydown={onTriggerKeydown}
			class="border-input bg-background text-foreground focus-visible:ring-ring flex h-10 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
			aria-haspopup="listbox"
			aria-expanded={open}
		>
			<span class="truncate {selected ? '' : 'text-muted-foreground'}">
				{selected?.label ?? (items.length ? placeholder : emptyText)}
			</span>
			<span class="text-muted-foreground shrink-0 opacity-60">▾</span>
		</button>

		<!-- Opt-in: a required field must not offer a way back to empty. -->
		{#if clearable && value && !disabled}
			<button
				type="button"
				onclick={() => commit("")}
				class="text-muted-foreground hover:text-foreground h-10 shrink-0 px-2 text-sm transition-colors"
				aria-label="Clear selection"
				title="Clear selection">✕</button
			>
		{/if}
	</div>

	{#if open}
		<!-- Without this the dismissing click also lands on whatever is underneath — see "Nothing Blanket" in mobileGetCacheApp.md. -->
		<button
			type="button"
			class="fixed inset-0 z-40 cursor-default"
			tabindex="-1"
			aria-label="Close list"
			onclick={() => closeMenu()}
		></button>

		<div
			class="ss-panel border-input bg-background text-foreground absolute right-0 left-0 z-50 overflow-hidden rounded-md border {dropUp
				? 'bottom-full mb-1'
				: 'top-full mt-1'}"
			class:up={dropUp}
			transition:hinge={{ up: dropUp }}
		>
			{#if showSearch}
				<div class="p-2">
					<input
						bind:this={searchEl}
						bind:value={query}
						onkeydown={onMenuKeydown}
						type="text"
						placeholder={searchPlaceholder}
						autocomplete="off"
						spellcheck="false"
						aria-label={searchPlaceholder}
						class="border-input bg-background text-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-2.5 text-sm focus-visible:ring-1 focus-visible:outline-none"
					/>
				</div>
				<div class="border-border border-t"></div>
			{/if}

			<div
				bind:this={listEl}
				onkeydown={onMenuKeydown}
				tabindex="-1"
				role="listbox"
				aria-label={placeholder}
				class="max-h-64 overflow-y-auto p-1 focus:outline-none"
			>
				{#each rendered as row (row.kind === "heading" ? `h:${row.label}` : row.item.value)}
					{#if row.kind === "heading"}
						<div
							class="text-muted-foreground px-2 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase opacity-60"
						>
							{row.label}
						</div>
					{:else}
						{@const isActive = row.index === activeIndex}
						<button
							type="button"
							data-active={isActive}
							role="option"
							aria-selected={row.item.value === value}
							onclick={() => choose(row.item)}
							onmousemove={() => (activeIndex = row.index)}
							class="text-foreground flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors {isActive
								? 'bg-muted'
								: ''}"
						>
							<span
								class="w-3 shrink-0 opacity-70"
								class:invisible={row.item.value !== value}>✓</span
							>
							<span class="min-w-0 flex-1">
								<span class="block truncate">{row.item.label}</span>
								{#if row.item.sublabel}
									<span
										class="text-muted-foreground block truncate text-xs opacity-70"
										>{row.item.sublabel}</span
									>
								{/if}
							</span>
						</button>
					{/if}
				{:else}
					<div class="text-muted-foreground px-2 py-6 text-center text-sm">
						{query ? `No match for “${query}”` : emptyText}
					</div>
				{/each}
			</div>

			{#if showSearch && items.length}
				<div
					class="border-border text-muted-foreground border-t px-3 py-1.5 text-xs opacity-60"
				>
					{filtered.length} of {items.length}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* The one admin-kit elevation for something that has left the grid, so this
	   control sits on the same plane as the column picker and the export menus
	   rather than carrying Tailwind's own shadow scale. Literal fallbacks: the
	   forms that mount this do not all load adminTable.css. */
	.ss-panel {
		box-shadow:
			var(--at-lift-3, 0 24px 48px -12px rgb(0 0 0 / 80%)),
			var(--at-edge-hi, inset 0 1px 0 rgb(255 255 255 / 6%));
		transform-origin: top;
	}
	/* Hinges off the edge it is actually anchored by once `dropUp` flipped it. */
	.ss-panel.up {
		transform-origin: bottom;
	}
</style>
