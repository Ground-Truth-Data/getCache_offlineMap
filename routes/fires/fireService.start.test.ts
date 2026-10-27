// @vitest-environment happy-dom
// The app-wide fire pass: it runs at start, on coming back online, on coming
// to the front and when the app says a centre landed; it tells listeners
// each disc that lands, skips ground far from the user, sits out offline,
// and a dead feed pauses it for a minute.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	fetch: vi.fn(async (lng: number, lat: number) => ({ fetchedAt: Date.now(), sourcesOk: 2, bytes: 2048, hotspots: [{ coordinates: [lng, lat], t: 1, c: "h", frp: 1 }] })),
	writes: [] as string[],
}));
vi.mock("../../lib/worker/fires/fireFetch", () => ({ fetchAreaFires: h.fetch }));
vi.mock("./fireCache", () => ({
	readFireCache: async () => null,
	writeFireCache: async (k: string) => void h.writes.push(k),
	fireCoverage: async () => [],
	isCoverageFresh: () => true,
	isFresh: () => true,
}));

import { FIRE_RETRY_MS, onFires, refreshFires, startFireService } from "./fireService";

const PENTICTON: [number, number] = [-119.5937, 49.4991];
const SYDNEY: [number, number] = [151.2, -33.87];
const settle = () => vi.waitFor(() => expect(h.fetch.mock.calls.length).toBeGreaterThan(0));

let online = true;
beforeEach(() => {
	h.writes.length = 0;
	online = true;
	Object.defineProperty(navigator, "onLine", { get: () => online, configurable: true });
	vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
	vi.spyOn(console, "table").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("startFireService", () => {
	it("passes at start and on each wake-up signal, and only its first start owns shutdown", async () => {
		let landed: ((c?: readonly (readonly [number, number])[]) => void) | null = null;
		const offCentres = vi.fn();
		const heard = vi.fn();
		const off = onFires(heard);
		const stop = startFireService({
			centres: async () => [PENTICTON],
			onCentresChanged: (refresh) => ((landed = refresh), offCentres),
		});
		startFireService({ centres: () => [SYDNEY] })();
		await settle();
		expect(h.writes).toEqual(["-119.5937,49.4991"]);
		expect(heard).toHaveBeenCalledTimes(1);
		expect(console.groupCollapsed).toHaveBeenCalledWith(expect.stringContaining("1 disc, 0 fires + 1 hotspots near the centre, 2.0 KB uncompressed"));
		expect(console.groupCollapsed).toHaveBeenCalledWith(expect.stringContaining("1 on partial satellite coverage"));

		h.fetch.mockClear();
		landed!([SYDNEY]);
		await settle();
		expect(h.fetch).toHaveBeenCalledWith(...SYDNEY);

		h.fetch.mockClear();
		window.dispatchEvent(new Event("online"));
		await settle();
		h.fetch.mockClear();
		Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
		document.dispatchEvent(new Event("visibilitychange"));
		await settle();

		off();
		stop();
		expect(offCentres).toHaveBeenCalledTimes(1);
		h.fetch.mockClear();
		window.dispatchEvent(new Event("online"));
		await new Promise((r) => setTimeout(r, 10));
		expect(h.fetch).not.toHaveBeenCalled();
	});

	it("skips centres far from the user, and a failed refresh is only a warning", async () => {
		const stop = startFireService({ centres: () => Promise.reject(new Error("store gone")), here: () => [PENTICTON] });
		await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith("[fires] refresh failed", expect.any(Error)));
		h.fetch.mockClear();
		expect(await refreshFires([SYDNEY])).toBe(0);
		expect(h.fetch).not.toHaveBeenCalled();
		stop();
	});
});

describe("refreshFires", () => {
	it("does nothing offline, and a dead feed pauses the pass for a minute", async () => {
		online = false;
		expect(await refreshFires([PENTICTON])).toBe(0);
		online = true;
		h.fetch.mockRejectedValueOnce(new Error("503"));
		vi.useFakeTimers({ toFake: ["Date"] });
		expect(await refreshFires([[-100, 40]])).toBe(0);
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("pass paused 60s"), expect.any(Error));
		h.fetch.mockClear();
		expect(await refreshFires([[-90, 40]])).toBe(0);
		expect(h.fetch).not.toHaveBeenCalled();
		vi.setSystemTime(Date.now() + FIRE_RETRY_MS + 1);
		expect(await refreshFires([[-90, 40]])).toBe(1);
	});
});
