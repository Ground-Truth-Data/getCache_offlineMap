/** The open rule. Location is read only when the map opens, never in the background. An area is a z10 tile, the
 * blob's own anchor; the planter earns its blob by opening the map there on two occasions. */

import { ANCHOR_Z, latToY, lngToX } from "./tiles";

/** Two opens this far apart, or on different days, are two occasions. */
export const AREA_GAP_MS = 4 * 3_600_000;
/** Back after this long, the map acts like a first open: blob at once, camera on the planter. */
export const LONG_ABSENCE_MS = 14 * 86_400_000;
const MAX_AREAS = 64;
const KEY = "gc-map-opens";

/** `areas`: each area's first open of its current occasion. */
export interface OpenLog {
	last?: number;
	areas: Record<string, number>;
}

export interface OpenPlan {
	/** "ask": on cellular, wait for a tap */
	download: "now" | "ask" | "no";
	/** a first open or a long absence: put the camera on the planter */
	zoom: boolean;
	log: OpenLog;
}

export const areaOf = (lng: number, lat: number): string => `${ANCHOR_Z}/${lngToX(lng, ANCHOR_Z)}/${latToY(lat, ANCHOR_Z)}`;

const day = (ms: number): string => new Date(ms).toDateString();

/** `at` is null when the map opened with no fix: the open still counts. */
export function planOpen(log: OpenLog, now: number, at: [number, number] | null, o: { covered: boolean; wifi: boolean }): OpenPlan {
	const zoom = log.last === undefined || now - log.last >= LONG_ABSENCE_MS;
	const areas = { ...log.areas };
	let download: OpenPlan["download"] = "no";
	if (at) {
		const a = areaOf(at[0], at[1]);
		const first = areas[a];
		const again = first !== undefined && (now - first >= AREA_GAP_MS || day(now) !== day(first));
		if (!o.covered && (zoom || again)) download = zoom || o.wifi ? "now" : "ask";
		delete areas[a];
		areas[a] = first ?? now;
	}
	const kept = Object.entries(areas).slice(-MAX_AREAS);
	return { download, zoom, log: { last: now, areas: Object.fromEntries(kept) } };
}

export function readOpenLog(): OpenLog {
	try {
		const log = JSON.parse(localStorage.getItem(KEY) ?? "null") as OpenLog | null;
		return log && typeof log.areas === "object" ? log : { areas: {} };
	} catch (e) {
		console.warn("[areaOpens] unreadable open log, starting afresh", e);
		return { areas: {} };
	}
}

export function writeOpenLog(log: OpenLog): void {
	localStorage.setItem(KEY, JSON.stringify(log));
}
