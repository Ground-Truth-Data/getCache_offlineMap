/** Ancestor a `position: fixed` descendant of `el` resolves against, or null for the viewport. */
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

// Holds turn and scale separately; a rect/offsetWidth ratio reads aspect ratio once rotated.
// DOMMatrix is unavailable under jsdom and SSR, hence the rect fallback below.
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

/** Converts screen px into local CSS px (dt-web scales the phone by `--fit`); identity on native. */
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

	// `x`/`y` are independent scalars and cannot express a turn; use `point` on landscape routes.
	const inv = accumulated(cb)?.inverse();
	const point = (screenX: number, screenY: number) => {
		if (!inv || !Number.isFinite(inv.a)) {
			return { x: (screenX - r.left) / k - bl, y: (screenY - r.top) / k - bt };
		}
		// The rect's corner only coincides with the untransformed origin when upright.
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
