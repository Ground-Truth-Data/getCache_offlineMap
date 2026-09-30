<!--
  ONE ROW'S JSON, fetched when it is opened — the only path to a Json column
  (never part of the page read, see `jsonColumns` in retreeverTables.ts),
  which is what makes leaving it out a saving rather than a loss. A dialog,
  not an expanding row: opening a row would push every other row down, and a
  geometry is thousands of lines.
-->
<script lang="ts">
import { cubicOut } from "svelte/easing";
import { fade } from "svelte/transition";

interface Props {
	/** Where the peek endpoint lives for this mount — `${pathname}/json`. */
	endpoint: string;
	/** `text` present = an ordinary truncated column already in hand, nothing fetched; absent = a Json column, read from the endpoint now. */
	open: { col: string; pk: string; text?: string } | null;
	onclose: () => void;
}

let { endpoint, open, onclose }: Props = $props();

type Peek = { text: string; bytes: number; tooBig: boolean };
let peekState = $state<
	{ status: "loading" } | { status: "ok"; peek: Peek } | { status: "err"; message: string }
>({ status: "loading" });

let closeEl = $state<HTMLButtonElement | null>(null);
let boxEl = $state<HTMLDivElement | null>(null);
let opener: Element | null = null;

$effect(() => {
	if (!open) return;
	opener = document.activeElement;
	closeEl?.focus();
	return () => {
		if (opener instanceof HTMLElement) opener.focus();
	};
});

/** `aria-modal` PROMISES the rest of the page is unreachable; without this, Tab walks out into the grid behind and the promise is a lie. */
function trapTab(e: KeyboardEvent) {
	if (e.key !== "Tab" || !boxEl) return;
	const stops = [
		...boxEl.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='0']"),
	];
	if (!stops.length) return;
	const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
	if (document.activeElement === edge || !boxEl.contains(document.activeElement)) {
		e.preventDefault();
		(e.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
	}
}

const still = () =>
	typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The biggest change of context in the admin kit, so it ARRIVES in Z rather than simply existing — the grid is what it came forward from. */
const arrive = (_node: Element) => ({
	duration: still() ? 0 : 200,
	easing: cubicOut,
	css: (t: number, u: number) =>
		`opacity:${t};transform:perspective(1200px) translate3d(0,${8 * u}px,${-70 * u}px)`,
});

$effect(() => {
	if (!open) return;
	const { col, pk, text } = open;
	// Already in hand — must not flash "Reading…" for a value that never left the page.
	if (text !== undefined) {
		peekState = {
			status: "ok",
			peek: { text, bytes: new Blob([text]).size, tooBig: false },
		};
		return;
	}
	// Guards a response arriving after the dialog moved to another cell, or two quick clicks let the FIRST row's value paint over the second's.
	let live = true;
	peekState = { status: "loading" };
	const url = `${endpoint}?col=${encodeURIComponent(col)}&pk=${encodeURIComponent(pk)}`;
	fetch(url)
		.then(async (r) => {
			if (!r.ok) throw new Error(await r.text());
			return r.json() as Promise<Peek>;
		})
		.then((peek: Peek) => {
			if (live) peekState = { status: "ok", peek };
		})
		.catch((e: unknown) => {
			if (live)
				peekState = {
					status: "err",
					message: e instanceof Error ? e.message : String(e),
				};
		});
	return () => {
		live = false;
	};
});

