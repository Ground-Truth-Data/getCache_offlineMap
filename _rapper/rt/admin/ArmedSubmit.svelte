<!--
  TIER 1 of two confirmation vocabularies: a submit that fires on the SECOND
  click, for writes the same screen can reverse — Promote/Demote, Unlink
  (re-link it), Reject (link the pair by hand). A write that destroys a row
  takes `ConfirmSubmit` instead, which names what dies.

  First click arms it and changes the label to a question; arming times out and
  the timer clears on unmount so a leaving row can't flip a different one.
-->
<script lang="ts">
type Props = {
	label: string;
	armedLabel?: string;
	title?: string;
	class?: string;
};
let {
	label,
	armedLabel = "Sure? Click again",
	title,
	class: cls = "admin-btn danger",
}: Props = $props();

let armed = $state(false);
let timer: ReturnType<typeof setTimeout> | null = null;

function disarm() {
	if (timer) clearTimeout(timer);
	timer = null;
	armed = false;
}

function onclick(e: MouseEvent) {
	if (armed) {
		disarm();
		return;
	}
	// FIRST click must not reach the form, or the confirm is decoration over an action that already fired.
	e.preventDefault();
	armed = true;
	timer = setTimeout(disarm, 2500);
}

$effect(() => () => {
	if (timer) clearTimeout(timer);
});
</script>

<button type="submit" class={cls} class:armed {title} {onclick}>
	{armed ? armedLabel : label}
</button>

<style>
/* `.admin-btn.armed` in adminTable.css only dresses the BUTTON variant. The
   bare-text sites (Unlink, Reject) must read as armed without inflating into a
   button, so the armed state is weight and a rule, never a box. */
button:not(.admin-btn).armed {
	text-decoration: underline;
	text-decoration-thickness: 2px;
	text-underline-offset: 3px;
}
</style>
