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
 * How many screen px one of `el`'s own CSS px is worth.
 *
 * The obvious form — `rect.width / offsetWidth` — assumes the element's width
 * still points along the screen's x-axis. On a landscape route it does not:
 * `.mobile-preview-screen` is turned -90°, so its rect's WIDTH reports its
 * offsetHEIGHT and the ratio comes back as the aspect ratio (~2.07) instead of
 * the scale. Everything sized by it then came out about twice too big — the
 * "huge and massive" share quad.
 *
 * The accumulated matrix is the honest answer, since it holds the turn and the
 * scale separately. Column length hypot(a, b) is the x-axis scale for any
 * rotate+scale, which is all the rig applies. `DOMMatrix` is unavailable under
 * jsdom and in SSR, so the rect ratio stays as the fallback — it is correct
 * whenever nothing is rotated, which is every portrait route.
 */
function accumulated(el: HTMLElement): DOMMatrixReadOnly | null {
	if (typeof DOMMatrixReadOnly !== "function") return null;
	let m = new DOMMatrixReadOnly();
	for (let p: HTMLElement | null = el; p; p = p.parentElement) {
		const t = getComputedStyle(p).transform;
		if (t && t !== "none") m = new DOMMatrixReadOnly(t).multiply(m);
	}
	return m;
}

function scaleOf(el: HTMLElement, r: DOMRect): number {
	const m = accumulated(el);
	if (m) {
		const k = Math.hypot(m.a, m.b);
		if (k > 0) return k;
	}
	return el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
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
	point: (screenX: number, screenY: number) => { x: number; y: number };
	k: number;
	origin: HTMLElement | null;
	width: number;
	height: number;
} {
	const cb = fixedContainingBlock(host);
	if (!cb) {
		const w = typeof window === "undefined" ? 0 : window.innerWidth;
		const h = typeof window === "undefined" ? 0 : window.innerHeight;
		return {
			x: (v) => v,
			y: (v) => v,
			point: (x, y) => ({ x, y }),
			k: 1,
			origin: null,
			width: w,
			height: h,
		};
	}
	const r = cb.getBoundingClientRect();
	const cs = getComputedStyle(cb);
	const bl = Number.parseFloat(cs.borderLeftWidth) || 0;
	const bt = Number.parseFloat(cs.borderTopWidth) || 0;
	const k = scaleOf(cb, r);

	/**
	 * A POINT, NOT TWO AXES. `x` and `y` above are scalar and independent, so
	 * between them they can express a scale and an offset but never a TURN —
	 * on a landscape route the page's "right" is the screen's "down" and each
	 * of them silently answers about the wrong axis. Inverting the accumulated
	 * matrix is the general conversion: it is identical to x/y when nothing is
	 * rotated, so a caller that needs to be right in both rigs uses this.
	 */
	const inv = accumulated(cb)?.inverse();
	const point = (screenX: number, screenY: number) => {
		if (!inv || !Number.isFinite(inv.a)) {
			return { x: (screenX - r.left) / k - bl, y: (screenY - r.top) / k - bt };
		}
		// The matrix maps the element's own box; its origin is the untransformed
		// top-left, which the rect's corner only coincides with when upright.
		const o = inv.transformPoint(new DOMPoint(r.left, r.top));
		const p = inv.transformPoint(new DOMPoint(screenX, screenY));
		return { x: p.x - o.x - bl, y: p.y - o.y - bt };
	};

	return {
		x: (screenX: number) => (screenX - r.left) / k - bl,
		y: (screenY: number) => (screenY - r.top) / k - bt,
		point,
		k,
		origin: cb,
		width: cb.clientWidth,
		height: cb.clientHeight,
	};
}
