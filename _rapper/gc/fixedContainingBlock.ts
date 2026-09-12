/**
 * The ancestor a `position: fixed` descendant of `el` actually resolves
 * against, or null when that is the viewport.
 *
 * Any of transform / filter / backdrop-filter / perspective / contain /
 * will-change / a non-`none` `container-type` makes an element a containing
 * block for fixed descendants, even though it is not positioned. The phone rig
 * trips every one of these: `.mobile-preview-wrapper` carries a translate+scale
 * and `.mobile-preview-frame` carries `contain: layout` precisely so fixed
 * children land on the phone instead of the desktop page.
 *
 * So a caller anchoring a fixed overlay must subtract THIS element's rect.
 * Subtracting a hard-coded ancestor instead is a silent offset the moment
 * anything above it grows a transform.
 */
export function fixedContainingBlock(el: Element): HTMLElement | null {
	for (let p = el.parentElement; p; p = p.parentElement) {
		const s = getComputedStyle(p);
		if (
			(s.transform && s.transform !== "none") ||
			(s.filter && s.filter !== "none") ||
			(s.backdropFilter && s.backdropFilter !== "none") ||
			(s.perspective && s.perspective !== "none") ||
			(s.willChange && /transform|filter|perspective/.test(s.willChange)) ||
			(s.contain && /paint|layout|strict|content/.test(s.contain)) ||
			(s.containerType && s.containerType !== "normal")
		) {
			return p;
		}
	}
	return null;
}

/**
 * Convert a screen-pixel rect into the local CSS pixels an overlay's
 * `left`/`top` are written in.
 *
 * dt-web scales the whole phone by `--fit` (theme.css), so every
 * `getBoundingClientRect()` inside it answers in SCREEN px while the overlay
 * that consumes the number is laid out in the frame's own CSS px. Mixing the
 * two aims an overlay short of its target by exactly the scale factor, on any
 * window shorter than the phone — invisible at 1:1, which is why it survived.
 *
 * Three things every caller got wrong by hand and gets right here:
 *   • the scale `k` is DERIVED (rect.width / offsetWidth), never a constant;
 *   • the border comes from computed style, never a hardcoded number — the
 *     real frame has none, and a literal `12` copied from the animdemo page
 *     subtracted a border that does not exist;
 *   • the origin is the element fixed children ACTUALLY resolve against
 *     (`fixedContainingBlock`), not a hardcoded `.mobile-preview-frame`.
 *     Those differ: `.mobile-shell` sits inside the frame and carries
 *     `container-type: inline-size`, so it — not the frame — wins.
 *
 * `host` is any element inside the same rig (the overlay's anchor works).
 * Returns identity conversion on native, where there is no frame and no scale.
 */
export function localFrom(host: Element): {
	x: (screenX: number) => number;
	y: (screenY: number) => number;
	k: number;
	origin: HTMLElement | null;
	width: number;
	height: number;
} {
	const cb = fixedContainingBlock(host);
	if (!cb) {
		const w = typeof window === "undefined" ? 0 : window.innerWidth;
		const h = typeof window === "undefined" ? 0 : window.innerHeight;
		return { x: (v) => v, y: (v) => v, k: 1, origin: null, width: w, height: h };
	}
	const r = cb.getBoundingClientRect();
	const cs = getComputedStyle(cb);
	const bl = Number.parseFloat(cs.borderLeftWidth) || 0;
	const bt = Number.parseFloat(cs.borderTopWidth) || 0;
	// offsetWidth is pre-transform layout px; the rect is post-transform screen
	// px. Their ratio IS the live scale, whatever --fit resolves to today.
	const k = cb.offsetWidth > 0 ? r.width / cb.offsetWidth : 1;
	return {
		x: (screenX: number) => (screenX - r.left) / k - bl,
		y: (screenY: number) => (screenY - r.top) / k - bt,
		k,
		origin: cb,
		width: cb.clientWidth,
		height: cb.clientHeight,
	};
}
