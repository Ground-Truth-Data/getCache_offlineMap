import { describe, expect, it, vi } from "vitest";

let kmBetweenCalls = 0;
vi.mock("../../lib/shared/kmGeo", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("../../lib/shared/kmGeo")>();
	return {
		...real,
		kmBetween: (a: [number, number], b: [number, number]) => {
			kmBetweenCalls++;
			return real.kmBetween(a, b);
		},
	};
});

import {
	discCouldRender,
	FIRE_TTL_MS,
	type FireCacheEntry,
	type FireHotspot,
	fireAgeLabel,
	hotspotsToGeoJSON,
	invalidateFireEntries,
	isCoverageFresh,
	isFresh,
	unionHotspots,
} from "./fireCache";

const T0 = Date.UTC(2026, 7, 7, 18, 0);

const spot = (
	lng: number,
	lat: number,
	frp = 5,
	t = T0,
	c: FireHotspot["c"] = "nominal",
): FireHotspot => ({ coordinates: [lng, lat], t, c, frp });

const entry = (
	fetchedAt: number,
	hotspots: FireHotspot[],
	sourcesOk = 3,
): FireCacheEntry => ({
	cacheVersion: 1,
	fetchedAt,
	center: [-75.7, 45.4],
	radiusKm: 500,
	sourcesOk,
	hotspots,
});

describe("the per-pan memo — never at the cost of correctness", () => {
	it("a caller's OWN array is never served from the memo", () => {
		const a = [entry(T0, [spot(-120, 50, 5)])];
		const b = [entry(T0, [spot(-121, 51, 9)])];
		expect(unionHotspots(a).hotspots[0].coordinates).toEqual([-120, 50]);
		expect(unionHotspots(b).hotspots[0].coordinates).toEqual([-121, 51]);
	});

	it("still dedupes correctly when called repeatedly with equal-but-distinct arrays", () => {
		const mk = (): FireCacheEntry[] => [
			entry(T0, [spot(-120, 50), spot(-120, 50)]),
		];
		expect(unionHotspots(mk()).hotspots).toHaveLength(1);
		expect(unionHotspots(mk()).hotspots).toHaveLength(1);
	});

	it("invalidate is safe to call at any time, including twice", () => {
		expect(() => {
			invalidateFireEntries();
			invalidateFireEntries();
		}).not.toThrow();
		expect(unionHotspots([entry(T0, [spot(-120, 50)])]).hotspots).toHaveLength(
			1,
		);
	});
});

describe("discCouldRender — the read filter must never hide a visible fire", () => {
	const WALL = 500;
	const HOME: readonly [number, number] = [-75.7, 45.4];
	const disc = (center: [number, number], radiusKm = 500) => ({
		center,
		radiusKm,
	});

	it("keeps the disc you are standing in", () => {
		expect(discCouldRender(disc([-75.7, 45.4]), [HOME], WALL)).toBe(true);
	});

	it("keeps a FAR-CENTRED disc whose edge still reaches inside the wall", () => {
		const farCentre = disc([-64.3, 45.4]);
		const centreDist = 900;
		expect(centreDist).toBeGreaterThan(WALL);
		expect(discCouldRender(farCentre, [HOME], WALL)).toBe(true);
	});

	it("drops a disc that cannot reach the wall from any origin", () => {
		expect(discCouldRender(disc([-123.1, 49.3]), [HOME], WALL)).toBe(false);
	});

	it("keeps a disc near ANY origin, not just the first", () => {
		const vancouver: readonly [number, number] = [-123.1, 49.3];
		const d = disc([-123.1, 49.3]);
		expect(discCouldRender(d, [HOME], WALL)).toBe(false);
		expect(discCouldRender(d, [HOME, vancouver], WALL)).toBe(true);
	});

	it("with no origins, decides nothing — the caller falls back to reading all", () => {
		expect(discCouldRender(disc([-123.1, 49.3]), [], WALL)).toBe(false);
	});

	it("a bigger disc reaches further — radius is part of the test, not decoration", () => {
		const centre: [number, number] = [-64.3, 45.4];
		expect(discCouldRender(disc(centre, 100), [HOME], WALL)).toBe(false);
		expect(discCouldRender(disc(centre, 500), [HOME], WALL)).toBe(true);
	});
});

