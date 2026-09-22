// A popover yields while the human is laying geometry: an in-progress shape is
// painted into the map CANVAS, so no stacking order can put a DOM card behind
// it. Fading is the only way to see the work through the card, and dropping
// pointer-events is what lets the next vertex land where it was aimed.
//
// Fade rather than hide: the card keeps its scroll position and any half-typed
// edit, and Share/✕ are back the instant the tool is put down.

/** Low enough to read a polygon edge through, high enough to keep the card's
 *  place on screen so it does not read as having been dismissed. */
export const YIELD_OPACITY = 0.22;

export type YieldStyle = {
	opacity: number;
	/** "" leaves the property alone — the shell's tap-outside pass-through
	 *  drives it directly, and writing "auto" here would overwrite that. */
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
