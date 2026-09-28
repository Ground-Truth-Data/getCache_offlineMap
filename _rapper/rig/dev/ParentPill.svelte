<script lang="ts">
// Every fact arrives as a prop — this file names no tier, host or port. Dev only; both ports must be running.

let {
	leftLabel,
	rightLabel,
	current,
	href,
	unavailable = false,
}: {
	/** Fixed per deployment, never "me first". */
	leftLabel: string;
	rightLabel: string;
	/** Told, never sniffed from a port. */
	current: string;
	/** Omitted → no pill (no other tier). */
	href?: string;
	/** The other tier is running but does not serve this page: the pill stays, greyed. */
	unavailable?: boolean;
} = $props();

const other = $derived(current === leftLabel ? rightLabel : leftLabel);

// The map's camera lives in the hash via history.replaceState, untracked by any store, so
// it's read at the click. pointerdown covers middle-click; click covers keyboard Enter.
function carryHash(e: Event) {
	const a = e.currentTarget as HTMLAnchorElement;
	if (location.hash) a.hash = location.hash;
}
</script>

{#if unavailable}
	<span
		class="host-pill unavailable"
		title={`${other} is running, but it does not serve this page — nothing to switch to from here.`}
	>
		<span class:on={current === leftLabel}>{leftLabel}</span><span
			class:on={current === rightLabel}>{rightLabel}</span
		>
	</span>
{:else if href}
	<!-- Order is fixed on both parents: position carries no meaning; the lit half carries all of it. -->
	<a
		class="host-pill"
		{href}
		title={`Open this page under ${other} — a different server, with none of this one's layout or assets.`}
		onpointerdown={carryHash}
		onclick={carryHash}
	>
		<span class:on={current === leftLabel}>{leftLabel}</span><span
			class:on={current === rightLabel}>{rightLabel}</span
		>
	</a>
{/if}

<style>
	.host-pill {
		text-decoration: none;
		display: inline-flex;
		border: 1px solid #333;
		border-radius: 999px;
		overflow: hidden;
		background: #111;
		cursor: pointer;
		font: inherit;
		padding: 0;
		white-space: nowrap;
	}
	/* `default`, not `not-allowed`: nothing is forbidden, there is nowhere to go. */
	.host-pill.unavailable {
		cursor: default;
		opacity: 0.45;
		filter: grayscale(1);
	}
	.host-pill span {
		padding: 0.35rem 0.8rem;
		color: #888;
		font-size: 0.75rem;
	}
	.host-pill span.on {
		background: var(--color-gold-bar, #f5a119);
		color: #111;
		font-weight: 600;
	}
</style>
