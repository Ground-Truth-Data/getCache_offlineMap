import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
	const satStore = new Map<string, number>();
	const tiles = new Set<string>();
	const cov = new Map<string, Record<string, unknown>>();
	const budget = { bytes: 1_000_000_000 };
	const key = (lng: number, lat: number) =>
		`${lng.toFixed(4)},${lat.toFixed(4)}`;
	return {
		satStore,
		tiles,
		cov,
		budget,
		key,
		downloadV4Area: vi.fn(async (lng: number, lat: number) => {
			tiles.add(key(lng, lat));
			return { bytes: 1000, downloaded: 5 };
		}),
		bakeSatelliteImage: vi.fn(async (c: [number, number]) => {
			satStore.set(key(c[0], c[1]), 1000);
			return { blob: { size: 1000 }, bounds: [0, 0, 1, 1], bakeVersion: 3 };
		}),
		deleteSatImage: vi.fn(async (k: string) => void satStore.delete(k)),
		deleteVectorAt: vi.fn(async () => undefined),
		deleteFireCache: vi.fn(async () => undefined),
		getLiveFix: vi.fn(async (): Promise<[number, number] | null> => null),
		fetchAreaFires: vi.fn(async (_lng: number, _lat: number) => ({
			hotspots: [] as [],
			fetchedAt: 0,
			sourcesOk: 3,
			bytes: 0,
		})),
		fireArrivalOwed: true,
		fireRead: vi.fn(async (_key: string) => null as FireRecord | null),
	};
});

let features: Array<{
	geometry: { geometry: { type: string } } | null;
	overlayBounds: null;
	lastTouched: string;
	anchors: [number, number][];
}> = [];

vi.mock("../../worker/worker-local-dev/roads/packDownload", () => ({
	downloadV4Area: h.downloadV4Area,
	areaCentreCovered: vi.fn(async (lng: number, lat: number) =>
		h.tiles.has(h.key(lng, lat)),
	),
	areaTilesPresent: vi.fn(async (lng: number, lat: number) =>
		h.tiles.has(h.key(lng, lat)),
	),
	getAllTileKeys: vi.fn(async () => new Set(h.tiles)),
	areaTilesPresentIn: (_stored: Set<string>, lng: number, lat: number) =>
		h.tiles.has(h.key(lng, lat)),
	PACK_FORMAT_VERSION: 6,
	// Must mirror the real outer ring; a smaller one hides a containment regression.
	RINGS: [
		{ km: 3, z: 15 },
		{ km: 40, z: 12 },
	],
}));

vi.mock("../store/tombstones/purgeRoadRasters", () => ({
	purgeDeadRoadRasters: vi.fn(() => undefined),
}));

vi.mock("../offlineDownloadGate", () => ({
	checkDownloadGate: vi.fn(async () => false),
	isPerFeatureOnly: () => false,
	noteDownloadedBytes: () => undefined,
}));

vi.mock("../satellite/satelliteImage", () => ({
	bakeSatelliteImage: h.bakeSatelliteImage,
	getSatImageByKey: vi.fn(async (k: string) =>
		h.satStore.has(k)
			? {
					blob: { size: h.satStore.get(k) },
					bounds: [0, 0, 1, 1],
					bakeVersion: 3,
				}
			: undefined,
	),
	satImageKey: (c: [number, number]) => h.key(c[0], c[1]),
	BAKE_RADIUS_KM: 3,
	BAKE_VERSION: 3,
	deleteSatImage: h.deleteSatImage,
	getSatKeys: vi.fn(async () => [...h.satStore.keys()]),
	getAllSatImages: vi.fn(async () =>
		[...h.satStore.entries()].map(([key, size]) => ({
			key,
			img: { blob: { size }, bounds: [0, 0, 1, 1], bakeVersion: 3 },
		})),
	),
	// Omits blob so a pixel-reaching caller fails loudly.
	satImageMeta: vi.fn(async () =>
		[...h.satStore.entries()].map(([key, bytes]) => ({
			key,
			bytes,
			bakeVersion: 3,
		})),
	),
}));

vi.mock("../store/tombstones/legacyVectorCleanup", () => ({
	deleteVectorAt: h.deleteVectorAt,
	getVectorKeys: vi.fn(async () => []),
	getVectorFeaturesAt: vi.fn(async () => []),
}));

