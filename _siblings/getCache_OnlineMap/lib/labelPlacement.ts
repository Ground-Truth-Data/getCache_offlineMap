// Area-name label placement — the "short handle on a priority budget"
// convention (design handoff: design_handoff_area_names).
//
// Direct port of the handoff's dependency-free `label-placement.js`. Pure —
// no DOM, no Mapbox. The caller supplies a projection and a text measurer
// and gets back, per area, whether to draw a LABEL (chip), a DOT, or
// nothing, and where. areaLabels.ts is the renderer that consumes this.
//
// The three rules:
//   1. A name is ONE LINE, never a paragraph — the map shows a short
//      handle (displayName, or deriveHandle(fullName) as the suggestion),
//      capped at HANDLE_MAX_W. The full name lives in the tap popover.
//   2. Labels are a BUDGET, placed by priority — highest score first; a
//      label draws only if its box clears every box already placed.
//      Losers collapse to a dot. The selected area always keeps its label.
//   3. ZOOM sets the budget — no explicit cap; zooming out packs the
//      centroids, more boxes collide, fewer labels survive. Re-run on
//      zoom / data / selection change.
//   4. DECISIONS ARE STICKY. The pass runs on every camera frame, so a
//      stateless answer makes borderline pairs flip chip↔dot continuously —
//      the label set chatters. Pass `previous` and an incumbent both sorts
//      ahead of its challengers and tolerates HYSTERESIS_PX2 of overlap
//      before it is evicted.

/* ---- tunables (match the handoff design tokens) -------------------- */
// ⚠️ These MIRROR the .area-chip CSS in areaLabels.ts — font-size, max-width and
// horizontal padding. Change one without the other and the layout reserves boxes
// that don't match the chips it is placing: too wide hides labels that would have
// fit, too narrow lets them overlap.
const HANDLE_PX = 12; // label font size used for measuring
const HANDLE_MAX_W = 170; // one-line handle cap (px) — enforces Rule 1
const CHIP_PAD_X = 9; // horizontal chip padding each side adds to width
const BOX_PAD = 4; // extra slop added around each reserved box
const OVERLAP_SLOP = 4; // px² overlap below this is treated as "clear"
const DOT_BOX = 30; // reserved footprint for a collapsed dot (px)
// Rule 4's deadband. A chip that already won keeps winning until it overlaps by
// more than this; a chip that lost must clear by this margin before it returns.
// Without it the pass is a stateless decision on a continuously-varying input,
// and every zoom frame re-answers a borderline pair differently — the label set
// visibly chatters. Any thermostat needs a deadband; so does this.
const HYSTERESIS_PX2 = 900;

export type PrioMode = "both" | "big" | "recent";

export interface LabelArea {
	id: string;
	fullName: string;
	/** Short handle. Falls back to deriveHandle(fullName) when empty. */
	displayName?: string;
	hectares: number;
	/** Days since last touch — recency input to the score. Pass 0 for all
	 *  when unknown; the score then orders purely by size. */
	visitedDaysAgo: number;
}

export interface LabelDecision {
	id: string;
	kind: "label" | "dot" | "hidden";
	x: number;
	y: number;
	text: string;
}

export interface LayoutOpts {
	prioMode?: PrioMode;
	selectedId?: string | null;
	collapseLosersToDot?: boolean;
	/** Area centroid → screen px. */
	project: (area: LabelArea) => { x: number; y: number };
	/** Text width in px with the label font set at `px`. */
	measureText: (text: string, px: number) => number;
	/** Last pass's decision per id — the hysteresis input (Rule 4). Omit on a
	 *  cold pass. */
	previous?: ReadonlyMap<string, LabelDecision["kind"]>;
}

/**
 * Rule 1 helper — derive a short, editable handle from a long free-text
 * name. A *suggestion* prefilled into an editable field at save time; the
 * full name is never lost. Never silently final.
 */
const FILLER = /^(blk|block|mini|pile|restor|restoration)$/i;
export function deriveHandle(fullName: string): string {
	const s = String(fullName)
		.trim()
		.replace(/^polygon[_\s-]*/i, ""); // drop "polygon_" prefix
	const words = s.split(/[\s_]+/).filter((w) => w && !FILLER.test(w));
	const handle = words.slice(0, 2).join(" "); // first 1–2 meaningful words
	return handle || fullName; // never return empty
}

interface Stats {
	maxHectares: number;
	minVisited: number;
	maxVisited: number;
}

/**
 * Rule 2 helper — priority score. Higher = placed first = keeps its label.
 * mode: 'both' (recent + big, recommended) | 'big' | 'recent'
 */
