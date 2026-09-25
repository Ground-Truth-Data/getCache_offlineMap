// Crowded leg labels HIDE, all of them: overlapping digits read as a different
// number, and one captioned leg beside a bare one reads as "this leg is special".

export type LabelPoint = { x: number; y: number };

/** Centre-to-centre, set by eye: a shape wearing three labels wants air. */
export const LEG_LABEL_MIN_GAP_PX = 60;

/**
 * Compares centres, not boxes: a box test needs a width not known until paint.
 * Non-finite coordinates count as crowded — unplaceable is not far away.
 */
export function legLabelsReadable(
	points: readonly LabelPoint[],
	minGapPx: number = LEG_LABEL_MIN_GAP_PX,
): boolean {
	for (const p of points) {
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
	}
	// A dozen legs at most: no spatial index needed.
	for (let i = 0; i < points.length; i++) {
		for (let j = i + 1; j < points.length; j++) {
			const dx = points[i].x - points[j].x;
			const dy = points[i].y - points[j].y;
			if (Math.hypot(dx, dy) < minGapPx) return false;
		}
	}
	return true;
}