vi.mock("../store/coverageRegistry", () => ({
	allCoverage: async () => [...h.cov.values()],
	noteCoverage: async (
		areaKey: string,
		lng: number,
		lat: number,
		patch: Record<string, unknown>,
		_touch?: boolean,
		touchAt?: number,
	) => {
		const prev = h.cov.get(areaKey) ?? {};
		h.cov.set(areaKey, {
			...prev,
			areaKey,
			lng,
			lat,
			...patch,
			lastTouched: touchAt ?? prev.lastTouched ?? 0,
		});
	},
	dropCoverage: async (k: string) => void h.cov.delete(k),
	get OFFLINE_BUDGET_BYTES() {
		return h.budget.bytes;
	},
	EST_AREA_BYTES: 1000,
}));

import type {
	FireRecord,
	HostPorts,
} from "../../shared/hostPorts";
import { configureTilesHost } from "../../worker/worker-local-dev/tilesHost";
import { reconcileOnceForTest } from "./bakeService.svelte";

const testPorts: HostPorts = {
	places: () =>
		features.map((f) => ({
			anchors: f.anchors ?? [],
			lastTouched: f.lastTouched,
			corridor:
				f.geometry?.geometry?.type === "LineString" ||
				f.geometry?.geometry?.type === "MultiLineString",
		})),
	ready: () => true,
	onPlacesChanged: () => () => {},
	fires: {
		fetchArea: (lng, lat) => h.fetchAreaFires(lng, lat),
		arrival: () => {
			h.fireArrivalOwed = true;
		},
		takeArrival: () => {
			const owed = h.fireArrivalOwed;
			h.fireArrivalOwed = false;
			return owed;
		},
		read: (key: string) => h.fireRead(key),
		write: async () => undefined,
		delete: h.deleteFireCache,
		isFresh: () => false,
		coverage: async () => [],
		isCoverageFresh: () => false,
	},
	gps: () => h.getLiveFix(),
};

const point = (anchor: [number, number]) => ({
	geometry: { geometry: { type: "Point" } },
	overlayBounds: null as null,
	lastTouched: "2026-06-17T12:00:00Z",
	anchors: [anchor],
});
const pointAt = (anchor: [number, number], iso: string) => ({
	geometry: { geometry: { type: "Point" } },
	overlayBounds: null as null,
	lastTouched: iso,
	anchors: [anchor],
});
const line = (anchor: [number, number]) => ({
	geometry: { geometry: { type: "LineString" } },
	overlayBounds: null as null,
	lastTouched: "2026-06-17T12:00:00Z",
	anchors: [anchor],
});
/** A photo with no coverage record: the online map's shared cache, not ours to drop. */
function seedForeignPhoto(lng: number, lat: number): void {
	h.satStore.set(h.key(lng, lat), 1000);
}
/** A blob we baked (coverage record) whose pin is gone. */
function seedOrphan(lng: number, lat: number, lastTouched: number): void {
	const k = h.key(lng, lat);
	h.satStore.set(k, 1000);
	h.cov.set(k, {
		areaKey: k,
		lng,
		lat,
		bytes: 1000,
		hasPhoto: true,
		lastTouched,
	});
}

beforeEach(() => {
	configureTilesHost("https://tiles.example.test");
	h.satStore.clear();
	h.tiles.clear();
	h.cov.clear();
	h.budget.bytes = 1_000_000_000;
	features = [];
	h.downloadV4Area.mockClear();
	h.bakeSatelliteImage.mockClear();
	h.deleteSatImage.mockClear();
	h.deleteVectorAt.mockClear();
	h.getLiveFix.mockClear();
	h.getLiveFix.mockResolvedValue(null);
});

describe("offline tripwire 1 — bakes headlessly the moment a feature is touched", () => {
	it("a point feature → downloads tiles AND bakes a satellite for its anchor, with NO map", async () => {
		features = [point([10, 20])];
		await reconcileOnceForTest(testPorts);
		expect(h.downloadV4Area).toHaveBeenCalledWith(10, 20, undefined, false);
		expect(h.bakeSatelliteImage).toHaveBeenCalledWith([10, 20]);
	});

	it("a LINE feature → corridor (roads-only ribbon, NO satellite for the line anchor)", async () => {
		features = [line([30, 40])];
		await reconcileOnceForTest(testPorts);
		expect(h.downloadV4Area).toHaveBeenCalledWith(30, 40, undefined, true);
		expect(h.bakeSatelliteImage).not.toHaveBeenCalledWith([30, 40]);
	});
});

