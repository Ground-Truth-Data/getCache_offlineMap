/**
 * THE ONE TRAY'S CONTENT BOX, published so a page can put its own panels in it.
 *
 * The tray is mounted once, in the root layout — so a page that wants to add
 * something to it cannot pass a prop upward. It reads the element from here
 * instead. Set by <EphemeralTray> on mount, cleared on destroy.
 *
 * Dev-only by construction: the tray never mounts outside `vite dev`, so this
 * stays undefined in a build and every reader's `{#if}` is simply false.
 */
export const trayHost = $state<{ el: HTMLElement | undefined }>({
	el: undefined,
});
