/** Wildfire hotspots on disk, so the layer survives losing signal. Never hide it for being stale — show the record's age instead. */

import { kmBetween, kmToDegSpan } from "../../lib/shared/kmGeo";
import { makeKeyedIdbStore } from "../../lib/onPhone/store/keyedIdbStore";

/** Bump on any shape/fix change — a TTL only catches stale data, never wrong data. */
export const FIRE_CACHE_VERSION = 3;

export { FIRE_RADIUS_KM } from "../../lib/shared/fireContract";

/** Must stay under the edge's 3600 s TTL or the two compound: the age shown is this PLUS the edge's hour. */
export const FIRE_TTL_MS = 45 * 60 * 1000;

export type { FireConfidence } from "../../lib/shared/fireContract";

export type { FireHotspot } from "../../lib/shared/fireContract";
import type { FireHotspot } from "../../lib/shared/fireContract";

export interface FireCacheEntry {
	cacheVersion: number;
	/** when WE fetched it; each hotspot's `t` is when the satellite saw it */
	fetchedAt: number;
	center: [number, number];
	radiusKm: number;
	/** of three satellites; < 3 is degraded coverage */
	sourcesOk: number;
	hotspots: FireHotspot[];
}

const idb = makeKeyedIdbStore<FireCacheEntry>({
	dbName: "rt-fire-cache",
	storeName: "fires",
});

/** Null if absent or written by an older format; freshness is `isFresh`'s job. */
export async function readFireCache(
	key: string,
): Promise<FireCacheEntry | null> {
	const e = await idb.get(key);
	if (!e) return null;
	if (e.cacheVersion !== FIRE_CACHE_VERSION) return null;
	return e;
}

export async function writeFireCache(
	key: string,
	entry: Omit<FireCacheEntry, "cacheVersion">,
): Promise<void> {
	await idb.put(key, { ...entry, cacheVersion: FIRE_CACHE_VERSION });
	invalidateFireEntries();
}

export async function deleteFireCache(key: string): Promise<void> {
	await idb.delete(key);
	invalidateFireEntries();
}

export interface UnionResult {
	hotspots: FireHotspot[];
	oldestFetchedAt: number | null;
	degraded: boolean;
}

// Memos are about CPU time per pan, not memory; do not delete them on memory grounds.
let entriesMemo: FireCacheEntry[] | null = null;
let unionMemo: UnionResult | null = null;
let unionMemoSrc: readonly FireCacheEntry[] | null = null;
let nearMemo: FireCacheEntry[] | null = null;
let nearMemoKey = "";
let coverageMemo: FireCoverage[] | null = null;

export function invalidateFireEntries(): void {
	entriesMemo = null;
	unionMemo = null;
	coverageMemo = null;
	nearMemo = null;
	nearMemoKey = "";
	unionMemoSrc = null;
}

/** Every cached area's hotspots; memoized, invalidated by every write/delete. */
export async function allFireEntries(): Promise<FireCacheEntry[]> {
	if (entriesMemo !== null) return entriesMemo;
	// Cursor, never getAll(): getAll() deserializes every disc in one task.
	entriesMemo = (
		await idb.getAllProjected((e) =>
			e?.cacheVersion === FIRE_CACHE_VERSION ? e : null,
		)
	).filter((e): e is FireCacheEntry => e !== null);
	return entriesMemo;
}

/** Could any part of the disc be in range: centre-only testing silently hides real fires at the edge. */
export function discCouldRender(
	disc: { center: [number, number]; radiusKm: number },
	origins: readonly (readonly [number, number])[],
	maxKm: number,
): boolean {
	const reach = maxKm + disc.radiusKm;
	for (const o of origins) {
		if (kmBetween([o[0], o[1]], disc.center) <= reach) return true;
	}
	return false;
}

export async function fireEntriesNear(
	origins: readonly (readonly [number, number])[],
	maxKm = 0,
): Promise<FireCacheEntry[]> {
	if (origins.length === 0) return allFireEntries();
	// Memoized on the selected discs, never the origins (change every pan).
	const cov = await fireCoverage();
	const selected = cov
		.filter((c) => discCouldRender(c, origins, maxKm))
		.map((c) => `${c.center[0].toFixed(4)},${c.center[1].toFixed(4)}`)
		.sort();
	const key = `${maxKm}|${selected.join(";")}`;
	if (nearMemo !== null && nearMemoKey === key) return nearMemo;
	const want = new Set(selected);
	const rows = (
		await idb.getAllProjected((e) =>
			e?.cacheVersion === FIRE_CACHE_VERSION &&
			want.has(`${e.center[0].toFixed(4)},${e.center[1].toFixed(4)}`)
				? e
				: null,
		)
	).filter((e): e is FireCacheEntry => e !== null);
	nearMemo = rows;
	nearMemoKey = key;
	return rows;
}

export interface FireCoverage {
	readonly center: [number, number];
	readonly radiusKm: number;
	readonly fetchedAt: number;
}

