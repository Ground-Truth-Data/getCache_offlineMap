<script lang="ts">
/**
 * PUTS ONE PAGE'S THING IN THE ONE TRAY.
 *
 * The tray is mounted once, in the root layout, so a page cannot pass content
 * up to it as a prop. It renders here instead and this moves the nodes into
 * the tray's content box — the same portal trick the maps already use for
 * their panels, so wiring, state and scoped styles survive the move.
 *
 * Renders nothing until the tray exists, which outside `vite dev` is never.
 */
import type { Snippet } from "svelte";
import { trayHost } from "./trayHost.svelte";

let { children }: { children?: Snippet } = $props();

let el = $state<HTMLElement>();

// Re-homes whenever the tray appears or is replaced; the cleanup takes the
// nodes back out so a page that navigates away leaves nothing behind.
$effect(() => {
	const host = trayHost.el;
	const node = el;
	if (!host || !node) return;
	host.appendChild(node);
	return () => node.remove();
});
</script>

<div bind:this={el} data-tray-item>{@render children?.()}</div>