describe("memo identity — a new array on every pan is a performance bug", () => {
	const WALL = 500;
	const disc = (center: [number, number]) => ({ center, radiusKm: 500 });
	const keyOf = (
		discs: { center: [number, number]; radiusKm: number }[],
		origins: readonly (readonly [number, number])[],
	) =>
		discs
			.filter((d) => discCouldRender(d, origins, WALL))
			.map((d) => `${d.center[0].toFixed(4)},${d.center[1].toFixed(4)}`)
			.sort()
			.join(";");

	const DISCS = [disc([-75.7, 45.4]), disc([-123.1, 49.3])];

	it("a small pan does NOT change the key — same discs, same array downstream", () => {
		const before = keyOf(DISCS, [[-75.7, 45.4]]);
		const after = keyOf(DISCS, [[-75.75, 45.45]]);
		expect(after).toBe(before);
		expect(before).not.toBe("");
	});

	it("crossing into a new disc's range DOES change the key", () => {
		const east = keyOf(DISCS, [[-75.7, 45.4]]);
		const west = keyOf(DISCS, [[-123.1, 49.3]]);
		expect(west).not.toBe(east);
	});

	it("key is order-independent — the same disc set never reads as two keys", () => {
		const a = keyOf(DISCS, [
			[-75.7, 45.4],
			[-123.1, 49.3],
		]);
		const b = keyOf([...DISCS].reverse(), [
			[-123.1, 49.3],
			[-75.7, 45.4],
		]);
		expect(b).toBe(a);
	});
});

describe("isFresh", () => {
	it("is fresh inside the TTL", () => {
		expect(isFresh(entry(T0, []), T0 + FIRE_TTL_MS - 1000)).toBe(true);
	});

	it("is stale past the TTL", () => {
		expect(isFresh(entry(T0, []), T0 + FIRE_TTL_MS + 1000)).toBe(false);
	});
});

describe("unionHotspots", () => {
	it("returns an honest empty state with a null timestamp", () => {
		const u = unionHotspots([]);
		expect(u.hotspots).toEqual([]);
		expect(u.oldestFetchedAt).toBeNull();
	});

	it("merges several areas into one list", () => {
		const u = unionHotspots([
			entry(T0, [spot(-75.6, 45.5)]),
			entry(T0, [spot(-79.4, 43.7)]),
		]);
		expect(u.hotspots).toHaveLength(2);
	});

	it("dedupes the same fire reported by two OVERLAPPING areas", () => {
		const u = unionHotspots([
			entry(T0, [spot(-75.6001, 45.5001, 10)]),
			entry(T0, [spot(-75.6002, 45.5002, 25)]),
		]);
		expect(u.hotspots).toHaveLength(1);
		expect(u.hotspots[0].frp).toBe(25);
	});

	it("reports the OLDEST fetch time, so a fresh area can't vouch for a stale one", () => {
		const stale = T0 - 48 * 3600_000;
		const u = unionHotspots([
			entry(T0, [spot(-75.6, 45.5)]),
			entry(stale, [spot(-79.4, 43.7)]),
		]);
		expect(u.oldestFetchedAt).toBe(stale);
	});

	it("flags degraded coverage when a satellite was missing", () => {
		expect(unionHotspots([entry(T0, [], 2)]).degraded).toBe(true);
		expect(unionHotspots([entry(T0, [], 3)]).degraded).toBe(false);
	});
});

describe("fireAgeLabel — safety copy, not a debug string", () => {
	it("says 'no fire data' for a null stamp rather than implying freshness", () => {
		expect(fireAgeLabel(null, T0)).toBe("no fire data");
	});

	it("reads in plain English across the ranges", () => {
		expect(fireAgeLabel(T0, T0 + 30_000)).toBe("just now");
		expect(fireAgeLabel(T0, T0 + 25 * 60_000)).toBe("25 min ago");
		expect(fireAgeLabel(T0, T0 + 3 * 3600_000)).toBe("3h ago");
		expect(fireAgeLabel(T0, T0 + 26 * 3600_000)).toBe("1 day ago");
		expect(fireAgeLabel(T0, T0 + 72 * 3600_000)).toBe("3 days ago");
	});

	it("never reports a negative age from clock skew", () => {
		expect(fireAgeLabel(T0, T0 - 60_000)).toBe("just now");
	});
});

