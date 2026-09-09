/**
 * Manual georeferencing: a numbered pair list, and the corner quad it solves to.
 *
 * The solver is `fitPageToGeoAffine` in ../geoPdf/geoPdfBounds.ts — the same one
 * a real GeoPDF's embedded GCPs go through, so a hand-placed sheet and an
 * imported one produce identical output and nothing downstream can tell them
 * apart.
 */
import {
	applyPageToGeo,
	fitPageToGeoAffine,
	type GeoRefPoint,
	type PageToGeoAffine,
} from "../geoPdf/geoPdfBounds";

/** One half-entered or complete pair. `map` is absent while the user still owes
 *  the map half — the state machine's `awaiting map tap`. */
export interface ControlPoint {
	id: number;
	page: { x: number; y: number };
	map?: { lng: number; lat: number };
}

/** Clockwise from top-left, the shape the overlay renderer consumes. */
export type CornerQuad = [
	[number, number],
	[number, number],
	[number, number],
	[number, number],
];

export interface Solution {
	quad: CornerQuad;
	transform: PageToGeoAffine;
	/** Metres between where each point was placed and where the fit puts it.
	 *  Indexed to match `paired`. */
	residualsM: number[];
	paired: ControlPoint[];
}

const METERS_PER_DEG = 110_540;

export function pairedOnly(points: ControlPoint[]): ControlPoint[] {
	return points.filter((p) => p.map !== undefined);
}

function toGcps(paired: ControlPoint[]): GeoRefPoint[] {
	return paired.map((p) => ({
		x: p.page.x,
		y: p.page.y,
		// biome-ignore lint/style/noNonNullAssertion: pairedOnly filtered these
		lng: p.map!.lng,
		// biome-ignore lint/style/noNonNullAssertion: pairedOnly filtered these
		lat: p.map!.lat,
	}));
}

/**
 * Solve the sheet's placement. Null until three points are paired, and null
 * again if the fit is too poor to trust — the caller shows "these don't line
 * up" rather than laying a wrong sheet on the map.
 */
export function solve(
	points: ControlPoint[],
	page: { width: number; height: number },
): Solution | null {
	const paired = pairedOnly(points);
	if (paired.length < 3) return null;

	const t = fitPageToGeoAffine(toGcps(paired));
	if (!t) return null;

	const quad: CornerQuad = [
		applyPageToGeo(t, 0, 0),
		applyPageToGeo(t, page.width, 0),
		applyPageToGeo(t, page.width, page.height),
		applyPageToGeo(t, 0, page.height),
	];

	const residualsM = paired.map((p) => {
		const [lng, lat] = applyPageToGeo(t, p.page.x, p.page.y);
		// biome-ignore lint/style/noNonNullAssertion: pairedOnly filtered these
		const m = p.map!;
		const mLng = METERS_PER_DEG * Math.cos((m.lat * Math.PI) / 180);
		return Math.hypot((lng - m.lng) * mLng, (lat - m.lat) * METERS_PER_DEG);
	});

	return { quad, transform: t, residualsM, paired };
}

/** Under 20 m is good on a block map; over 100 m means a point is in the wrong
 *  place. Drives a colour, never a number the user has to interpret. */
export type PointQuality = "good" | "fair" | "off";

export function quality(residualM: number): PointQuality {
	if (residualM <= 20) return "good";
	if (residualM <= 100) return "fair";
	return "off";
}
