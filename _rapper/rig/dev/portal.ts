/**
 * PORTAL — move a node into `target`, follow it if the target changes, and put
 * nothing back on destroy (Svelte tears the node down itself).
 *
 * A no-op without a target, so every `use:portal` is inert until a host asks:
 * a standalone checkout that passes no host keeps its chrome where the
 * component drew it. This is the hand-off half of the EphemeralCard /
 * EphemeralDock pair — a page binds `host` on one of those and passes the
 * element into a child as a prop; the child's `use:portal={host}` carries its
 * node across, wiring, state and scoped styles intact.
 *
 * Lives in rapper/rig for the same reason the card does: it is the one tree
 * both tiers read, and every child reaches it as `$rig/…`. It used to be a private
 * function inside the offline map; the online map needed the same twelve
 * lines, and two copies of a seam is how seams drift.
 */
export function portal(node: HTMLElement, target?: HTMLElement) {
	if (target) target.appendChild(node);
	return {
		update(next?: HTMLElement) {
			if (next) next.appendChild(node);
		},
		destroy() {
			node.remove();
		},
	};
}
