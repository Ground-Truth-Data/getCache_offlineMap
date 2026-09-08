import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = new Map<
	string,
	{ fetchedAt: number; center: [number, number] }
>();
const coverage: Array<{ center: [number, number]; fetchedAt: number }> = [];
const writes: Array<
	[string, { center: [number, number]; hotspots: unknown[] }]
> = [];

vi.mock("./fireCache", () => ({
	FIRE_TTL_MS: 5 * 60_000,
	readFireCache: async (k: string) => cache.get(k) ?? null,
	writeFireCache: async (
		k: string,
		e: { center: [number, number]; hotspots: unknown[] },
	) => {
		writes.push([k, e]);
	},
	fireCoverage: async () => coverage,
	isCoverageFresh: (c: { fetchedAt: number }) =>
		Date.now() - c.fetchedAt < 5 * 60_000,
	isFresh: (e: { fetchedAt: number }) => Date.now() - e.fetchedAt < 5 * 60_000,
}));
const { FIRE_RETRY_MS, fireKey, refreshFires } = await import("./fireService");
const { configureTilesHost, setWorkerTarget } = await import(
	"../../lib/worker/worker-local-dev/tilesHost"
);

const PENTICTON: [number, number] = [-119.5937, 49.4991];
const body = JSON.stringify({
	type: "FeatureCollection",
	features: [
		{
			type: "Feature",
			geometry: { type: "Point", coordinates: [-120.8, 48.4] },
			properties: { t: 1, c: "nominal", frp: 1.8 },
		},
	],
});
function ok(): Response {
	return new Response(body, {
		status: 200,
		headers: { "X-Fetched-At": "1000", "X-Sources-Ok": "3" },
	});
}

beforeEach(() => {
	// PIN THE TIER and give it a host — fetchAreaFires asks tilesHost() for the URL,
	// and nothing is baked in: an unconfigured tier answers null and it refuses.
	setWorkerTarget("worker-cloud-prod");
	configureTilesHost("https://tiles.example.test");
	cache.clear();
	coverage.length = 0;
	writes.length = 0;
	vi.useRealTimers();
});

describe("the fire pass", () => {
	it("a centre with no fresh disc fetches one, keyed and centred on the blob", async () => {
		const fetch = vi.fn(async () => ok());
		vi.stubGlobal("fetch", fetch);
		expect(await refreshFires([PENTICTON])).toBe(1);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(writes[0][0]).toBe(fireKey(...PENTICTON));
		expect(writes[0][1].center).toEqual(PENTICTON);
		expect(writes[0][1].hotspots).toHaveLength(1);
	});

	it("a fresh disc nearby covers the centre — nothing is fetched", async () => {
		const fetch = vi.fn(async () => ok());
		vi.stubGlobal("fetch", fetch);
		coverage.push({ center: [-119.4, 49.6], fetchedAt: Date.now() });
		expect(await refreshFires([PENTICTON])).toBe(0);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("a dead feed pauses the pass, then it tries again", async () => {
		vi.useFakeTimers();
		const fetch = vi.fn(async () => new Response("", { status: 502 }));
		vi.stubGlobal("fetch", fetch);
		expect(await refreshFires([PENTICTON])).toBe(0);
		expect(await refreshFires([PENTICTON])).toBe(0);
		expect(fetch).toHaveBeenCalledTimes(1);
		vi.setSystemTime(Date.now() + FIRE_RETRY_MS + 1);
		await refreshFires([PENTICTON]);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
