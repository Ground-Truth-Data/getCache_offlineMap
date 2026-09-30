<!--
  WHICH COLUMNS ARE ON SCREEN — the control that makes a full-width table
  usable.

  `columns` is now every scalar the model declares (32 on OrganizationTable,
  where the screen used to show six), so the question stopped being "what did
  someone type into the config" and became "what do you want to look at".

  The answer goes in the URL, not in storage: a chosen set of columns is a
  REPORT, and a report has to be a link somebody can send or bookmark. A bare
  URL shows every column; narrowing from there is what the params record.

  The Json columns sit in their own group and cannot be switched on: they are
  never fetched with the page. They are LISTED rather than omitted so the
  screen says the data exists and where to reach it — an absent name reads as
  an absent column.
-->
<script lang="ts">
import { cubicOut } from "svelte/easing";
import { fade } from "svelte/transition";
import { toggleColumn } from "./columnPrefs";

interface Props {
	columns: string[];
	jsonColumns?: string[];
	hidden: string[];
	onchange: (hidden: string[]) => void;
}

let { columns, jsonColumns = [], hidden, onchange }: Props = $props();

let open = $state(false);
const hiddenSet = $derived(new Set(hidden));
const shownCount = $derived(columns.filter((c) => !hiddenSet.has(c)).length);

function toggle(col: string) {
	// The last visible column cannot be switched off: the picker that would
	// bring one back is reached from the header it would empty.
	if (shownCount <= 1 && !hiddenSet.has(col)) return;
	onchange(toggleColumn(hidden, col));
}

const showAll = () => onchange([]);
/** Everything off but this one — the fastest way to start a narrow report. */
const only = (col: string) => onchange(columns.filter((c) => c !== col));

// A report is a LINK now, so the picker is where you take it away. Copies the
// address as it stands: this column choice, and the filters with it.
let copied = $state(false);
let copyTimer: ReturnType<typeof setTimeout>;
async function copyLink() {
	try {
		await navigator.clipboard.writeText(location.href);
		copied = true;
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 1600);
	} catch {
		// Convenience only — the address bar still holds the same URL.
	}
}

const still = () =>
	typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Hinges down from the trigger it is anchored to, so the panel reads as a lid opening off this button rather than a card appearing near it. Free here only because nothing under this panel is a `position: sticky` cell. */
const hinge = (_node: Element) => ({
	duration: still() ? 0 : 180,
	easing: cubicOut,
	css: (t: number, u: number) =>
		`opacity:${t};transform:perspective(700px) rotateX(${-14 * u}deg) translateY(${-4 * u}px)`,
});
</script>