const kb = (n: number) =>
	n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 102400 ? 1 : 0)} KB`;

let copied = $state(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
	if (peekState.status !== "ok") return;
	try {
		await navigator.clipboard.writeText(peekState.peek.text);
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1600);
	} catch {
		// Convenience only — the value is on screen and selectable.
	}
}
</script>

{#if open}
	<div
		class="jp-scrim"
		role="presentation"
		transition:fade={{ duration: still() ? 0 : 160 }}
		onclick={(e) => {
			if (e.target === e.currentTarget) onclose();
		}}
	>
		<div
			bind:this={boxEl}
			class="jp-box"
			role="dialog"
			aria-modal="true"
			aria-label="{open.col} value"
			transition:arrive
			onkeydown={trapTab}
		>
			<header>
				<div class="jp-id">
					<span class="mono strong">{open.col}</span>
					<span class="mono dim">{open.pk}</span>
				</div>
				<button bind:this={closeEl} type="button" onclick={onclose} aria-label="Close">✕</button>
			</header>

			{#if peekState.status === "loading"}
				<p class="jp-msg">Reading…</p>
			{:else if peekState.status === "err"}
				<p class="jp-msg err">{peekState.message}</p>
			{:else if peekState.peek.tooBig}
				<p class="jp-msg err">
					{kb(peekState.peek.bytes)} — too large to show. Query it directly.
				</p>
			{:else if peekState.peek.text === ""}
				<p class="jp-msg dim">Empty.</p>
			{:else}
				<!-- Focusable because it SCROLLS: thousands of lines a keyboard user could otherwise never reach. -->
				<pre tabindex="0">{peekState.peek.text}</pre>
			{/if}

			<!-- COPY LEADS: reading is why the dialog opens, copying is next — so the control sits where the eye already rests, not the far side of the footer. -->
			<footer>
				<button
					type="button"
					class="jp-copy"
					onclick={copy}
					disabled={peekState.status !== "ok"}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<rect x="9" y="9" width="12" height="12" rx="2" />
						<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
					</svg>
					{copied ? "Copied ✓" : "Copy"}
				</button>
				<span class="dim mono">
					{peekState.status === "ok" ? kb(peekState.peek.bytes) : ""}
				</span>
			</footer>
		</div>
	</div>
{/if}

<svelte:window
	onkeydown={(e) => {
		if (open && e.key === "Escape") onclose();
	}}
/>

<style>
.jp-scrim {
	position: fixed;
	inset: 0;
	z-index: 60;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1.5rem;
	/* Part of the depth, not a separate effect: the dialog is above the grid, so the grid has to recede for it. */
	background: rgb(0 0 0 / 62%);
}
.jp-box {
	display: flex;
	flex-direction: column;
	width: 100%;
	max-width: 48rem;
	max-height: 100%;
	overflow: hidden;
	border: 1px solid var(--admin-line, #3a3a3a);
	border-radius: 10px;
	background: var(--admin-panel-bg, #16161a);
	box-shadow:
		var(--at-lift-3, 0 24px 48px -12px rgb(0 0 0 / 80%)),
		var(--at-edge-hi, inset 0 1px 0 rgb(255 255 255 / 6%));
	transform-origin: center;
}
header,
footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.6rem 0.8rem;
}
header {
	border-bottom: 1px solid var(--admin-line, #3a3a3a);
}
footer {
	border-top: 1px solid var(--admin-line, #3a3a3a);
}
.jp-id {
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
	min-width: 0;
}
.jp-id span {
	overflow-wrap: anywhere;
}
/* Gold = commit colour. Was the same grey as the byte count beside it — one is a button and nothing said which. */
.jp-copy {
	color: var(--at-gold, #eab627);
	font-weight: 700;
	gap: 0.4rem;
}
.jp-copy svg {
	width: 13px;
	height: 13px;
	flex: none;
}
.jp-copy:hover:not(:disabled) {
	background: rgb(234 182 39 / 10%);
}
button {
	display: inline-flex;
	align-items: center;
	border: 1px solid var(--admin-line, #3a3a3a);
	background: transparent;
	color: inherit;
	border-radius: 5px;
	padding: 0.2rem 0.6rem;
	font-size: 0.75rem;
	cursor: pointer;
}
button:hover:not(:disabled) {
	border-color: var(--palette-gold, #e0b050);
}
button:active:not(:disabled) {
	background: rgb(255 255 255 / 7%);
}
button:disabled {
	opacity: 0.4;
	cursor: default;
}
button:focus-visible,
pre:focus-visible {
	outline: 1px solid var(--at-gold, #eab627);
	outline-offset: 1px;
}
pre {
	flex: 1;
	overflow: auto;
	margin: 0;
	padding: 0.8rem;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 0.72rem;
	line-height: 1.5;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	background: var(--admin-bg, #101013);
}
.jp-msg {
	margin: 0;
	padding: 1.5rem 0.8rem;
	text-align: center;
	font-size: 0.8rem;
}
.mono {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 0.75rem;
}
.strong {
	font-weight: 600;
}
.dim {
	opacity: 0.55;
}
.err {
	color: var(--palette-terracotta, #b36940);
}
</style>