export function score(area: LabelArea, mode: PrioMode, stats: Stats): number {
	const vSpan = stats.maxVisited - stats.minVisited || 1;
	const recency = (stats.maxVisited - area.visitedDaysAgo) / vSpan;
	const size = area.hectares / (stats.maxHectares || 1);
	if (mode === "big") return size;
	if (mode === "recent") return recency;
	return 0.5 * recency + 0.5 * size; // "recent + big"
}

/* ---- geometry ------------------------------------------------------- */
export type PlacedBox = { x0: number; y0: number; x1: number; y1: number };

function overlapArea(a: PlacedBox, b: PlacedBox): number {
	const ox = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
	const oy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
	return ox * oy;
}

/** True when `box` meaningfully overlaps any reserved box. Exported so the
 *  renderer can run follow-on tiers (track labels) against the same
 *  reserved space with identical semantics. `slop` raises the bar for a box
 *  that already held its place last pass (Rule 4). */
export function collidesWithPlaced(
	box: PlacedBox,
	placed: PlacedBox[],
	slop: number = OVERLAP_SLOP,
): boolean {
	return placed.some((r) => overlapArea(box, r) > slop);
}

export interface LayoutResult {
	decisions: LabelDecision[];
	/** Every reserved footprint (labels + dots), for follow-on tiers. */
	placed: PlacedBox[];
}

/**
 * The placement pass. Places labels highest-priority-first; a label only
 * draws if its bounding box clears every box already placed. Losers collapse
 * to a dot (or hide). The selected area is forced first and always keeps
 * its label.
 */
export function layoutLabels(
	areas: LabelArea[],
	opts: LayoutOpts,
): LayoutResult {
	const {
		prioMode = "both",
		selectedId = null,
		collapseLosersToDot = true,
		project,
		measureText,
		previous,
	} = opts;
	if (areas.length === 0) return { decisions: [], placed: [] };

	// per-frame stats across the set
	const stats: Stats = {
		maxHectares: Math.max(...areas.map((a) => a.hectares)),
		minVisited: Math.min(...areas.map((a) => a.visitedDaysAgo)),
		maxVisited: Math.max(...areas.map((a) => a.visitedDaysAgo)),
	};

	// priority order — selected first, then whoever ALREADY holds a chip, then
	// score desc. Incumbency is part of Rule 4: re-ordering the queue every frame
	// would hand the space to a different winner even with a deadband in place.
	const order = [...areas].sort((a, b) => {
		if (a.id === selectedId) return -1;
		if (b.id === selectedId) return 1;
		const aHeld = previous?.get(a.id) === "label" ? 1 : 0;
		const bHeld = previous?.get(b.id) === "label" ? 1 : 0;
		if (aHeld !== bHeld) return bHeld - aHeld;
		return score(b, prioMode, stats) - score(a, prioMode, stats);
	});

	const placed: PlacedBox[] = [];
	const decisions: LabelDecision[] = [];

	for (const area of order) {
		const { x, y } = project(area);
		const forced = area.id === selectedId;

		// Rule 1: one line, capped width. Measure the handle, never the full name.
		const text = area.displayName || deriveHandle(area.fullName);
		const w =
			Math.min(HANDLE_MAX_W, measureText(text, HANDLE_PX)) + CHIP_PAD_X * 2;
		const h = HANDLE_PX + 8;

		const box: PlacedBox = {
			x0: x - w / 2 - BOX_PAD,
			y0: y - h / 2 - BOX_PAD,
			x1: x + w / 2 + BOX_PAD,
			y1: y + h / 2 + BOX_PAD,
		};
		// Rule 4: an incumbent tolerates more overlap before being evicted than a
		// challenger needs to win the slot. The gap between the two thresholds is
		// the deadband that stops borderline pairs chattering.
		const held = previous?.get(area.id) === "label";
		const collides = collidesWithPlaced(
			box,
			placed,
			held ? HYSTERESIS_PX2 : OVERLAP_SLOP,
		);

		if (forced || !collides) {
			decisions.push({ id: area.id, kind: "label", x, y, text });
			placed.push(box); // reserve the label's footprint
		} else if (collapseLosersToDot) {
			decisions.push({ id: area.id, kind: "dot", x, y, text });
			placed.push({
				x0: x - DOT_BOX / 2,
				y0: y - DOT_BOX / 2, // reserve the dot's footprint
				x1: x + DOT_BOX / 2,
				y1: y + DOT_BOX / 2,
			});
		} else {
			decisions.push({ id: area.id, kind: "hidden", x, y, text });
		}
	}

	return { decisions, placed };
}
