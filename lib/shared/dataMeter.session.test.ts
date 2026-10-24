// @vitest-environment happy-dom
// A running meter files each resource the browser fetched under its kind,
// skips Vite's own modules, banks the day in IndexedDB two seconds later,
// and a reload picks today's bytes and the past days back up.
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Meter = typeof import("./dataMeter.svelte");
let feed: (entries: Array<{ name: string; transferSize?: number }>) => void;
const clearResourceTimings = vi.fn();

class FakeObserver {
	constructor(cb: (l: { getEntries: () => unknown[] }) => void) {
		feed = (entries) => cb({ getEntries: () => entries });
	}
	observe = vi.fn();
	disconnect = vi.fn();
}

const day = (offset = 0) => {
	const d = new Date();
	d.setDate(d.getDate() + offset);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function load(): Promise<Meter> {
	vi.resetModules();
	return import("./dataMeter.svelte");
}

function readDb(): Promise<Array<{ day: string; kinds: Record<string, number> }>> {
	return new Promise((resolve) => {
		const req = indexedDB.open("rt-data-meter", 1);
		req.onsuccess = () => {
			const get = req.result.transaction("days").objectStore("days").getAll();
			get.onsuccess = () => (req.result.close(), resolve(get.result));
		};
	});
}

function seed(rows: Array<{ day: string; kinds: Record<string, number> }>): Promise<void> {
	return new Promise((resolve) => {
		const req = indexedDB.open("rt-data-meter", 1);
		req.onupgradeneeded = () => req.result.createObjectStore("days", { keyPath: "day" });
		req.onsuccess = () => {
			const tx = req.result.transaction("days", "readwrite");
			for (const r of rows) tx.objectStore("days").put(r);
			tx.oncomplete = () => (req.result.close(), resolve());
		};
	});
}

beforeEach(() => {
	vi.stubGlobal("PerformanceObserver", FakeObserver);
	performance.clearResourceTimings = clearResourceTimings;
	vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("a running meter", () => {
	it("counts by kind, drops cache hits and dev modules, and writes the day after two seconds", async () => {
		await seed([{ day: day(-1), kinds: { fires: 300 } }, { day: day(-3), kinds: { app: 100 } }, { day: day(-90), kinds: { app: 1 } }]);
		const meter = await load();
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		meter.noteBytes("fires", 999);
		expect(meter.todayTotal()).toBe(0);
		const stop = meter.startDataMeter();
		expect(meter.startDataMeter()()).toBeUndefined();
		// The 90-day-old row is still on disk until the first flush prunes it; the read never counts it.
		await vi.waitFor(() => expect(meter.pastDays()).toHaveLength(2));
		expect(meter.dailyAverage()).toEqual({ bytesPerDay: 200, days: 2 });
		expect(meter.pastDays()[0]!.day).toBe(day(-1));

		feed([
			{ name: "https://tiles-prod.getcache.org/fires?lng=1", transferSize: 400 },
			{ name: "https://tiles-prod.getcache.org/13/1/2.pbf", transferSize: 1000 },
			{ name: "https://tiles-prod.getcache.org/13/1/3.pbf", transferSize: 0 },
			{ name: `${location.origin}/fires/fireCache.ts`, transferSize: 50 },
			{ name: "https://x.org/thing" },
		]);
		meter.noteBytes("satellite", 250);
		meter.noteBytes("satellite", -5);
		expect(meter.todayBytes()).toEqual([
			{ kind: "map tiles", bytes: 1000 },
			{ kind: "fires", bytes: 400 },
			{ kind: "satellite", bytes: 250 },
		]);
		expect(meter.todayTotal()).toBe(1650);
		vi.advanceTimersByTime(30_000);
		expect(clearResourceTimings).toHaveBeenCalledTimes(1);
		vi.useRealTimers();

		await vi.waitFor(async () => expect((await readDb()).find((r) => r.day === day())?.kinds).toEqual({ "map tiles": 1000, fires: 400, satellite: 250 }), { timeout: 5000 });
		const kept = (await readDb()).map((r) => r.day);
		expect(kept).not.toContain(day(-90));
		const snap = meter.dataSnapshot();
		expect(snap.today).toEqual({ day: day(), total: 1650, kinds: { "map tiles": 1000, fires: 400, satellite: 250 } });
		expect(snap.daysRecorded).toBe(2);
		stop();
		meter.noteBytes("fires", 10);
		expect(meter.todayTotal()).toBe(1650);
	});

	it("a reload folds today's banked bytes back into the live count", async () => {
		await seed([{ day: day(), kinds: { app: 70, fires: 30 } }]);
		const meter = await load();
		expect(meter.dailyAverage()).toEqual({ bytesPerDay: 0, days: 0 });
		const stop = meter.startDataMeter();
		meter.noteBytes("app", 5);
		await vi.waitFor(() => expect(meter.todayTotal()).toBe(105));
		expect(meter.todayBytes()[0]).toEqual({ kind: "app", bytes: 75 });
		expect(meter.pastDays()).toEqual([]);
		stop();
	});

	it("banks yesterday into history when the date rolls over mid-session", async () => {
		const meter = await load();
		const stop = meter.startDataMeter();
		await vi.waitFor(() => expect(meter.pastDays()).toEqual([]));
		meter.noteBytes("app", 10);
		vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], now: Date.now() + 86_400_000 });
		meter.noteBytes("fires", 20);
		expect(meter.todayBytes()).toEqual([{ kind: "fires", bytes: 20 }]);
		expect(meter.pastDays()).toEqual([{ day: day(-1), kinds: { app: 10 } }]);
		stop();
	});
});
