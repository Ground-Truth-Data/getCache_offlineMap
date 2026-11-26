// Side is CHOSEN BY MEASUREMENT: an always-below card walks off the viewport once the pin pans.
// The card's own height is never known here: a card above hangs from its bottom edge, so however tall it is,
// it ends at the pin instead of sliding down over it.

export type Bbox = { minX: number; minY: number; maxX: number; maxY: number };

export type PlaceInput = {
	bbox: Bbox;
	containerWidth: number;
	containerHeight: number;
	isPoint: boolean;
	wide: boolean;
	/** Chrome reserves: app top bar / draw strip, and tab bar / shovel. */
	topReserve: number;
	bottomReserve: number;
	/** The crow tile's no-go rect, in container coordinates. */
	crow?: { left: number; top: number; bottom: number } | null;
};

export type Placement = {
	left: number;
	width: number;
	/** The card's edge nearest the anchor: its top when below, its bottom when above. */
	edge: number;
	maxH: number;
	side: "above" | "below";
};

const OFFSET = 15;
/** So the card clears the pin icon's point. */
const PIN_GAP = 18;
const PAD = 8;
const CROW_CLEARANCE = 10;
/** Tall enough for a cache's header, ledger and three rows of pins: a card never squeezes under this. */
export const MIN_OPEN = 360;
const MIN_WIDTH = 160;

export function placePopover(input: PlaceInput): Placement {
	const { bbox, containerWidth, containerHeight, isPoint, wide, topReserve, bottomReserve, crow } = input;

	const cap = wide ? containerWidth - 46 : 260;
	let width = Math.max(MIN_WIDTH, Math.min(cap, containerWidth - PAD * 2));

	const usableTop = topReserve;
	const usableBottom = containerHeight - bottomReserve;

	const gap = OFFSET + (isPoint ? PIN_GAP : 0);
	const below = bbox.maxY + gap;
	const above = bbox.minY - gap;
	const roomBelow = usableBottom - below;
	// Above may climb into the top reserve, but only as far as it needs.
	const ceiling = Math.min(usableTop, Math.max(PAD, above - MIN_OPEN));

	let edge: number;
	let maxH: number;
	let side: Placement["side"];
	if (roomBelow >= MIN_OPEN || roomBelow >= above - PAD) {
		side = "below";
		edge = Math.max(PAD, Math.min(below, usableBottom - MIN_OPEN));
		maxH = usableBottom - edge;
	} else {
		// With no room either side, it opens as high as it can at its full minimum, over the pin's top.
		side = "above";
		edge = Math.max(above, ceiling + MIN_OPEN);
		maxH = edge - ceiling;
	}

	const centerX = (bbox.minX + bbox.maxX) / 2;
	let left = centerX - width / 2;
	left = Math.max(PAD, Math.min(left, containerWidth - width - PAD));

	// ⚠️ Width must not depend on height: measured height → width → re-wrap → height loops.
	if (crow) {
		// The card's own span, not the whole map's: one that opens under the crow keeps its width.
		const [top, bottom] = side === "below" ? [edge, edge + maxH] : [edge - maxH, edge];
		const vertOverlap = top < crow.bottom && bottom > crow.top;
		if (vertOverlap) {
			const maxRight = crow.left - CROW_CLEARANCE;
			if (left + width > maxRight) {
				const shifted = maxRight - width;
				if (shifted >= PAD) {
					left = shifted;
				} else {
					left = PAD;
					width = Math.max(MIN_WIDTH, maxRight - PAD);
				}
			}
		}
	}

	return { left, width, edge, maxH, side };
}

export type Leader = { x0: number; y0: number; x1: number; y1: number };

export function leaderLine(bbox: Bbox, place: Placement): Leader | null {
	const MIN_RUN = 10;
	/** Land inside the card's edge, clear of the rounded corners. */
	const INSET = 16;
	const x0 = (bbox.minX + bbox.maxX) / 2;
	const x1 = Math.max(place.left + INSET, Math.min(x0, place.left + place.width - INSET));
	const y0 = place.side === "below" ? bbox.maxY + 3 : bbox.minY - 3;
	const y1 = place.edge;
	if (Math.abs(y1 - y0) < MIN_RUN) return null;
	return { x0, y0, x1, y1 };
}
