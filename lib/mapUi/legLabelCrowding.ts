// WHICH LEG LABELS SURVIVE WHEN THEY CROWD.
//
// A triangle zoomed out puts its three "16.9 km" labels on top of each other:
// unreadable, and worse than nothing, because overlapping digits read as a
// different number. They HIDE rather than cluster — a cluster badge would have
// to say something ("3 legs"), and no such number is worth the pixels when the
// total already sits above the shape.
//
// ALL-OR-NOTHING per crowded pair, deliberately: dropping only the second of
// two labels leaves one leg captioned and its neighbour bare, which reads as
// "this leg is special". A measurement that cannot show every leg shows none.

/** A label's placed screen position, in CSS px. */
export type LabelPoint = { x: number; y: number };

/** Centre-to-centre px below which two labels are judged to be colliding.
 *  Set by eye on a triangle that still read as crowded at a tighter bar — the
 *  labels are readable well before this, but a shape wearing three of them wants
 *  air, and zooming in is one gesture. */
export const LEG_LABEL_MIN_GAP_PX = 60;

/**
 * True when every label is far enough from every other to be readable.
 *
 * Compares centres, not boxes: the labels are one line of the same font, so
 * centre distance tracks the visual gap closely enough, and a box test would
 * need a width measurement that is not available until after paint.
 *
 * Non-finite coordinates (a point behind the globe, an un-projectable label)
 * count as crowded — unplaceable is not the same as far away, and guessing
 * "far" would paint a label at a position nothing computed.
 */
export function legLabelsReadable(
	points: readonly LabelPoint[],
	minGapPx: number = LEG_LABEL_MIN_GAP_PX,
): boolean {
	for (const p of points) {
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
	}
	// n is the number of legs in a hand-drawn shape — a dozen at the very most,
	// so the pairwise pass costs nothing and needs no spatial index.
	for (let i = 0; i < points.length; i++) {
		for (let j = i + 1; j < points.length; j++) {
			const dx = points[i].x - points[j].x;
			const dy = points[i].y - points[j].y;
			if (Math.hypot(dx, dy) < minGapPx) return false;
		}
	}
	return true;
}