<div class="colpick">
	<button
		type="button"
		class="colpick-btn"
		class:on={open}
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		Columns <span class="count">{shownCount}/{columns.length}</span>
	</button>

	{#if open}
		<!-- Click-outside closes it. A picker you must aim at a ✕ to dismiss
		     is one the reader leaves open over the rows they opened it to see. -->
		<div
			class="colpick-scrim"
			role="presentation"
			transition:fade={{ duration: still() ? 0 : 140 }}
			onclick={() => (open = false)}
		></div>
		<div class="colpick-menu" transition:hinge>
			<div class="colpick-head">
				<button type="button" onclick={showAll} disabled={hidden.length === 0}>
					Show all
				</button>
				<!-- The choice is in the address bar, so this is what turns a
				     view into something you can send. -->
				<button type="button" class="copy" onclick={copyLink}>
					{copied ? "Copied ✓" : "Copy link"}
				</button>
			</div>
			<ul>
				{#each columns as c (c)}
					<li>
						<label>
							<input
								type="checkbox"
								checked={!hiddenSet.has(c)}
								onchange={() => toggle(c)}
							/>
							<span class="mono">{c}</span>
						</label>
						<!-- Building a two-column report out of thirty-two by
						     unticking thirty of them is the tedious path nobody
						     takes twice. -->
						<button type="button" class="only" onclick={() => only(c)}>only</button>
					</li>
				{/each}
			</ul>

			{#if jsonColumns.length}
				<div class="colpick-json">
					<p class="colpick-note">
						Too large to list with the page — open one from its row.
					</p>
					<ul>
						{#each jsonColumns as c (c)}
							<li class="mono dim">{c}</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
.colpick {
	position: relative;
	display: inline-block;
}
.colpick-btn {
	border: 1px solid var(--admin-line, #3a3a3a);
	background: transparent;
	color: inherit;
	border-radius: 6px;
	padding: 0.28rem 0.6rem;
	font-size: 0.78rem;
	cursor: pointer;
	white-space: nowrap;
}
.colpick-btn.on,
.colpick-btn:hover {
	border-color: var(--palette-gold, #e0b050);
}
.colpick-btn:active {
	background: rgb(255 255 255 / 7%);
}
.colpick-btn:focus-visible,
.colpick-head button:focus-visible,
.colpick-menu label:focus-within {
	outline: 1px solid var(--at-gold, #eab627);
	outline-offset: 1px;
}
.count {
	opacity: 0.6;
	font-variant-numeric: tabular-nums;
	margin-left: 0.25rem;
}
/* Behind the menu, over everything else — so any click outside the menu
   lands here and closes it, without a document-level listener. */
.colpick-scrim {
	position: fixed;
	inset: 0;
	z-index: 40;
}
.colpick-menu {
	position: absolute;
	z-index: 41;
	top: calc(100% + 4px);
	right: 0;
	min-width: 15rem;
	max-height: 60vh;
	overflow-y: auto;
	border: 1px solid var(--admin-line, #3a3a3a);
	border-radius: 8px;
	background: var(--admin-panel-bg, #16161a);
	box-shadow:
		var(--at-lift-3, 0 24px 48px -12px rgb(0 0 0 / 80%)),
		var(--at-edge-hi, inset 0 1px 0 rgb(255 255 255 / 6%));
	padding: 0.4rem;
	/* The hinge line — the edge the panel is anchored by, so it swings from the trigger and not from its own middle. */
	transform-origin: top right;
}
.colpick-head {
	display: flex;
	gap: 0.3rem;
	padding: 0 0.2rem 0.4rem;
	border-bottom: 1px solid var(--admin-line, #3a3a3a);
	margin-bottom: 0.3rem;
}
.colpick-head button {
	flex: 1;
	border: 1px solid var(--admin-line, #3a3a3a);
	background: transparent;
	color: inherit;
	border-radius: 5px;
	padding: 0.2rem 0;
	font-size: 0.72rem;
	cursor: pointer;
}
.colpick-head button:hover {
	border-color: var(--palette-gold, #e0b050);
}
.colpick-head button:disabled {
	opacity: 0.35;
	cursor: default;
}
.colpick-head .copy {
	border-color: color-mix(in srgb, var(--palette-gold, #e0b050), transparent 55%);
}
.colpick-menu ul {
	list-style: none;
	margin: 0;
	padding: 0;
}
.colpick-menu li {
	display: flex;
	align-items: center;
	border-radius: 4px;
}
.colpick-menu li:hover {
	background: rgb(255 255 255 / 5%);
}
.colpick-menu label {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	padding: 0.2rem 0.25rem;
	border-radius: 4px;
	cursor: pointer;
	font-size: 0.76rem;
	flex: 1;
	min-width: 0;
}
/* Hidden until the row is hovered: thirty "only" buttons down the side is a
   wall of controls, and the one that matters is the row under the pointer. */
.only {
	opacity: 0;
	border: 0;
	background: none;
	color: var(--palette-gold, #e0b050);
	font-size: 0.66rem;
	padding: 0 0.4rem;
	cursor: pointer;
}
.colpick-menu li:hover .only,
.only:focus-visible {
	opacity: 1;
}
.mono {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.colpick-json {
	margin-top: 0.4rem;
	padding-top: 0.35rem;
	border-top: 1px solid var(--admin-line, #3a3a3a);
}
.colpick-note {
	margin: 0 0.25rem 0.25rem;
	font-size: 0.68rem;
	opacity: 0.55;
	line-height: 1.35;
}
.dim {
	padding: 0.15rem 0.25rem;
	font-size: 0.74rem;
	opacity: 0.45;
}
</style>
