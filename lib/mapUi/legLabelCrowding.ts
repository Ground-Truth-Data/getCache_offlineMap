// A leg label hides on its own, like a pin joining a cluster: a leg too short on
// screen to carry one, or a label whose centre would land on another's. The rest
// stay — a long leg is still a ruler when a short one beside it is not.

export type LegLabel = { x: number; y: number; legPx: number };

/** Centre-to-centre, set by eye: a shape wearing three labels wants air. */
export const LEG_LABEL_MIN_GAP_PX = 60;
/** A label is ~60px wide; a leg shorter than this wears it like a hat. */
export const LEG_LABEL_MIN_LEG_PX = 44;

/**
 * Which labels to draw. Longest legs claim their spot first, so a collision
 * drops the short leg's label, never the long one's. Compares centres, not
 * boxes: a box test needs a width not known until paint. A non-finite centre
 * is unplaceable, never "far away".
 */
export function keptLegLabels(
	labels: readonly LegLabel[],
	minGapPx: number = LEG_LABEL_MIN_GAP_PX,
	minLegPx: number = LEG_LABEL_MIN_LEG_PX,
): boolean[] {
	const kept = labels.map(() => false);
	const order = labels.map((_, i) => i).sort((a, b) => labels[b].legPx - labels[a].legPx);
	const placed: LegLabel[] = [];
	for (const i of order) {
		const l = labels[i];
		if (!Number.isFinite(l.x) || !Number.isFinite(l.y) || l.legPx < minLegPx) continue;
		if (placed.some((p) => Math.hypot(p.x - l.x, p.y - l.y) < minGapPx)) continue;
		placed.push(l);
		kept[i] = true;
	}
	return kept;
}
