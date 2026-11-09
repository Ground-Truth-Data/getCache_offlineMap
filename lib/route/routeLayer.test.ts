// @vitest-environment happy-dom
// Directions as the planter sees them: the pill's words, the line, follow mode and the trip kept across a closed app.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapDouble } from "$gc/mapDouble";
import { distance } from "$gc/units.svelte";
import type { LngLat } from "../shared/kmGeo";
import type { RouteResult } from "./roadGraph";
import type { ToWorker } from "./routeWorker";
import { attachRouteLayer, directionsTo, distanceText, kmFromYou, networkTile, type RouteHandle, roadKm, searchTarget } from "./routeLayer";

const pinned = vi.hoisted(() => ({ at: null as unknown, el: null as HTMLElement | null }));
vi.mock("../shared/rendererOf", () => ({
	markerCtor: () =>
		class {
			constructor({ element }: { element: HTMLElement }) {
				pinned.el = element;
			}
			setLngLat(ll: unknown) {
				pinned.at = ll;
				return this;
			}
			addTo() {
				return this;
			}
			remove() {
				pinned.at = null;
			}
		},
}));
vi.mock("../worker/tilesHost", () => ({ tileUrl: (z: number, x: number, y: number) => `https://tiles.test/${z}/${x}/${y}.pbf` }));