describe("offline tripwire 2 — a photo alone is NOT complete; roads are always fetched", () => {
	it("satellite present but tiles MISSING → STILL downloads the roads (never 'done' on the photo)", async () => {
		h.satStore.set(h.key(50, 60), 1000);
		features = [point([50, 60])];
		await reconcileOnceForTest(testPorts);
		expect(h.downloadV4Area).toHaveBeenCalledWith(50, 60, undefined, false);
	});

	it("BOTH present → zero work (no re-download, no re-probe churn)", async () => {
		h.satStore.set(h.key(50, 60), 1000);
		h.tiles.add(h.key(50, 60));
		features = [point([50, 60])];
		await reconcileOnceForTest(testPorts);
		expect(h.downloadV4Area).not.toHaveBeenCalledWith(50, 60, undefined, false);
	});
});

describe("offline ledger — the end-of-pass mirror must not zero what the pass just wrote", () => {
	it("an area downloaded DURING a pass keeps its lineBytes/lineCount", async () => {
		features = [point([70, 80])];
		await reconcileOnceForTest(testPorts);
		const rec = h.cov.get(h.key(70, 80));
		expect(rec?.lineBytes).toBe(1000);
		expect(rec?.lineCount).toBe(5);
	});

	it("a photo baked DURING a pass keeps its photoBytes", async () => {
		features = [point([71, 81])];
		await reconcileOnceForTest(testPorts);
		expect(h.cov.get(h.key(71, 81))?.photoBytes).toBe(1000);
	});
});

describe("offline tripwire — ONE pass has a TIME BUDGET", () => {
	/** mockClear() resets calls but not the implementation, so it is restored by hand. */
	async function passWithSlowDownloads(msPerArea: number): Promise<number> {
		let clock = 0;
		const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
		h.downloadV4Area.mockImplementation(async (lng: number, lat: number) => {
			clock += msPerArea;
			h.tiles.add(h.key(lng, lat));
			return { bytes: 1000, downloaded: 5 };
		});
		try {
			await reconcileOnceForTest(testPorts);
			return h.downloadV4Area.mock.calls.length;
		} finally {
			nowSpy.mockRestore();
			h.downloadV4Area.mockImplementation(
				async (lng: number, lat: number) => {
					h.tiles.add(h.key(lng, lat));
					return { bytes: 1000, downloaded: 5 };
				},
			);
		}
	}

	it("stops early instead of walking every area when the slice is used up", async () => {
		features = Array.from({ length: 12 }, (_, i) => point([100 + i, 60]));
		const n = await passWithSlowDownloads(2000);
		expect(n).toBeGreaterThan(0);
		expect(n).toBeLessThan(12);
	});

	it("ALWAYS lands at least one area, however slow the device", async () => {
		features = [point([200, 60]), point([201, 60])];
		const n = await passWithSlowDownloads(60_000);
		expect(n).toBe(1);
	});
});

describe("offline tripwire 3 — a deleted pin takes its blob; foreign photos are never touched under budget", () => {
	it("a blob WE baked whose pin is gone is dropped on the next pass, even under budget", async () => {
		seedOrphan(99, 99, 1);
		features = [];
		await reconcileOnceForTest(testPorts);
		expect(h.deleteSatImage).toHaveBeenCalledWith(h.key(99, 99));
		expect(h.satStore.has(h.key(99, 99))).toBe(false);
	});
	it("a photo with no coverage record (online map's cache) survives every pass while under budget", async () => {
		seedForeignPhoto(98, 98);
		features = [];
		await reconcileOnceForTest(testPorts);
		expect(h.deleteSatImage).not.toHaveBeenCalled();
		expect(h.satStore.has(h.key(98, 98))).toBe(true);
	});
	it("a blob is NOT an orphan while the host is still hydrating", async () => {
		seedOrphan(97, 97, 1);
		features = [];
		await reconcileOnceForTest({ ...testPorts, ready: () => false });
		expect(h.deleteSatImage).not.toHaveBeenCalled();
	});
});

describe("offline tripwire 3b — a kept pin gets BOTH halves; roads top up a photo-only pin", () => {
	it("within budget, a pin with a photo but no roads STILL downloads its roads", async () => {
		h.satStore.set(h.key(70, 80), 1000);
		features = [point([70, 80])];
		await reconcileOnceForTest(testPorts);
		expect(h.downloadV4Area).toHaveBeenCalledWith(70, 80, undefined, false);
	});
});

