import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ url: "https://tiles.example.test/fires" as string | null }));
vi.mock("../tilesHost", () => ({ firesUrl: () => host.url }));
vi.mock("../../onPhone/store/downloadGuard", () => ({ guardPackDownload: () => {} }));

import { fetchAreaFires } from "./fireFetch";

const point = (coordinates: unknown, properties: Record<string, unknown>) => ({ type: "Feature", geometry: { type: "Point", coordinates }, properties });
const reply = (body: unknown, headers: Record<string, string> = {}, status = 200) => {
	const fetch = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers }));
	vi.stubGlobal("fetch", fetch);
	return fetch;
};
const fc = (features: unknown[]) => ({ type: "FeatureCollection", features });

beforeEach(() => {
	host.url = "https://tiles.example.test/fires";
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("fetchAreaFires", () => {
	it("asks the Worker for the disc, its radius rounded to whole km", async () => {
		const fetch = reply(fc([]));
		await fetchAreaFires(-119.5, 49.2, 312.6);
		expect(fetch).toHaveBeenCalledWith("https://tiles.example.test/fires?lng=-119.5&lat=49.2&km=313", expect.objectContaining({ signal: expect.any(AbortSignal) }));
	});

	it("every failure throws, because an empty list would read as no fires near you", async () => {
		host.url = null;
		const fetch = reply(fc([]));
		await expect(fetchAreaFires(0, 0)).rejects.toThrow("no tiles host configured");
		expect(fetch).not.toHaveBeenCalled();
		host.url = "https://tiles.example.test/fires";
		reply("down", {}, 502);
		await expect(fetchAreaFires(0, 0)).rejects.toThrow("fires endpoint responded 502");
		reply("<html>");
		await expect(fetchAreaFires(0, 0)).rejects.toThrow("non-JSON body");
		reply({ type: "Feature", features: [] });
		await expect(fetchAreaFires(0, 0)).rejects.toThrow("malformed FeatureCollection");
		reply({ type: "FeatureCollection" });
		await expect(fetchAreaFires(0, 0)).rejects.toThrow("malformed FeatureCollection");
	});

	it("a Worker that never answers is given up on after 20 s", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("fetch", (_: string, init: RequestInit) => new Promise((_, no) => init.signal!.addEventListener("abort", () => no(new Error("aborted")))));
		const run = expect(fetchAreaFires(0, 0)).rejects.toThrow("aborted");
		await vi.advanceTimersByTimeAsync(20_000);
		await run;
	});

	it("keeps each hotspot's own claims and never invents one: unknown pixel size stays unknown, a bad day/night is dropped", async () => {
		reply(
			fc([
				point([-119, 49], { t: 1000, c: "high", frp: 12.5, px: 0, dn: "N", f: "fire-1" }),
				point([-118, 48], { t: 2000, c: "weird", frp: "x", dn: "dusk" }),
				point([-117, 47], { t: 3000, c: "nominal", n: 4, f: "fire-2" }),
				point([-116, 46], { t: 4000, n: 2, a: 7.5, t0: 100, p: [[1, 2]] }),
			]),
		);
		const { hotspots } = await fetchAreaFires(0, 0);
		expect(hotspots).toEqual([
			{ coordinates: [-119, 49], t: 1000, c: "high", frp: 12.5, px: 0, dn: "N", f: "fire-1" },
			{ coordinates: [-118, 48], t: 2000, c: "low", frp: 0 },
			{ coordinates: [-117, 47], t: 3000, c: "nominal", frp: 0, f: "fire-2", n: 4, a: 0, t0: 3000, p: [] },
			{ coordinates: [-116, 46], t: 4000, c: "low", frp: 0, n: 2, a: 7.5, t0: 100, p: [[1, 2]] },
		]);
	});

	it("skips a point with no place, a broken place or no time", async () => {
		reply(
			fc([
				point(undefined, { t: 1 }),
				point([1, 2, 3], { t: 1 }),
				point([null, 2], { t: 1 }),
				point([1, "2"], { t: 1 }),
				point([1, 2], {}),
				point([1, 2], { t: "5" }),
				{ type: "Feature" },
				point([1, 2], { t: 5 }),
			]),
		);
		const { hotspots } = await fetchAreaFires(0, 0);
		expect(hotspots.map((h) => h.coordinates)).toEqual([[1, 2]]);
	});

	it("an outline needs its fire's id and a ring; it is never also a hotspot", async () => {
		const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
		reply(
			fc([
				{ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { f: "fire-1", t: 1 } },
				{ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { t: 1 } },
				{ type: "Feature", geometry: { type: "Polygon", coordinates: "x" }, properties: { f: "fire-2" } },
				{ type: "Feature", geometry: { type: "Polygon" }, properties: { f: "fire-3" } },
			]),
		);
		const r = await fetchAreaFires(0, 0);
		expect(r.outlines).toEqual([{ f: "fire-1", ring }]);
		expect(r.hotspots).toEqual([]);
	});

	it("radius, time and satellites come from the Worker's headers, else what was asked, now, and all three", async () => {
		const body = JSON.stringify(fc([]));
		reply(body, { "X-Radius-Km": "180", "X-Fetched-At": "1700000000000", "X-Sources-Ok": "2" });
		expect(await fetchAreaFires(0, 0, 400)).toEqual({ hotspots: [], outlines: [], radiusKm: 180, fetchedAt: 1700000000000, sourcesOk: 2, bytes: body.length });
		vi.useFakeTimers({ now: 1234, toFake: ["Date"] });
		reply(body, { "X-Radius-Km": "0", "X-Fetched-At": "soon", "X-Sources-Ok": "-1" });
		expect(await fetchAreaFires(0, 0, 400)).toMatchObject({ radiusKm: 400, fetchedAt: 1234, sourcesOk: 3 });
		reply(body);
		expect(await fetchAreaFires(0, 0, 400)).toMatchObject({ radiusKm: 400, fetchedAt: 1234, sourcesOk: 3 });
	});
});
