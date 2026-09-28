// Where every teaching / celebration hand lives: inside the phone frame on
// dt-web, so the bezel clips it and Z_HANDS layers it within the frame; <body>
// on a device. Resolved from the hand's target, since dt-web can mount several
// frames.

// On a landscape route the turned screen is the frame's inner surface, and it
// disagrees with the unturned frame about which way is right.
const HOMES = ".mobile-preview-screen, .mobile-preview-frame";

/** The box a hand should live in, from its target element. */
export function frameFor(
	target: Element | null | undefined,
): HTMLElement | null {
	const owned = target?.closest?.(HOMES) as HTMLElement | null;
	if (owned) return owned;
	// Several frames with no target is ambiguous: bail to <body> rather than guess.
	const all = document.querySelectorAll<HTMLElement>(HOMES);
	return all.length === 1 ? all[0] : null;
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
