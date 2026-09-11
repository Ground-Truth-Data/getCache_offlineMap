import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDirections, RouteError, routeAsFeature } from "./routeService";
import type { LngLat, Route } from "./routeContract";

const PENTICTON: LngLat = [-119.5937, 49.4991];
const UP_THE_ROAD: LngLat = [-119.61, 49.55];
const NOW = 1_757_000_000_000;
const GEOM = "w|dl}AfmlbcFgyg@vhK_ry@~oR";

// The cache is IndexedDB; the service's contract with it is read/write, so the
// store itself is the seam, not the browser.
const disk = new Map<string, Route>();
vi.mock("./routeCache", () => ({
	routeKey: (to: LngLat) => `${to[0].toFixed(5)},${to[1].toFixed(5)}`,
	readRoute: async (to: LngLat) =>
		disk.get(`${to[0].toFixed(5)},${to[1].toFixed(5)}`) ?? null,
	writeRoute: async (r: Route) => {
		disk.set(`${r.to[0].toFixed(5)},${r.to[1].toFixed(5)}`, r);
	},
	deleteRoute: async () => {},
	allRoutes: async () => [...disk.values()],
}));

function reply(body: unknown, ok = true): typeof fetch {
	return vi.fn(async () => ({
		ok,
		status: ok ? 200 : 503,
		json: async () => body,
	})) as unknown as typeof fetch;
}

const good = () => reply({ routes: [{ geometry: GEOM, distance: 8123, duration: 900 }] });

beforeEach(() => disk.clear());

describe("directions, asked online and kept", () => {
	it("fetches while there is signal and says the answer is live", async () => {
		const { route, live } = await getDirections(PENTICTON, UP_THE_ROAD, {
			token: "pk.test",
			fetchFn: good(),
			now: () => NOW,
			onLine: () => true,
		});
		expect(live).toBe(true);
		expect(route.kind).toBe("road");
	});

	it("hands back the SAVED route when the radio is gone, and never calls it live", async () => {
		await getDirections(PENTICTON, UP_THE_ROAD, {
			token: "pk.test",
			fetchFn: good(),
			now: () => NOW,
			onLine: () => true,
		});

		const fetchFn = reply({});
		const { route, live } = await getDirections(PENTICTON, UP_THE_ROAD, {
			token: "pk.test",
			fetchFn,
			now: () => NOW + 4 * 3600_000,
			onLine: () => false,
		});

		expect(live).toBe(false);
		expect(fetchFn).not.toHaveBeenCalled();
		// The age is the driver's, not the moment they re-asked.
		expect(route.fetchedAt).toBe(NOW);
	});

	it("offline with nothing saved is the one dead end", async () => {
		await expect(
			getDirections(PENTICTON, UP_THE_ROAD, {
				token: "pk.test",
				fetchFn: reply({}),
				now: () => NOW,
				onLine: () => false,
			}),
		).rejects.toMatchObject({ reason: "offline-and-unsaved" });
	});

	it("a radio that drops mid-ask still yields the saved route, not an error", async () => {
		await getDirections(PENTICTON, UP_THE_ROAD, {
			token: "pk.test",
			fetchFn: good(),
			now: () => NOW,
			onLine: () => true,
		});

		// navigator.onLine still says true; the request itself dies.
		const dying = vi.fn(async () => {
			throw new Error("network");
		}) as unknown as typeof fetch;
		const { route, live } = await getDirections(PENTICTON, UP_THE_ROAD, {
			token: "pk.test",
			fetchFn: dying,
			now: () => NOW + 1000,
			onLine: () => true,
		});
		expect(live).toBe(false);
		expect(route.fetchedAt).toBe(NOW);
	});

	it("reports ask-failed when the network answered badly and nothing was saved", async () => {
		const err = await getDirections(PENTICTON, UP_THE_ROAD, {
			token: "pk.test",
			fetchFn: reply({}, false),
			now: () => NOW,
			onLine: () => true,
		}).catch((e) => e);
		expect(err).toBeInstanceOf(RouteError);
		expect(err.reason).toBe("ask-failed");
	});

	it("a re-ask to the same place replaces the stale line rather than keeping both", async () => {
		const opts = { token: "pk.test", onLine: () => true };
		await getDirections(PENTICTON, UP_THE_ROAD, {
			...opts,
			fetchFn: good(),
			now: () => NOW,
		});
		await getDirections(PENTICTON, UP_THE_ROAD, {
			...opts,
			fetchFn: good(),
			now: () => NOW + 86_400_000,
		});
		expect(disk.size).toBe(1);
		expect([...disk.values()][0].fetchedAt).toBe(NOW + 86_400_000);
	});
});

describe("the route as something the app can store", () => {
	it("is a LineString, which is what makes it bake its own corridor", () => {
		const f = routeAsFeature({
			from: PENTICTON,
			to: UP_THE_ROAD,
			coordinates: [PENTICTON, UP_THE_ROAD],
			kind: "road",
			metres: 8123,
			seconds: 900,
			fetchedAt: NOW,
			toName: "Cutblock 7",
		});
		expect(f.geometry.type).toBe("LineString");
		expect(f.properties?.name).toBe("Route to Cutblock 7");
		expect(f.properties?.routeFetchedAt).toBe(NOW);
	});
});
