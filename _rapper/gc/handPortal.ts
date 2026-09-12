// ════════════════════════════════════════════════════════════════════════════
// handPortal — where every teaching / celebration hand LIVES in the DOM.
//
// THE RULE: a hand must render INSIDE the phone frame on dt-web, so the frame's
// `overflow: hidden` clips it to the bezel — the forearm can't poke out the
// right edge into the desktop backdrop, and the celebration arm enters from the
// frame's own bottom edge, not from off in the browser window. Inside the frame
// its `contain: layout` is the containing block, so a position:absolute hand's
// coords still resolve correctly, and it inherits the frame's stacking context.
//
// The old home was <body>: unclipped (hand escaped the frame) and in the root
// stacking context (celebration arm buried under the z:50 footer). Portalling
// into the frame fixes BOTH — clipping AND layering — with Z_HANDS keeping the
// hand above the footer WITHIN the frame.
//
// mob-web / native have no frame → fall back to <body> (the whole viewport IS
// the phone, so nothing to clip against and no desktop backdrop to leak onto).
//
// Frame resolution is TARGET-AWARE: dt-web can mount more than one
// .mobile-preview-frame (previews), so we portal into the frame that actually
// contains the hand's target, not the first one in the document. Pass the target
// element (or any node inside the intended frame); omit it to fall back to the
// first frame, then <body>.
// ════════════════════════════════════════════════════════════════════════════

/** Resolve the phone frame a hand should live in, from its target element. */
export function frameFor(
	target: Element | null | undefined,
): HTMLElement | null {
	const owned = target?.closest?.(
		".mobile-preview-frame",
	) as HTMLElement | null;
	if (owned) return owned;
	// No target (or target not under a frame yet): use the sole frame if there's
	// exactly one — ambiguous with several, so bail to <body> rather than guess.
	const all = document.querySelectorAll<HTMLElement>(".mobile-preview-frame");
	return all.length === 1 ? all[0] : null;
}

/**
 * Svelte `use:` action — move `node` into the phone frame (clipped to the bezel,
 * above the footer via Z_HANDS) if one exists, else <body>. `getTarget` lets the
 * action pick the RIGHT frame from the hand's live target; it's read once at mount
 * (the hand layer is a stable wrapper — its home doesn't change mid-life).
 */
export function handPortal(
	node: HTMLElement,
	getTarget?: () => Element | null | undefined,
) {
	const home = frameFor(getTarget?.()) ?? document.body;
	home.appendChild(node);
	return {
		destroy() {
			node.remove();
		},
	};
}
