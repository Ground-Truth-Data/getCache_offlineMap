// An in-progress shape paints into the map CANVAS, so no stacking order can put
// a DOM card behind it — fading (not hiding) lets the work show through while
// keeping the card's scroll position and any half-typed edit.

/** Low enough to read a polygon edge through, high enough not to read as dismissed. */
export const YIELD_OPACITY = 0.22;

export type YieldStyle = {
	opacity: number;
	/** "" leaves the property alone — the shell's tap-outside pass-through drives it directly. */
	pointerEvents: "none" | "";
	/** The two as one inline declaration, or "" when not yielding. */
	css: string;
};

export function yieldStyle(drawLive: boolean): YieldStyle {
	if (!drawLive) return { opacity: 1, pointerEvents: "", css: "" };
	return {
		opacity: YIELD_OPACITY,
		pointerEvents: "none",
		css: `opacity:${YIELD_OPACITY};pointer-events:none`,
	};
}
