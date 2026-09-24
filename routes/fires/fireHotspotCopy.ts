/**
 * The words a planter reads when they tap a fire marker. Facts, not disclaimers.
 * Never show confidence (l/n/h) or raw FRP in MW: the intensity band says the same in words.
 */

import {
	type SeverityLevel,
	severityFor,
	TREND_STATUS,
	type TrendBand,
	trendFor,
} from "./fireSeverity";
import { cellKey, INDUSTRIAL_LABEL } from "./masks/staticHeatSources";
import type { FireHotspot } from "./fireCache";

/** Coarse on purpose: FRP (MW) swings with viewing angle and cloud. */
export type FireIntensity = "low" | "moderate" | "high" | "extreme";

export function intensityOf(frp: number): FireIntensity {
	if (!Number.isFinite(frp) || frp < 10) return "low";
	if (frp < 50) return "moderate";
	if (frp < 200) return "high";
	return "extreme";
}

export function intensityLabel(frp: number): string {
	switch (intensityOf(frp)) {
		case "low":
			return "Low heat";
		case "moderate":
			return "Moderate heat";
		case "high":
			return "High heat";
		case "extreme":
			return "Very high heat";
	}
}

/** Great-circle km; a local copy keeps this module free of map/worker code. */
export function kmApart(
	a: readonly [number, number],
	b: readonly [number, number],
): number {
	const R = 6371;
	const toRad = Math.PI / 180;
	const dLat = (b[1] - a[1]) * toRad;
	const dLng = (b[0] - a[0]) * toRad;
	const s =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 8-point compass bearing: "north-east of you" is actionable, "047°" is not. */
export function bearingLabel(
	from: readonly [number, number],
	to: readonly [number, number],
): string {
	const toRad = Math.PI / 180;
	const y = Math.sin((to[0] - from[0]) * toRad) * Math.cos(to[1] * toRad);
	const x =
		Math.cos(from[1] * toRad) * Math.sin(to[1] * toRad) -
		Math.sin(from[1] * toRad) *
			Math.cos(to[1] * toRad) *
			Math.cos((to[0] - from[0]) * toRad);
	const deg = (Math.atan2(y, x) / toRad + 360) % 360;
	const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
	return points[Math.round(deg / 45) % 8];
}

/** "336 km NE of you", or null with no fix. */
export function distanceLine(
	hotspot: readonly [number, number],
	you: readonly [number, number] | null,
): string | null {
	if (you === null) return null;
	const km = kmApart(you, hotspot);
	const dir = bearingLabel(you, hotspot);
	// Sub-km precision would be false: the pixel itself is ~0.4 km across.
	if (km < 1) return `Less than 1 km ${dir} of you`;
	return `${Math.round(km)} km ${dir} of you`;
}

/** "Seen 21h ago" — when the SATELLITE saw it, not when we fetched it. */
export function seenLabel(t: number, now: number = Date.now()): string {
	const mins = Math.max(0, Math.floor((now - t) / 60_000));
	if (mins < 60) return `Seen ${mins} min ago`;
	// Always hours, never days: 23h vs 47h is one missed pass vs four.
	const hours = mins / 60;
	if (hours < 10) return `Seen ${Math.floor(hours)}h ago`;
	return `Seen ${hours.toFixed(1)}h ago`;
}

/** How long since WE pinged NASA; "Just now" under a minute, never "0 min ago". */
export function pingAgo(t: number, now: number = Date.now()): string {
	const mins = Math.max(0, Math.floor((now - t) / 60_000));
	if (mins < 1) return "Just now";
	if (mins < 60) return `${mins} min ago`;
	const hours = mins / 60;
	if (hours < 10) return `${Math.floor(hours)}h ago`;
	return `${hours.toFixed(1)}h ago`;
}

/** The detection's pixel footprint, so the marker never reads as a surveyed perimeter. */
export function footprintLine(px: number | undefined): string {
	const m = Math.round(sideKm(px) * 1000);
	return `Covers ${m} m`;
}

/** VIIRS's nominal pixel side; the real px stretches to ~0.75 km at swath edge. */
export const NOMINAL_PIXEL_KM = 0.375;

/** Ground side of one grid cell. Pinned to the VIIRS pixel, not derived from CELL_DEG; a test holds the two within 15%. */
export const CELL_KM = NOMINAL_PIXEL_KM;

function sideKm(px: number | undefined): number {
	return Number.isFinite(px) && (px as number) > 0
		? (px as number)
		: NOMINAL_PIXEL_KM;
}

/**
 * Ground burning, km²: the UNIQUE cells, never a sum of detections (FIRMS reports the
 * same ground per satellite per overpass) and never the area between them.
 * One cell of area each, not the pixel's footprint: pixels overlap the grid.
 */
export function clusterAreaKm2(
	hotspots: readonly {
		coordinates?: readonly [number, number];
		px?: number;
	}[],
): number {
	const cells = new Set<string>();
	let ungridded = 0;
	for (const h of hotspots) {
		const c = h.coordinates;
		if (c === undefined || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
			// Can't be deduped, so count its footprint once rather than drop it.
			ungridded += sideKm(h.px) ** 2;
			continue;
		}
		cells.add(cellKey(c[0], c[1]));
	}
	return ungridded + cells.size * CELL_KM ** 2;
}

/** Hectares, the unit the job speaks. Mirrors `formatArea` in the online map's featureMeasure.ts (importing it pulls in turf); a test pins the two. */
export function areaLabel(km2: number): string {
	const ha = km2 * 100;
	// A detection is never "0 m²".
	if (ha < 0.1)
		return `${Math.max(1, Math.round(km2 * 1_000_000)).toLocaleString()} m²`;
	if (ha < 10) return `${ha.toFixed(1)} ha`;
	return `${Math.round(ha).toLocaleString()} ha`;
}

/** Labelled rows, not sentences: rows can be scanned. */
export interface CardRow {
	readonly label: string;
	readonly value: string;
	/** Intensity row only */
	readonly level?: SeverityLevel;
	/** Intensity row only; Status still spells it out, since red-up/green-down is a colourblind confusion pair. */
	readonly trend?: TrendBand;
}

export interface FireCard {
	readonly title: string;
	readonly rows: readonly CardRow[];
}

function commonRows(opts: {
	level: SeverityLevel;
	status: string;
	trend: TrendBand;
	areaKm2: number;
	seenAt: number;
	/** earliest sighting; absent on a single detection */
	firstAt?: number | null;
	/** when WE last pinged NASA */
	pingedAt?: number | null;
	now: number;
	where: string | null;
	fromYou: string | null;
	industrial?: boolean;
}): CardRow[] {
	const rows: CardRow[] = [
		{
			label: "Intensity",
			value: `${opts.level} of 5`,
			level: opts.level,
			trend: opts.trend,
		},
		{ label: "Status", value: opts.status },
		{ label: "Size", value: areaLabel(opts.areaKm2) },
	];
	// One detection row only: a "Last detected" beside "Last checked" reads as a contradiction.
	const firstSeen = opts.firstAt != null ? opts.firstAt : opts.seenAt;
	rows.push({ label: "First detected", value: seenAgo(firstSeen, opts.now) });
	// OUR clock, distinct from the NASA clock above: offline, a planter can't otherwise tell 30 s from 3 days.
	if (opts.pingedAt != null) {
		rows.push({
			label: "Last checked",
			value: pingAgo(opts.pingedAt, opts.now),
		});
	}
	if (opts.where) rows.push({ label: "Nearest", value: opts.where });
	if (opts.fromYou) rows.push({ label: "From you", value: opts.fromYou });
	// Flagged, not hidden: a refinery can genuinely catch fire.
	if (opts.industrial) rows.push({ label: "Source", value: INDUSTRIAL_LABEL });
	return rows;
}

/** `seenLabel` without the "Seen " prefix, for a labelled row. */
export function seenAgo(t: number, now: number = Date.now()): string {
	return seenLabel(t, now).replace(/^Seen /, "");
}

/** `distanceLine` without "of you", for a labelled row. */
export function fromYouValue(
	at: readonly [number, number],
	you: readonly [number, number] | null,
): string | null {
	const line = distanceLine(at, you);
	return line === null ? null : line.replace(/ of you$/, "");
}

export function buildHotspotCard(
	h: Pick<FireHotspot, "coordinates" | "t" | "frp"> & { px?: number },
	you: readonly [number, number] | null,
	now: number = Date.now(),
	/** Null while the gazetteer is still loading; the row is omitted. */
	where: string | null = null,
	industrial = false,
	pingedAt: number | null = null,
): FireCard {
	const area = clusterAreaKm2([h]);
	const sev = severityFor(area, h.frp);
	return {
		title: "Fire detected",
		rows: commonRows({
			level: sev.level,
			status: TREND_STATUS.new,
			trend: "new",
			areaKm2: area,
			seenAt: h.t,
			pingedAt,
			now,
			where,
			fromYou: fromYouValue(h.coordinates, you),
			industrial,
		}),
	};
}

/** Same shape as a single detection's card plus the spot count. Heat is the MAX, never a sum: twenty campfires are not one inferno. */
export function buildClusterCard(
	hotspots: readonly (Pick<FireHotspot, "coordinates" | "t" | "frp"> & {
		px?: number;
	})[],
	centre: readonly [number, number],
	you: readonly [number, number] | null,
	now: number = Date.now(),
	where: string | null = null,
	industrial = false,
	pingedAt: number | null = null,
): FireCard {
	const n = hotspots.length;
	const area = clusterAreaKm2(hotspots);
	const peakFrp = hotspots.reduce((m, h) => Math.max(m, h.frp || 0), 0);
	const newest = hotspots.reduce((m, h) => Math.max(m, h.t || 0), 0);
	const oldest = hotspots.reduce(
		(m, h) => (h.t && (m === 0 || h.t < m) ? h.t : m),
		0,
	);
	const sev = severityFor(area, peakFrp);
	const trend = trendFor(hotspots);

	const rows = commonRows({
		level: sev.level,
		status: trend.status,
		trend: trend.band,
		areaKm2: area,
		seenAt: newest > 0 ? newest : now,
		firstAt: oldest > 0 ? oldest : null,
		pingedAt,
		now,
		where,
		fromYou: fromYouValue(centre, you),
		industrial,
	});
	const sizeAt = rows.findIndex((r) => r.label === "Size");
	rows.splice(sizeAt + 1, 0, {
		label: "Hot spots",
		value: `${n} detected`,
	});
	return { title: "Fire detected", rows };
}
