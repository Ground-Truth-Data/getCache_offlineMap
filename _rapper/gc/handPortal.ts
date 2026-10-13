// Where every teaching / celebration hand lives: inside the phone frame on
// dt-web, so the bezel clips it and Z_HANDS layers it within the frame; <body>
// on a device. Resolved from the hand's target, since dt-web can mount several
// frames.

// On a landscape route the turned screen is the frame's inner surface, and it
// disagrees with the unturned frame about which way is right.
// .mobile-shell is zoomed to the pane; a hand outside it would keep its design size.
const HOMES = ".mobile-preview-screen, .mobile-preview-frame, .mobile-shell";

/** The box a hand should live in, from its target element. */
export function frameFor(
	target: Element | null | undefined,
): HTMLElement | null {
	const owned = target?.closest?.(HOMES) as HTMLElement | null;
	if (owned) return owned;
	// Nested homes are one frame: take the innermost. Several frames with no target is ambiguous: <body> rather than a guess.
	const inner = [...document.querySelectorAll<HTMLElement>(HOMES)].filter((h) => !h.querySelector(HOMES));
	return inner.length === 1 ? inner[0]! : null;
}

/** Svelte action: move `node` into the phone frame if one exists, else <body>. Read once at mount. */
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
