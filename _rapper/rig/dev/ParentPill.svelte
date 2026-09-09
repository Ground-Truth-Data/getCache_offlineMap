<script lang="ts">
/**
 * ParentPill — THE ONE FILE. Both parents render THIS, not a copy of it.
 *
 * WHY IT LIVES IN fetch/tools/ AND NOT IN EITHER REPO
 * There were two copies — ReTreever/src/lib/core/map/HostPill.svelte and one
 * inside the child — and they drifted immediately: different padding
 * (0.35/0.8 vs 0.25/0.7), different font-size (0.75 vs 0.8rem), and for a
 * while the halves rendered in opposite orders. Every fix had to be made
 * twice, and "make them the same" kept meaning "copy the newer one again".
 *
 * A copy cannot be kept identical by discipline. So there is now exactly one
 * file, and it sits ABOVE both repos in tools/ — neutral ground owned by
 * neither parent, which is the only place a shared dev control can live
 * without one parent importing the other.
 *
 * HOW EACH PARENT REACHES IT
 * Both define the same alias, `$parent`, in their svelte.config.js:
 *
 *     both parents:  $parent: "."   (then a real path)
 *     a child writes: $rig/dev/ParentPill.svelte
 *
 * An alias, not a relative path, for the usual reason: a raw `../../tools/...`
 * climb out of a child is what noEscapePlugin throws on, and an alias is one
 * declared line somebody can review and repoint.
 *
 * IT KNOWS NOTHING AND IS TOLD EVERYTHING
 * Every fact about the two tiers arrives as a prop. This file names no tier,
 * no host and no port — so it is equally correct under either parent, and a
 * child that carries it into its own repo ships no fact about whose it was.
 *
 * WHY IT NAVIGATES, AND WHY IT USED TO LIE
 * It used to flip a boolean: withhold two props and override a few CSS
 * variables, then call that "you are now on the other tier". It could never be
 * true. WHICH PARENT SERVES A PAGE IS DECIDED BY THE SERVER THAT ANSWERED,
 * before any JavaScript exists — the layout is already chosen, the imports
 * already baked, the HTML already sent. A button cannot un-answer a request.
 * Hours were lost to that illusion on 25 Aug 2026: the page looked identical
 * either way, which read as "the split is fake" when the truth was "the switch
 * is fake". Two parents means TWO SERVERS, so this points at the other one and
 * the browser goes there.
 *
 * DEV ONLY. Both ports must be running — see gitEr/CLI.sh run_dev_start.
 */

let {
	leftLabel,
	rightLabel,
	current,
	href,
	unavailable = false,
}: {
	/** The tier shown on the left. FIXED per deployment, never "me first". */
	leftLabel: string;
	/** The tier shown on the right. */
	rightLabel: string;
	/** Which of the two is serving this page — must equal one of the labels.
	 *  Told, never sniffed: a port number is a fact about how this machine
	 *  happens to run two servers today. */
	current: string;
	/** Where the OTHER tier serves this same page. Omitted → no pill, which is
	 *  the honest answer when there is no other tier to switch to. */
	href?: string;
	/**
	 * The other tier is RUNNING but does not serve this page.
	 *
	 * Distinct from `href` being absent, and the distinction is the whole
	 * point. No href at all = "there is no other tier" (a child cloned alone),
	 * and the control vanishes. Unavailable = "the other tier is right there,
	 * but this page is not on it" — so the pill STAYS, greyed and inert.
	 *
	 * Hiding it in that case would answer a different question than the one
	 * asked: you would not be able to tell "no other tier" from "not this
	 * page", which are the two things this control exists to distinguish.
	 */
	unavailable?: boolean;
} = $props();

const other = $derived(current === leftLabel ? rightLabel : leftLabel);

/**
 * The URL fragment rides across AS OF THE CLICK. The map keeps its camera in
 * the hash (#zoom/lat/lng), written via history.replaceState, which no store
 * tracks — a derived href could only ever carry a stale one. So it is
 * resolved on the live location just before the navigation the anchor itself
 * performs. pointerdown covers mouse/touch (middle-click included); click
 * covers keyboard Enter.
 */
function carryHash(e: Event) {
	const a = e.currentTarget as HTMLAnchorElement;
	if (location.hash) a.hash = location.hash;
}
</script>

{#if unavailable}
	<!-- INERT, NOT ABSENT. A <span>, so there is no href to follow, nothing to
	     middle-click, and no focus stop — a link that goes nowhere is worse
	     than no link, because it looks identical to one that works right up
	     until you click it. The lit half still shows which tier you are on, so
	     the control keeps doing the half of its job that is still true. -->
	<span
		class="host-pill unavailable"
		title={`${other} is running, but it does not serve this page — nothing to switch to from here.`}
	>
		<span class:on={current === leftLabel}>{leftLabel}</span><span
			class:on={current === rightLabel}>{rightLabel}</span
		>
	</span>
{:else if href}
	<!-- An <a>, not a <button>: this is a real navigation to a real other
	     server, so it should behave like a link (middle-click, cmd-click,
	     right-click all work). A button that navigates is a link in a costume.

	     ORDER IS FIXED — the labels render left/right exactly as given, on both
	     parents. Do not "improve" this to put the current tier first: that is
	     what the two copies did, so the halves swapped sides between servers,
	     the control moved under the cursor, and reading it became a comparison
	     instead of a glance. Position carries no meaning; the lit half carries
	     all of it, and that only works if position holds still. -->
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
	/* The ONLY copy of these values. Both parents render this file, so there is
	   nothing to keep in step. Positioning is deliberately NOT here — this is
	   an inline-flex pill and each parent's menu bar places it. */
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
	/* GREYED AND INERT. Dimmed as a whole rather than restyling the halves, so
	   the lit/unlit relationship still reads — it is the same control, just not
	   offering anything. `default` cursor, not `not-allowed`: nothing is
	   forbidden here, there is simply nowhere to go. */
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