// ~4.3 km due east along one road, a vertex every ~360 m.
const A: LngLat = [-119.28, 50.25];
const B: LngLat = [-119.22, 50.25];
const along = (a: LngLat, b: LngLat, n = 12): LngLat[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
const straight = (stops: LngLat[]): RouteResult => {
	const line = stops.slice(1).flatMap((s, i) => along(stops[i]!, s).slice(i ? 1 : 0));
	return { ok: true, line, legEnds: stops.slice(1).map((_, i) => 12 * (i + 1)), km: 4.27 * (stops.length - 1), offRoad: [] };
};

const asked: LngLat[][] = [];
let answer: (stops: LngLat[]) => RouteResult = straight;
class FakeWorker {
	onmessage: ((e: { data: unknown }) => void) | null = null;
	onerror: unknown = null;
	postMessage(m: ToWorker) {
		if (m.kind !== "route") return;
		asked.push(m.stops);
		const result = answer(m.stops);
		queueMicrotask(() => this.onmessage?.({ data: { kind: "done", job: m.job, result } }));
	}
}
vi.stubGlobal("Worker", FakeWorker);

const flush = () => new Promise((r) => setTimeout(r, 0));
let d: ReturnType<typeof mapDouble>;
let h: RouteHandle | null = null;
let fix: LngLat | null;
const attach = () => {
	h = attachRouteLayer(d.map, { readTile: async () => undefined, origin: () => fix, packChanged: () => () => {} });
	return h;
};
const pill = () => d.container.querySelector<HTMLElement>(".rt-route-pill")!;
const roles = () => ((d.sources.get("rt-route-geo") as { features?: { properties: { role: string } }[] })?.features ?? []).map((f) => f.properties.role);
const saved = () => JSON.parse(localStorage.getItem("gc.route.v1") ?? "null");

beforeEach(() => {
	d = mapDouble();
	(d.raw as unknown as { getBearing: () => number }).getBearing = () => 0;
	localStorage.clear();
	asked.length = 0;
	answer = straight;
	fix = A;
	distance.value = "metric";
});
afterEach(() => {
	h?.();
	h = null;
});

describe("distanceText", () => {
	it("prints one decimal under ten, whole numbers with commas above, in the planter's unit", () => {
		expect(distanceText(3.24)).toBe("3.2 km");
		expect(distanceText(12.6)).toBe("13 km");
		expect(distanceText(1234.4)).toBe("1,234 km");
		distance.value = "imperial";
		expect(distanceText(1.609344)).toBe("1.0 mi");
	});
});

describe("directions", () => {
	it("says to turn on location when there is no fix, and asks the router nothing", async () => {
		fix = null;
		attach().to(B);
		await flush();
		expect(pill().textContent).toContain("Turn on My location");
		expect(asked).toEqual([]);
	});

	it("draws the road and names its length with a Follow button", async () => {
		attach().to(B);
		await flush();
		expect(asked).toEqual([[A, B]]);
		expect(pill().textContent).toContain("4.3 km by road");
		expect(pill().querySelector(".rt-route-pill-go")?.textContent).toBe("Follow");
		expect(roles()).toContain("line");
	});

	it("shows no line and no pill when no road reaches", async () => {
		answer = () => ({ ok: false, reason: "no-road", crowKm: 4, missing: 0 });
		attach().to(B);
		await flush();
		expect(pill().hidden).toBe(true);
		expect(roles()).not.toContain("line");
	});

	it("clears the line and the kept trip from the pill's ✕", async () => {
		attach().to(B);
		await flush();
		expect(saved().ahead).toEqual([B]);
		pill().querySelector<HTMLButtonElement>(".rt-route-pill-x")!.click();
		expect(pill().hidden).toBe(true);
		expect(roles()).not.toContain("line");
		expect(saved()).toBeNull();
	});
});

describe("a trip kept across a closed app", () => {
	it("is saved off the map and solved from the fix when the map opens", async () => {
		directionsTo(B);
		attach();
		await flush();
		expect(asked).toEqual([[A, B]]);
		expect(pill().textContent).toContain("by road");
	});

	it("waits for the first fix when the map opens before the phone knows where it is", async () => {
		directionsTo(B);
		fix = null;
		attach();
		await flush();
		expect(asked).toEqual([]);
		h!.fix(...A);
		await flush();
		expect(asked).toEqual([[A, B]]);
	});

	it("keeps a search pin until it is tapped", () => {
		attach();
		searchTarget(B);
		expect(pinned.at).toEqual(B);
		expect(saved().target).toEqual(B);
		pinned.el!.click();
		expect(pinned.at).toBeNull();
		expect(saved()).toBeNull();
	});
});

describe("waypoints", () => {
	const press = (type: string, at: LngLat) => {
		const p = d.raw.project(at);
		d.fire(type, { point: p, lngLat: { lng: at[0], lat: at[1] }, originalEvent: new MouseEvent(type), preventDefault: vi.fn() });
	};
	const via: LngLat = [-119.25, 50.26];

	it("pulling the line off the road adds a stop the route goes through", async () => {
		attach().to(B);
		await flush();
		press("mousedown", [-119.25, 50.25]);
		press("mousemove", via);
		press("mouseup", via);
		await flush();
		expect(asked.at(-1)).toEqual([A, via, B]);
		expect(saved().ahead).toEqual([via, B]);
	});

	it("tapping a stop removes it", async () => {
		localStorage.setItem("gc.route.v1", JSON.stringify({ target: null, ahead: [via, B] }));
		attach();
		await flush();
		vi.mocked(d.raw.queryRenderedFeatures).mockReturnValueOnce([{ properties: { stop: 1 } }]);
		press("mousedown", via);
		press("mouseup", via);
		await flush();
		expect(asked.at(-1)).toEqual([A, B]);
	});
});

describe("follow mode", () => {
	const follow = async () => {
		attach().to(B);
		await flush();
		pill().querySelector<HTMLButtonElement>(".rt-route-pill-go")!.click();
	};

	it("counts down what is left as the truck drives the line", async () => {
		await follow();
		expect(pill().textContent).toContain("4.3 km left");
		h!.fix(-119.25, 50.25);
		expect(pill().textContent).toContain("2.1 km left");
		expect(roles()).toEqual(expect.arrayContaining(["done", "line", "me"]));
	});

	it("says arrived within 30 m of the end", async () => {
		await follow();
		h!.fix(B[0] - 0.0003, B[1]);
		expect(pill().textContent).toContain("You've arrived");
		expect(roles()).not.toContain("me");
	});

	it("re-routes from the truck only after three fixes off the road", async () => {
		await follow();
		const off: LngLat = [-119.25, 50.252];
		h!.fix(...off);
		h!.fix(...off);
		expect(asked).toHaveLength(1);
		h!.fix(...off);
		await flush();
		expect(asked.at(-1)).toEqual([off, B]);
	});

	it("keeps the old line when the re-route finds no road", async () => {
		await follow();
		answer = () => ({ ok: false, reason: "no-road", crowKm: 3, missing: 0 });
		for (let i = 0; i < 3; i++) h!.fix(-119.25, 50.252);
		await flush();
		expect(asked).toHaveLength(2);
		expect(roles()).toContain("line");
		expect(pill().hidden).toBe(false);
	});

	it("pauses when a hand moves the map", async () => {
		await follow();
		d.fire("dragstart", { originalEvent: new Event("touchstart") });
		expect(pill().querySelector(".rt-route-pill-go")?.textContent).toBe("Follow");
		expect(roles()).not.toContain("me");
	});
});

describe("roadKm", () => {
	it("is null with no fix anywhere", async () => {
		fix = null;
		expect(kmFromYou(B)).toBeNull();
		expect(await roadKm(B)).toBeNull();
	});

	it("asks the router once for a fix that wanders across the parking lot", async () => {
		const handle = attach();
		expect(await roadKm(B)).toBeCloseTo(4.27);
		handle.fix(A[0] + 0.0001, A[1]);
		expect(await roadKm(B)).toBeCloseTo(4.27);
		expect(asked).toHaveLength(1);
	});

	it("is null when no road reaches", async () => {
		answer = () => ({ ok: false, reason: "too-far", crowKm: 900, missing: 0 });
		attach();
		expect(await roadKm(B)).toBeNull();
	});
});

describe("networkTile", () => {
	it("reads a 204 as an empty tile and any failure as no tile", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
		expect((await networkTile("13/1/2"))?.byteLength).toBe(0);
		expect(fetch).toHaveBeenCalledWith("https://tiles.test/13/1/2.pbf");
		fetch.mockResolvedValueOnce(new Response("x", { status: 404 }));
		expect(await networkTile("13/1/2")).toBeUndefined();
		fetch.mockRejectedValueOnce(new TypeError("offline"));
		expect(await networkTile("13/1/2")).toBeUndefined();
		vi.unstubAllGlobals();
		vi.stubGlobal("Worker", FakeWorker);
	});
});
