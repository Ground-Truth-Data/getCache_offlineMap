// Side is CHOSEN BY MEASUREMENT: an always-below card walks off the viewport once the pin pans.

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
	measuredHeight?: number;
	/** The crow tile's no-go rect, in container coordinates. */
	crow?: { left: number; top: number; bottom: number } | null;
};

export type Placement = {
	left: number;
	top: number;
	width: number;
	maxH: number;
	side: "above" | "below";
};

const OFFSET = 15;
/** So the card clears the pin icon's point. */
const PIN_GAP = 18;
const PAD = 8;
const CROW_CLEARANCE = 10;
export const ESTIMATED_HEIGHT = 220;
const MIN_HEIGHT = 160;
const MIN_WIDTH = 160;

export function placePopover(input: PlaceInput): Placement {
	const {
		bbox,
		containerWidth,
		containerHeight,
		isPoint,
		wide,
		topReserve,
		bottomReserve,
		measuredHeight,
		crow,
	} = input;

	const cap = wide ? containerWidth - 64 : 260;
	let width = Math.max(MIN_WIDTH, Math.min(cap, containerWidth - PAD * 2));

	const usableTop = topReserve;
	const usableBottom = containerHeight - bottomReserve;

	const gap = OFFSET + (isPoint ? PIN_GAP : 0);
	const height =
		measuredHeight && measuredHeight > 0 ? measuredHeight : ESTIMATED_HEIGHT;

	const roomBelow = usableBottom - (bbox.maxY + gap);
	const roomAbove = bbox.minY - gap - usableTop;

	const fitsBelow = roomBelow >= height;
	const side: "above" | "below" =
		fitsBelow || roomBelow >= roomAbove ? "below" : "above";

	let top =
		side === "below"
			? bbox.maxY + gap
			: // The card's BOTTOM sits `gap` over the anchor.
				bbox.minY - gap - height;

	// Top clamp wins — never hide the header under the chrome; a tall card scrolls via maxH.
	if (side === "below") top = Math.min(top, usableBottom - height);
	top = Math.max(usableTop, top);

	const maxH = Math.max(MIN_HEIGHT, usableBottom - top);

	const centerX = (bbox.minX + bbox.maxX) / 2;
	let left = centerX - width / 2;
	left = Math.max(PAD, Math.min(left, containerWidth - width - PAD));

	// ⚠️ Width must not depend on height: measured height → width → re-wrap → height loops.
	if (crow) {
		const vertOverlap = usableTop < crow.bottom && usableBottom > crow.top;
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

	return { left, top, width, maxH, side };
}

export type Leader = { x0: number; y0: number; x1: number; y1: number };

export function leaderLine(
	bbox: Bbox,
	place: Placement,
	opts: { measuredHeight?: number } = {},
): Leader | null {
	const MIN_RUN = 10;
	/** Land inside the card's edge, clear of the rounded corners. */
	const INSET = 16;
	const x0 = (bbox.minX + bbox.maxX) / 2;
	const x1 = Math.max(
		place.left + INSET,
		Math.min(x0, place.left + place.width - INSET),
	);

	if (place.side === "below") {
		const y0 = bbox.maxY + 3;
		const y1 = place.top;
		if (y1 - y0 < MIN_RUN) return null;
		return { x0, y0, x1, y1 };
	}

	const height =
		opts.measuredHeight && opts.measuredHeight > 0 ? opts.measuredHeight : null;
	const cardBottom = height
		? place.top + Math.min(height, place.maxH)
		: place.top + place.maxH;
	const y0 = bbox.minY - 3;
	const y1 = cardBottom;
	if (y0 - y1 < MIN_RUN) return null;
	return { x0, y0, x1, y1 };
}
