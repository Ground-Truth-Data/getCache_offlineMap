import { describe, expect, it, vi } from "vitest";
import { directRoute, fetchRoute } from "./routeFetch";
import type { LngLat } from "./routeContract";

const PENTICTON: LngLat = [-119.5937, 49.4991];
const UP_THE_ROAD: LngLat = [-119.61, 49.55];
const NOW = 1_757_000_000_000;
const now = () => NOW;

function reply(body: unknown, ok = true): typeof fetch {
	return vi.fn(async () => ({
		ok,
		status: ok ? 200 : 500,
		json: async () => body,
	})) as unknown as typeof fetch;
}

describe("asking a router for the way there", () => {
	it("returns the road line the router sent", async () => {
		const fetchFn = reply({
			code: "Ok",
			routes: [
				{
					geometry: "w|dl}AfmlbcFgyg@vhK_ry@~oR",
					distance: 8123.4,
					duration: 900.6,
				},
			],
		});
		const r = await fetchRoute(PENTICTON, UP_THE_ROAD, {
			token: "pk.test",
			fetchFn,
			now,
		});
		expect(r.kind).toBe("road");
		expect(r.coordinates).toHaveLength(3);
		expect(r.metres).toBe(8123);
		expect(r.seconds).toBe(901);
		expect(r.fetchedAt).toBe(NOW);
	});

	it("stamps fetchedAt on every route — a line with no age cannot be told from a live one", async () => {
		const fetchFn = reply({ routes: [{ geometry: "w|dl}AfmlbcFgyg@vhK_ry@~oR" }] });
		const r = await fetchRoute(PENTICTON, UP_THE_ROAD, {
			token: "pk.test",
			fetchFn,
			now,
		});
		expect(r.fetchedAt).toBe(NOW);
	});

	it("falls back to the straight line when the router has no road — the bush case, not an error", async () => {
		const fetchFn = reply({ code: "NoRoute", routes: [] });
		const r = await fetchRoute(PENTICTON, UP_THE_ROAD, {
			token: "pk.test",
			fetchFn,
			now,
			toName: "Cutblock 7",
		});
		expect(r.kind).toBe("direct");
		expect(r.coordinates).toEqual([PENTICTON, UP_THE_ROAD]);
		expect(r.seconds).toBeNull();
		expect(r.toName).toBe("Cutblock 7");
	});

	it("a route of one point is no route — it falls back rather than drawing a dot", async () => {
		const fetchFn = reply({ routes: [{ geometry: "_izlhA~rlgdF" }] });
		const r = await fetchRoute(PENTICTON, UP_THE_ROAD, {
			token: "pk.test",
			fetchFn,
			now,
		});
		expect(r.kind).toBe("direct");
	});

	it("throws when the ASK failed — that is not a bush case, the driver must retry in range", async () => {
		const fetchFn = reply({}, false);
		await expect(
			fetchRoute(PENTICTON, UP_THE_ROAD, { token: "pk.test", fetchFn, now }),
		).rejects.toThrow("directions HTTP 500");
	});

	it("asks in lng,lat order and never puts the token in the path", async () => {
		const fetchFn = reply({ routes: [] });
		await fetchRoute(PENTICTON, UP_THE_ROAD, {
			token: "pk.test",
			fetchFn,
			now,
		});
		const url = (fetchFn as unknown as { mock: { calls: string[][] } }).mock
			.calls[0][0];
		expect(url).toContain("-119.5937,49.4991;-119.61,49.55");
		expect(url).toContain("geometries=polyline6");
		expect(url).toContain("access_token=pk.test");
	});
});

describe("the straight line", () => {
	it("measures real ground, not degrees", () => {
		const r = directRoute(PENTICTON, UP_THE_ROAD, { now });
		// ~5.9 km up the valley — a degree count would read 0.06.
		expect(r.metres).toBeGreaterThan(5_000);
		expect(r.metres).toBeLessThan(7_000);
	});
});