describe("offline tripwire 3c — a NEW pin gets its satellite even at the cap (displaces oldest)", () => {
	it("disk full of OLDER photos → the newest pin still bakes its photo; an old one is evicted", async () => {
		h.budget.bytes = 2000; // the new pin + one old one fit
		h.satStore.set(h.key(10, 10), 1000);
		h.tiles.add(h.key(10, 10));
		h.satStore.set(h.key(11, 11), 1000);
		h.tiles.add(h.key(11, 11));
		features = [
			pointAt([20, 20], "2026-06-18T12:00:00Z"), // newest, no photo yet
			pointAt([10, 10], "2026-06-01T12:00:00Z"),
			pointAt([11, 11], "2026-05-01T12:00:00Z"), // oldest
		];
		await reconcileOnceForTest(testPorts);
		expect(h.bakeSatelliteImage).toHaveBeenCalledWith([20, 20]);
		expect(h.deleteSatImage).toHaveBeenCalledWith(h.key(11, 11));
	});
});

describe("offline tripwire 4 — over budget, oldest falls off, newest survives", () => {
	it("the milk-shelf conveyor: only the oldest-touched blob is dropped", async () => {
		h.budget.bytes = 1500; // one(1000) ≤ 1500 < two(2000)
		h.satStore.set(h.key(11, 11), 1000);
		h.tiles.add(h.key(11, 11));
		h.satStore.set(h.key(22, 22), 1000);
		h.tiles.add(h.key(22, 22));
		features = [
			pointAt([22, 22], "2026-06-18T12:00:00Z"),
			pointAt([11, 11], "2026-05-01T12:00:00Z"),
		];
		await reconcileOnceForTest(testPorts);
		expect(h.deleteSatImage).toHaveBeenCalledWith(h.key(11, 11));
		expect(h.deleteSatImage).not.toHaveBeenCalledWith(h.key(22, 22));
		expect(h.satStore.has(h.key(22, 22))).toBe(true);
	});

	it("a blob is ONE unit — eviction drops the photo AND the roads together (same areaKey)", async () => {
		h.budget.bytes = 2500;
		seedOrphan(11, 11, 1);
		seedOrphan(22, 22, 100);
		features = [];
		await reconcileOnceForTest(testPorts);
		expect(h.deleteSatImage).toHaveBeenCalledWith(h.key(11, 11));
		expect(h.deleteVectorAt).toHaveBeenCalledWith(h.key(11, 11));
	});

	it("fires ride along on eviction — an evicted area sheds its hotspots too", async () => {
		h.budget.bytes = 2500;
		seedOrphan(11, 11, 1);
		seedOrphan(22, 22, 100);
		features = [];
		await reconcileOnceForTest(testPorts);
		expect(h.deleteFireCache).toHaveBeenCalledWith(h.key(11, 11));
	});
});

describe("offline tripwire 6 — an active user with location gets covered, feature or not", () => {
	it("a user standing NOWHERE NEAR a feature bakes a blob at their position", async () => {
		h.getLiveFix.mockResolvedValue([100, 60]);
		await reconcileOnceForTest(testPorts);
		expect(h.bakeSatelliteImage).toHaveBeenCalledWith([100, 60]);
	});

	// The demo blob bakes every pass, so assertions name a coordinate rather than count calls.
	const bakedAt = (c: [number, number]): boolean =>
		h.bakeSatelliteImage.mock.calls.some(
			([arg]) => arg[0] === c[0] && arg[1] === c[1],
		);

	it("does NOT bake anything extra when location is off", async () => {
		h.getLiveFix.mockResolvedValue(null);
		features = [point([10, 20])];
		await reconcileOnceForTest(testPorts);
		expect(bakedAt([10, 20])).toBe(true);
		const nearPin = h.bakeSatelliteImage.mock.calls.filter(
			([arg]) => Math.abs(arg[1] - 20) < 1 && Math.abs(arg[0] - 10) < 1,
		);
		expect(nearPin).toHaveLength(1);
	});

	it("does NOT re-bake for a user standing beside their own pin", async () => {
		features = [point([10, 20])];
		h.getLiveFix.mockResolvedValue([10.0001, 20.0001]); // ~11 m away
		await reconcileOnceForTest(testPorts);
		expect(bakedAt([10, 20])).toBe(true);
		expect(bakedAt([10.0001, 20.0001])).toBe(false);
	});

	it("does not re-bake while pacing a block all day", async () => {
		features = [point([10, 20])];
		await reconcileOnceForTest(testPorts);
		for (const dLat of [0.001, 0.003, 0.006, 0.009]) {
			h.bakeSatelliteImage.mockClear();
			h.getLiveFix.mockResolvedValue([10, 20 + dLat]);
			await reconcileOnceForTest(testPorts);
			expect(bakedAt([10, 20 + dLat])).toBe(false);
		}
	});

	it("DOES bake once the user leaves coverage", async () => {
		features = [point([10, 20])];
		h.getLiveFix.mockResolvedValue([10, 20.5]); // ~55 km north
		await reconcileOnceForTest(testPorts);
		expect(h.bakeSatelliteImage).toHaveBeenCalledWith([10, 20.5]);
	});

	it("fetches fires at the SNAPPED position, never the raw fix", async () => {
		h.fetchAreaFires.mockClear();
	h.fireRead.mockClear();
	h.fireRead.mockResolvedValue(null);
		h.getLiveFix.mockResolvedValue([-123.0694, 49.2643]);
		await reconcileOnceForTest(testPorts);
		const rawCall = vi
			.mocked(h.fetchAreaFires)
			.mock.calls.some(([lng, lat]) => lng === -123.0694 && lat === 49.2643);
		expect(rawCall).toBe(false);
		expect(h.fetchAreaFires).toHaveBeenCalledWith(-123, 49.25);
	});

	it("a failing geolocation read never aborts the pass", async () => {
		h.getLiveFix.mockRejectedValueOnce(new Error("geolocation exploded"));
		features = [point([10, 20])];
		await reconcileOnceForTest(testPorts);
		expect(h.bakeSatelliteImage).toHaveBeenCalledWith([10, 20]);
	});
});

