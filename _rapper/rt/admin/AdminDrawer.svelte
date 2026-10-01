<!--
  A SIDE PANEL THAT DOES NOT TAKE THE SCREEN — for a queue you work through
  while reading the grid it is about. Stacking the two on one vertical axis
  means only ever having one of them: on Orgs the candidates list expanded to
  9376px and started the table it belongs to at y=9663.

  Non-modal on purpose, and that is the whole design: no scrim, no focus trap,
  no `aria-modal`. The grid behind stays scrollable, clickable and reachable by
  Tab, because the work is comparative. `JsonPeek` is the modal in this kit and
  wants the opposite of every line here.
-->
<script lang="ts">
import { cubicOut } from "svelte/easing";
import type { Snippet } from "svelte";

type Props = {
	open: boolean;
	/** Named on the panel itself — the trigger is elsewhere and scrolls away. */
	title: string;
	/** One line under the title, for what the trigger no longer has room to say. */
	note?: string;
	onclose: () => void;
	/** CSS length. Wide enough for this drawer's own content, never a share of the grid. */
	width?: string;
	children: Snippet;
};
let { open, title, note, onclose, width = "min(560px, 44vw)", children }: Props = $props();

let closeEl = $state<HTMLButtonElement | null>(null);
let opener: Element | null = null;

// Focus ENTERS and comes back, but is never held: half of JsonPeek's behaviour
// on purpose — trapping it here would forbid the grid this panel exists to
// compare against.
$effect(() => {
	if (!open) return;
	const back = opener ?? document.activeElement;
	opener = back;
	closeEl?.focus();
	return () => {
		opener = null;
		if (back instanceof HTMLElement) back.focus();
	};
});

const still = () =>
	typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Slides its OWN box and nothing else: a transform on any ancestor of the grid becomes the containing block for `position: sticky`, and the frozen header and frozen left edge die silently. */
const slide = (_: Element) => ({
	duration: still() ? 0 : 200,
	easing: cubicOut,
	css: (t: number, u: number) => `opacity:${t};transform:translateX(${100 * u}%)`,
});
</script>

{#if open}
	<aside class="addr" style="--addr-w:{width}" transition:slide aria-label={title}>
		<header class="addr-head">
			<div class="addr-id">
				<span class="addr-title">{title}</span>
				{#if note}<span class="addr-note">{note}</span>{/if}
			</div>
			<button bind:this={closeEl} type="button" onclick={onclose} aria-label="Close {title}">✕</button>
		</header>
		<div class="addr-body">
			{@render children()}
		</div>
	</aside>
{/if}

<svelte:window
	onkeydown={(e) => {
		if (open && e.key === "Escape") onclose();
	}}
/>

<style>
/* ABOVE `.admin-hd`, which is z-index 50: this panel is `top: 0` and the nav
   band is in normal flow above it, so at 30 the band painted over the drawer's
   whole header — title, count and the only visible close control. Escape still
   worked, which is how it read as "the drawer has no header" rather than as a
   bug. Below JsonPeek (60), the kit's one modal, which must still open over
   this. ColumnPicker (40/41) is not a conflict: it mounts on the table viewer
   and this drawer only on Orgs, so the two never coexist. */
.addr {
	position: fixed;
	top: 0;
	right: 0;
	z-index: 55;
	width: var(--addr-w);
	max-width: 100vw;
	height: 100dvh;
	display: flex;
	flex-direction: column;
	background: var(--at-panel-2);
	border-left: 1px solid var(--at-line-strong, #3a3a3a);
	box-shadow:
		var(--at-lift-3, 0 24px 48px -12px rgb(0 0 0 / 80%)),
		var(--at-edge-hi, inset 0 1px 0 rgb(255 255 255 / 6%));
}
/* A band, not a caption: it sits still while the body scrolls under it, so it
   takes the same inset surface and lit top edge the grid's own head band wears. */
.addr-head {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 11px 14px;
	background: var(--at-inset);
	border-bottom: 1px solid var(--at-line-strong);
	box-shadow: var(--at-edge-hi);
	flex: none;
}
.addr-id {
	min-width: 0;
	flex: 1;
}
/* The panel's own name, so it reads at the weight of a title. It wore
   `.admin-fieldlbl`'s 11px muted uppercase — the treatment of a minor form
   caption — which is why a 560px panel looked like it had no header at all. */
.addr-title {
	display: block;
	font-size: 13.5px;
	font-weight: 700;
	color: var(--at-fg);
}
.addr-note {
	display: block;
	margin-top: 5px;
	font-size: 11.5px;
	line-height: 1.45;
	color: var(--at-muted-2);
}
/* The only VISIBLE way out — Escape works but nobody discovers it — so it gets
   a real hit target rather than the 24px muted glyph it had. */
.addr-head button {
	flex: none;
	width: 28px;
	height: 28px;
	border-radius: var(--at-radius-sm);
	border: 1px solid var(--at-line-strong);
	background: none;
	color: var(--at-fg);
	font-size: 13px;
	line-height: 1;
	cursor: pointer;
	transition: border-color 120ms ease, color 120ms ease;
}
.addr-head button:hover {
	border-color: var(--at-accent);
	color: var(--at-accent);
}
.addr-head button:focus-visible {
	outline: 1px solid var(--at-gold, #eab627);
	outline-offset: 1px;
}
/* The list is unbounded — 170 candidates today, 110 this morning — so the
   panel never sizes to it. */
.addr-body {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior-y: contain;
	padding: 12px 14px;
}
</style>