describe("hotspotsToGeoJSON", () => {
	it("emits a FeatureCollection Mapbox can consume directly", () => {
		const fc = hotspotsToGeoJSON([spot(-75.6, 45.5, 3.2, T0, "high")]);
		expect(fc.type).toBe("FeatureCollection");
		expect(fc.features[0].geometry).toEqual({
			type: "Point",
			coordinates: [-75.6, 45.5],
		});
		expect(fc.features[0].properties).toEqual({ t: T0, c: "high", frp: 3.2 });
	});

	it("copies coordinates so a later mutation can't corrupt the GL source", () => {
		const h = spot(-75.6, 45.5);
		const fc = hotspotsToGeoJSON([h]);
		const coords = (fc.features[0].geometry as GeoJSON.Point).coordinates;
		expect(coords).not.toBe(h.coordinates);
	});

	it("handles an empty list", () => {
		expect(hotspotsToGeoJSON([]).features).toEqual([]);
	});
});

describe("superseded ground — newer evidence wins", () => {
	const HOUR = 3_600_000;
	const NOW = 1_800_000_000_000;
	const HARRISON: [number, number] = [-121.78, 49.3];

	const disc = (
		fetchedAt: number,
		centre: [number, number],
		hotspots: { coordinates: [number, number]; t: number; frp: number }[],
	) => ({
		cacheVersion: 3,
		fetchedAt,
		center: centre,
		radiusKm: 500,
		sourcesOk: 3,
		hotspots: hotspots.map((h) => ({ ...h, c: "nominal" as const })),
	});

	it("drops a day-old fire when a NEWER fetch covered that ground", () => {
		const stale = disc(NOW - 23.5 * HOUR, HARRISON, [
			{ coordinates: HARRISON, t: NOW - 23 * HOUR, frp: 12 },
		]);
		const fresh = disc(NOW, HARRISON, []);
		const { hotspots } = unionHotspots([stale, fresh]);
		expect(hotspots).toHaveLength(0);
	});

	it("KEEPS it when no newer fetch covered that ground", () => {
		const stale = disc(NOW - 23.5 * HOUR, HARRISON, [
			{ coordinates: HARRISON, t: NOW - 23 * HOUR, frp: 12 },
		]);
		const elsewhere = disc(NOW, [-79.4, 43.7], []);
		const { hotspots } = unionHotspots([stale, elsewhere]);
		expect(hotspots).toHaveLength(1);
	});

	it("keeps a fire the newest fetch DID report", () => {
		const fresh = disc(NOW, HARRISON, [
			{ coordinates: HARRISON, t: NOW - 20 * 60_000, frp: 40 },
		]);
		const { hotspots } = unionHotspots([fresh]);
		expect(hotspots).toHaveLength(1);
	});

	it("does not erase a fire detected just BEFORE the newest fetch", () => {
		const older = disc(NOW - HOUR, HARRISON, [
			{ coordinates: HARRISON, t: NOW - 10 * 60_000, frp: 30 },
		]);
		const fresh = disc(NOW, HARRISON, []);
		const { hotspots } = unionHotspots([older, fresh]);
		expect(hotspots).toHaveLength(1);
	});

	it("a stale disc cannot erase a fire from a FRESHER disc", () => {
		const fresh = disc(NOW, HARRISON, [
			{ coordinates: HARRISON, t: NOW - 30 * 60_000, frp: 55 },
		]);
		const stale = disc(NOW - 20 * HOUR, HARRISON, []);
		expect(unionHotspots([fresh, stale]).hotspots).toHaveLength(1);
		expect(unionHotspots([stale, fresh]).hotspots).toHaveLength(1);
	});
});

describe("coverage freshness — the light shape", () => {
	const cov = (fetchedAt: number) => ({
		center: [-75.7, 45.4] as [number, number],
		radiusKm: 500,
		fetchedAt,
	});

	it("matches isFresh's TTL boundary exactly", () => {
		const now = T0;
		expect(isCoverageFresh(cov(now - FIRE_TTL_MS + 1_000), now)).toBe(true);
		expect(isCoverageFresh(cov(now - FIRE_TTL_MS - 1_000), now)).toBe(false);
	});

	it("needs NO hotspots to answer", () => {
		expect(isCoverageFresh(cov(T0), T0)).toBe(true);
	});
});