describe("offline tripwire 7 — fires are PERISHABLE and must keep refreshing", () => {
	it("refreshes fires for an area whose photo and tiles are ALREADY on disk", async () => {
		h.fetchAreaFires.mockClear();
	h.fireRead.mockClear();
	h.fireRead.mockResolvedValue(null);
		h.satStore.set(h.key(10, 20), 1000);
		h.tiles.add(h.key(10, 20));
		features = [point([10, 20])];
		await reconcileOnceForTest(testPorts);
		const rebakedPin = h.bakeSatelliteImage.mock.calls.some(
			([arg]) => arg[0] === 10 && arg[1] === 20,
		);
		expect(rebakedPin).toBe(false);
		expect(h.fetchAreaFires).toHaveBeenCalledWith(10, 20);
	});
});

describe("offline tripwire 5 — the fire layer can never break the map", () => {
	it("a THROWING fire cache does not abort the area (satellite + tiles still run)", async () => {
		h.fireRead.mockRejectedValueOnce(
			new ReferenceError("indexedDB is not defined"),
		);
		h.budget.bytes = 2500;
		seedOrphan(11, 11, 1);
		features = [pointAt([20, 20], "2026-06-18T12:00:00Z")];
		await reconcileOnceForTest(testPorts);
		expect(h.bakeSatelliteImage).toHaveBeenCalledWith([20, 20]);
		expect(h.deleteSatImage).toHaveBeenCalledWith(h.key(11, 11));
	});
});

describe("offline tripwire — a completed area is NEVER re-downloaded", () => {
	it("second pass does NOT re-download an area whose tiles are already on disk", async () => {
		features = [point([10, 20])];
		await reconcileOnceForTest(testPorts);
		expect(h.downloadV4Area).toHaveBeenCalledWith(10, 20, undefined, false);

		h.downloadV4Area.mockClear();
		await reconcileOnceForTest(testPorts);
		expect(h.downloadV4Area).not.toHaveBeenCalled();
	});

	it("stays quiet across MANY passes (the 20 s tick ran forever in the bug)", async () => {
		features = [point([11, 21])];
		await reconcileOnceForTest(testPorts);
		h.downloadV4Area.mockClear();
		for (let pass = 0; pass < 5; pass++) await reconcileOnceForTest(testPorts);
		expect(h.downloadV4Area).not.toHaveBeenCalled();
	});

	it("the ledger AGREES with the disk after a pass (hasLines true when tiles exist)", async () => {
		features = [point([12, 22])];
		await reconcileOnceForTest(testPorts);
		const rec = h.cov.get(h.key(12, 22));
		expect(rec).toBeTruthy();
		expect(h.tiles.has(h.key(12, 22))).toBe(true);
		expect(rec?.hasLines).toBe(true);
	});

	it("still re-downloads when the tiles are genuinely GONE (self-heal intact)", async () => {
		features = [point([13, 23])];
		await reconcileOnceForTest(testPorts);
		h.downloadV4Area.mockClear();
		h.tiles.delete(h.key(13, 23));
		await reconcileOnceForTest(testPorts);
		expect(h.downloadV4Area).toHaveBeenCalledWith(13, 23, undefined, false);
	});
});
