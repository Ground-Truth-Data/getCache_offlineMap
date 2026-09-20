import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k),
	clear: () => store.clear(),
});
vi.stubGlobal("location", { search: "" });

import {
	OFFLINE_MAP_ROUTE,
	ONLINE_MAP_ROUTE,
	isMapPath,
	loadLastMapRoute,
	resetLastMapRouteCache,
	saveLastMapRoute,
	seeOnMapUrl,
} from "./lastMapRoute.svelte";

const KEY = "retreever-last-map-route";

describe("lastMapRoute", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.stubGlobal("location", { search: "" });
		// the route is cached in a module-level cell seeded once — clearing storage alone doesn't clear it; resetLastMapRouteCache() must run too, or tests inherit state
		resetLastMapRouteCache();
	});

	describe("the default", () => {
		// The offline map is the only one with a store behind it — its host page
		// substitutes `mapPorts` AND the pin renderer's host. A device with no
		// stored choice landing on the online map drew no pins at all.
		it("opens the OFFLINE map when nothing is stored", () => {
			expect(loadLastMapRoute()).toBe(OFFLINE_MAP_ROUTE);
		});

		it("falls back to the default when the stored value is unrecognised", () => {
			// unknown stored route must be rejected, not trusted — handing it to goto would 404 the MAP tab
			localStorage.setItem(KEY, "/some-route-that-no-longer-exists");
			expect(loadLastMapRoute()).toBe(OFFLINE_MAP_ROUTE);
		});
	});

	describe("stickiness — the whole point", () => {
		it("returns the OFFLINE map after the offline route records itself", () => {
			saveLastMapRoute(OFFLINE_MAP_ROUTE);
			expect(loadLastMapRoute()).toBe(OFFLINE_MAP_ROUTE);
		});

		it("survives a round trip back to online", () => {
			saveLastMapRoute(OFFLINE_MAP_ROUTE);
			saveLastMapRoute(ONLINE_MAP_ROUTE);
			expect(loadLastMapRoute()).toBe(ONLINE_MAP_ROUTE);
		});

		it("ignores a route that is not one of the two maps", () => {
			saveLastMapRoute(OFFLINE_MAP_ROUTE);
			saveLastMapRoute("/app/cache" as never);
			expect(loadLastMapRoute()).toBe(OFFLINE_MAP_ROUTE);
		});
	});

	describe("seeOnMapUrl — every eye follows the sticky choice", () => {
		it("targets the default map, carrying its params", () => {
			const url = seeOnMapUrl({ map: "m1", feature: "f1" });
			expect(url).toBe(`${OFFLINE_MAP_ROUTE}?map=m1&feature=f1`);
		});

		it("targets the ONLINE map once online is the last-used one", () => {
			// regression lock: tapping an eye used to silently throw the user onto the other map mid-task
			saveLastMapRoute(ONLINE_MAP_ROUTE);
			const url = seeOnMapUrl({ map: "m1", plots: "a,b" });
			expect(url).toBe(`${ONLINE_MAP_ROUTE}?map=m1&plots=a%2Cb`);
		});

		it("encodes keys that contain URL-significant characters", () => {
			// URLSearchParams must not regress the encodeURIComponent behaviour the hand-rolled callers relied on
			const url = seeOnMapUrl({ map: "a b&c=d" });
			expect(url).toBe(`${OFFLINE_MAP_ROUTE}?map=a+b%26c%3Dd`);
		});

		it("accepts a URLSearchParams (the quality704 callers' shape)", () => {
			const q = new URLSearchParams();
			q.set("map", "m1");
			expect(seeOnMapUrl(q)).toBe(`${OFFLINE_MAP_ROUTE}?map=m1`);
		});

		it("returns a bare route when there are no params", () => {
			// quality704's empty param set (goToMapToDropPlot) must not produce a trailing "?"
			expect(seeOnMapUrl(new URLSearchParams())).toBe(OFFLINE_MAP_ROUTE);
			expect(seeOnMapUrl()).toBe(OFFLINE_MAP_ROUTE);
		});
	});

	describe("the sandbox world keeps its own choice", () => {
		it("does not let the practice world change the real app's MAP tab", () => {
			// ⚠️ localStorage is shared with ?sandbox=1 (key suffixed per world) — the sandbox must never decide the real app's map tab
			// The real world saves the NON-default route on purpose: if it held the
			// default, this would pass even with the worlds sharing one key.
			saveLastMapRoute(ONLINE_MAP_ROUTE);

			vi.stubGlobal("location", { search: "?sandbox=1" });
			saveLastMapRoute(OFFLINE_MAP_ROUTE);
			expect(loadLastMapRoute()).toBe(OFFLINE_MAP_ROUTE);

			vi.stubGlobal("location", { search: "" });
			expect(loadLastMapRoute()).toBe(ONLINE_MAP_ROUTE);
		});
	});

	describe("isMapPath — which paths light the MAP tab", () => {
		it("is true for BOTH map routes", () => {
			// regression: the routes are siblings, so a generic startsWith(href) tab-bar test went dark on the offline map (no tab lit)
			expect(isMapPath(ONLINE_MAP_ROUTE)).toBe(true);
			expect(isMapPath(OFFLINE_MAP_ROUTE)).toBe(true);
		});

		it("is true for sub-paths and query-bearing paths", () => {
			expect(isMapPath("/app/map/gdal")).toBe(true);
		});

		it("is false for the other tabs", () => {
			expect(isMapPath("/app/cache")).toBe(false);
			expect(isMapPath("/app/quality704")).toBe(false);
			expect(isMapPath("/app/stats")).toBe(false);
			expect(isMapPath("/app/inbox")).toBe(false);
		});
	});
});
