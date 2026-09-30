<!--
  TIER 2 of two confirmation vocabularies: for a write that destroys a row.
  `ArmedSubmit` handles everything the same screen can reverse; a second click
  in the same place cannot serve here, because it stops a mis-aimed click and
  nothing else — it never says WHICH row it is about to destroy.

  A popover, not a modal: the page is not blanked and the row behind the
  question stays readable, which is the whole point of naming the target.

  The trigger is `type="button"`, so the first click is not a submit at all —
  the strongest form of "the first click must not reach the form". The confirm
  IS the form's submit, which is why this component must be rendered inside it.
-->
<script lang="ts">
import { cubicOut } from "svelte/easing";
import { fade } from "svelte/transition";

type Props = {
	/** The trigger's text, at rest. */
	label: string;
	/** What dies, named — a row identifier a person recognises, not a key. */
	target: string;
	/** Names the action, on the trigger's twin inside the popover. */
	verb?: string;
	/** One line on what cannot be got back. */
	note?: string;
	title?: string;
	class?: string;
};
let {
	label,
	target,
	verb = "Delete",
	note,
	title,
	class: cls = "admin-link-danger",
}: Props = $props();

let shown = $state(false);
let at = $state({ top: 0, left: 0, flipped: false });
let triggerEl = $state<HTMLButtonElement | null>(null);
let cancelEl = $state<HTMLButtonElement | null>(null);
let popEl = $state<HTMLDivElement | null>(null);

const W = 260;
const GAP = 6;
/** Tall enough for the question at two lines — a guess is fine, it only decides which side it opens on. */
const H = 132;

function place() {
	const r = triggerEl?.getBoundingClientRect();
	if (!r) return;
	const below = r.bottom + GAP;
	const flipped = below + H > innerHeight && r.top - GAP - H > 0;
	at = {
		top: flipped ? r.top - GAP - H : below,
		left: Math.min(Math.max(8, r.right - W), innerWidth - W - 8),
		flipped,
	};
}

function open() {
	place();
	shown = true;
}

function close() {
	shown = false;
	triggerEl?.focus();
}

$effect(() => {
	if (shown) cancelEl?.focus();
});

/** `aria-modal` PROMISES the rest of the page is unreachable; without this, Tab walks out into the row behind and the promise is a lie. */
function trapTab(e: KeyboardEvent) {
	if (e.key !== "Tab" || !popEl) return;
	const stops = [...popEl.querySelectorAll<HTMLElement>("button:not([disabled])")];
	if (!stops.length) return;
	const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
	if (document.activeElement === edge || !popEl.contains(document.activeElement)) {
		e.preventDefault();
		(e.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
	}
}

const still = () =>
	typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The admin kit's dropdown arrival, hinged off the control that opened it rather than appearing beside it. */
const hinge = (_node: Element) => ({
	duration: still() ? 0 : 180,
	easing: cubicOut,
	css: (t: number, u: number) =>
		`opacity:${t};transform:perspective(700px) rotateX(${-14 * u}deg) translateY(${-4 * u}px)`,
});
</script>

<button
	bind:this={triggerEl}
	type="button"
	class={cls}
	{title}
	aria-haspopup="dialog"
	aria-expanded={shown}
	onclick={open}>{label}</button
>

{#if shown}
	<!-- Transparent, not dimmed: the row being named is the evidence, so it must stay legible. -->
	<div
		class="cs-catch"
		role="presentation"
		transition:fade={{ duration: still() ? 0 : 120 }}
		onclick={close}
	></div>
	<div
		bind:this={popEl}
		class="cs-pop"
		class:cs-up={at.flipped}
		role="dialog"
		aria-modal="true"
		aria-label="{verb} {target}"
		style="top:{at.top}px; left:{at.left}px"
		transition:hinge
		onkeydown={trapTab}
	>
		<p class="cs-q">{verb} <strong>{target}</strong>?</p>
		{#if note}<p class="cs-note">{note}</p>{/if}
		<!-- CANCEL FIRST, and it takes focus: Enter on an unread popover must not finish the destroy. -->
		<div class="cs-acts">
			<button bind:this={cancelEl} type="button" class="cs-no" onclick={close}>Cancel</button>
			<button type="submit" class="cs-go" onclick={() => (shown = false)}>{verb}</button>
		</div>
	</div>
{/if}

<svelte:window
	onkeydown={(e) => {
		if (shown && e.key === "Escape") close();
	}}
	onresize={() => shown && place()}
	onscrollcapture={() => shown && place()}
/>

<style>
.cs-catch {
	position: fixed;
	inset: 0;
	z-index: 40;
}
.cs-pop {
	position: fixed;
	z-index: 41;
	width: 260px;
	border: 1px solid var(--at-line-strong, rgba(255, 255, 255, 0.16));
	border-radius: var(--at-radius-sm, 8px);
	background: var(--admin-panel-bg, #16161a);
	box-shadow:
		var(--at-lift-3, 0 24px 48px -12px rgb(0 0 0 / 80%)),
		var(--at-edge-hi, inset 0 1px 0 rgb(255 255 255 / 6%));
	padding: 0.7rem 0.75rem 0.6rem;
	/* The hinge line — the edge it swings from, so it reads as opening off the control and not arriving near it. */
	transform-origin: top right;
	text-align: left;
}
.cs-pop.cs-up {
	transform-origin: bottom right;
}
.cs-q {
	margin: 0;
	font-size: 13px;
	line-height: 1.35;
	color: var(--at-fg, #f2f2f2);
}
.cs-q strong {
	font-weight: 700;
	overflow-wrap: anywhere;
}
.cs-note {
	margin: 0.35rem 0 0;
	font-size: 11.5px;
	line-height: 1.3;
	color: var(--at-muted, #8f8a76);
}
.cs-acts {
	display: flex;
	justify-content: flex-end;
	gap: 0.4rem;
	margin-top: 0.7rem;
}
.cs-acts button {
	border: 1px solid var(--at-line-strong, rgba(255, 255, 255, 0.16));
	border-radius: 5px;
	padding: 0.22rem 0.6rem;
	background: transparent;
	color: inherit;
	font: inherit;
	font-size: 12px;
	font-weight: 700;
	cursor: pointer;
}
.cs-no:hover {
	border-color: var(--at-line-strong, rgba(255, 255, 255, 0.16));
	background: rgb(255 255 255 / 7%);
}
/* The one filled control on the surface, because it is the one that acts. */
.cs-go {
	border-color: var(--at-danger, #d4574a);
	background: rgba(212, 87, 74, 0.18);
	color: var(--at-fg, #f2f2f2);
}
.cs-go:hover {
	background: rgba(212, 87, 74, 0.32);
}
.cs-acts button:focus-visible {
	outline: 1px solid var(--at-gold, #eab627);
	outline-offset: 1px;
}
</style>