/** Where/when each disc was fetched, without hotspots; `allFireEntries()` only when painting. */
export async function fireCoverage(): Promise<FireCoverage[]> {
	if (coverageMemo !== null) return coverageMemo;
	const rows = await idb.getAllProjected((e) =>
		e?.cacheVersion === FIRE_CACHE_VERSION
			? {
					center: e.center,
					radiusKm: e.radiusKm,
					fetchedAt: e.fetchedAt,
				}
			: null,
	);
	coverageMemo = rows.filter((r): r is FireCoverage => r !== null);
	return coverageMemo;
}

export function isCoverageFresh(
	c: FireCoverage,
	now: number = Date.now(),
): boolean {
	return now - c.fetchedAt < FIRE_TTL_MS;
}

export function isFresh(
	entry: FireCacheEntry,
	now: number = Date.now(),
): boolean {
	return now - entry.fetchedAt < FIRE_TTL_MS;
}

/** NASA's processing lag: a fetch this soon after a detection may not include it yet. */
const SUPERSEDE_SLACK_MS = 30 * 60 * 1000;

function coveredBy(e: FireCacheEntry, lng: number, lat: number): boolean {
	return kmBetween([lng, lat], e.center) <= e.radiusKm;
}

interface DiscBox {
	w: number;
	s: number;
	e: number;
	n: number;
}

/** dLng at the box's worst latitude, so the reject never drops a point `coveredBy` would accept. */
function discBox(entry: FireCacheEntry): DiscBox {
	const [lng, lat] = entry.center;
	const worstLat = Math.min(89, Math.abs(lat) + entry.radiusKm / 111);
	const { dLat, dLng } = kmToDegSpan(entry.radiusKm, worstLat);
	return { w: lng - dLng, s: lat - dLat, e: lng + dLng, n: lat + dLat };
}

/** A hotspot drops once a NEWER fetch covers its ground and omits it. Reports
 * the OLDEST fetch time — newest would let one fresh disc vouch for a stale one. */
export function unionHotspots(entries: readonly FireCacheEntry[]): UnionResult {
	if (entries.length === 0) {
		return { hotspots: [], oldestFetchedAt: null, degraded: false };
	}
	// Exact array identity: two memo'd reads hold different discs.
	if (unionMemo !== null && entries === unionMemoSrc) return unionMemo;
	// Sorted newest-first so the covering search stops at its first hit.
	const boxes = entries.map(discBox);
	const newerThan = entries.map((e) =>
		entries
			.map((other, j) => ({ other, box: boxes[j] }))
			.filter(({ other }) => other.fetchedAt > e.fetchedAt)
			.sort((a, b) => b.other.fetchedAt - a.other.fetchedAt),
	);
	const best = new Map<string, FireHotspot>();
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		const newer = newerThan[i];
		for (const h of e.hotspots) {
			// Box-reject before kmBetween: trig per (hotspot × disc) pegged the CPU at idle.
			const [lng, lat] = h.coordinates;
			let newestCover = 0;
			for (const { other, box } of newer) {
				if (lng < box.w || lng > box.e || lat < box.s || lat > box.n) {
					continue;
				}
				if (coveredBy(other, lng, lat)) {
					newestCover = other.fetchedAt;
					break;
				}
			}
			if (newestCover - SUPERSEDE_SLACK_MS > h.t) {
				continue;
			}
			// Rounded position + hour, matching the Worker's dedupe.
			const key = [
				h.coordinates[0].toFixed(3),
				h.coordinates[1].toFixed(3),
				Math.floor(h.t / 3_600_000),
			].join("|");
			const prev = best.get(key);
			if (prev === undefined || h.frp > prev.frp) best.set(key, h);
		}
	}
	const result: UnionResult = {
		hotspots: [...best.values()],
		// codestyle-allow-spread: one entry per cached fire area, tens at most.
		oldestFetchedAt: Math.min(...entries.map((e) => e.fetchedAt)),
		degraded: entries.some((e) => e.sourcesOk < 3),
	};
	if (entries === entriesMemo || entries === nearMemo) {
		unionMemo = result;
		unionMemoSrc = entries;
	}
	return result;
}

/** Properties keep the Worker's short names (`t`/`c`/`frp`): one vocabulary end to end. */
export function hotspotsToGeoJSON(
	hotspots: readonly FireHotspot[],
): GeoJSON.FeatureCollection {
	return {
		type: "FeatureCollection",
		features: hotspots.map((h) => ({
			type: "Feature",
			geometry: { type: "Point", coordinates: [...h.coordinates] },
			properties: {
				t: h.t,
				c: h.c,
				frp: h.frp,
				...(h.px === undefined ? {} : { px: h.px }),
				...(h.dn === undefined ? {} : { dn: h.dn }),
			},
		})),
	};
}

/** The staleness stamp; `null` yields "no fire data" rather than an implied-fresh blank. */
export function fireAgeLabel(
	fetchedAt: number | null,
	now: number = Date.now(),
): string {
	if (fetchedAt === null) return "no fire data";
	const mins = Math.max(0, Math.floor((now - fetchedAt) / 60_000));
	if (mins < 2) return "just now";
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return days === 1 ? "1 day ago" : `${days} days ago`;
}