describe("the phone's TTL — bounded by the edge, not by eagerness", () => {
	it("is long enough not to re-ask inside FIRMS' own refresh", () => {
		expect(FIRE_TTL_MS).toBeGreaterThanOrEqual(30 * 60 * 1000);
	});

	it("stays UNDER the edge cache's hour, so the two cannot compound", () => {
		expect(FIRE_TTL_MS).toBeLessThan(60 * 60 * 1000);
	});

	it("bounds what `Last checked` can read while ONLINE", () => {
		const worstCaseOnlineMs = FIRE_TTL_MS + 60 * 60 * 1000;
		expect(worstCaseOnlineMs).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
	});
});

// A cost budget: if these fail, the union loop went quadratic again. Do not raise the budget.
describe("unionHotspots stays cheap as the cache grows — the 119% CPU bug", () => {
	const NOW = 1_800_000_000_000;
	const HOUR = 3_600_000;

	/** Unique centres and positions that survive toFixed(3) dedupe, or the fixture silently collapses. */
	const scatter = (n: number, per: number): FireCacheEntry[] =>
		Array.from({ length: n }, (_, i) => {
			const centre: [number, number] = [
				-130 + Math.floor(i / 6),
				44 + (i % 6),
			];
			return {
				cacheVersion: 3,
				fetchedAt: NOW - i * HOUR,
				center: centre,
				radiusKm: 30,
				sourcesOk: 3,
				hotspots: Array.from({ length: per }, (_, j) => ({
					coordinates: [
						centre[0] + (j % 64) * 0.002,
						centre[1] + Math.floor(j / 64) * 0.002,
					] as [number, number],
					t: NOW - i * HOUR - 60_000,
					c: "nominal" as const,
					frp: 5 + (j % 20),
				})),
			};
		});

	/** Call count, never wall-clock time: a ms ratio is flaky by construction. */
	const countDistanceCalls = (entries: FireCacheEntry[]): number => {
		invalidateFireEntries();
		kmBetweenCalls = 0;
		unionHotspots(entries);
		return kmBetweenCalls;
	};

	it("scales LINEARLY in disc count — the cubic term is gone", () => {
		// 2.5× leaves room for legitimately overlapping boundary discs.
		const small = countDistanceCalls(scatter(15, 400));
		const large = countDistanceCalls(scatter(30, 400));
		expect(large / Math.max(small, 1)).toBeLessThan(2.5);
	});

	it("absorbs a realistic full cache without millions of trig calls", () => {
		const entries = scatter(30, 2_450);
		const hotspots = 30 * 2_450;
		const calls = countDistanceCalls(entries);
		expect(calls).toBeLessThan(hotspots * 2);
	});

	it("rejects far discs by box rather than by trigonometry", () => {
		// The scatter discs must not overlap, or the box pre-reject never fires.
		const [a, b] = scatter(2, 1);
		const apart = Math.hypot(
			(b.center[0] - a.center[0]) * 111 * Math.cos((a.center[1] * Math.PI) / 180),
			(b.center[1] - a.center[1]) * 111,
		);
		expect(apart).toBeGreaterThan(a.radiusKm + b.radiusKm);
	});

	it("still supersedes correctly at scale — speed must not cost truth", () => {
		// The pair sits well clear of the scatter grid or it would supersede noise.
		const ground: [number, number] = [-95, 52];
		const noise = scatter(25, 100);
		const stale: FireCacheEntry = {
			cacheVersion: 3,
			fetchedAt: NOW - 20 * HOUR,
			center: ground,
			radiusKm: 500,
			sourcesOk: 3,
			hotspots: [
				{ coordinates: ground, t: NOW - 19 * HOUR, c: "nominal", frp: 12 },
			],
		};
		const fresh: FireCacheEntry = {
			cacheVersion: 3,
			fetchedAt: NOW,
			center: ground,
			radiusKm: 500,
			sourcesOk: 3,
			hotspots: [],
		};
		invalidateFireEntries();
		const { hotspots } = unionHotspots([...noise, stale, fresh]);
		expect(hotspots).toHaveLength(25 * 100);
	});
});
