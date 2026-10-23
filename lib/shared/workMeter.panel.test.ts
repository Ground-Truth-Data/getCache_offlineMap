// The panel's numbers: a silent ask reds out after thirty seconds, a pin drop
// ignores other areas, work brackets add up once each, and the JSON snapshot
// carries all of it.
import { beforeEach, describe, expect, it, vi } from "vitest";

type M = typeof import("./workMeter.svelte");
let m: M;
beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers({ now: Date.UTC(2026, 9, 23, 12) });
	m = await import("./workMeter.svelte");
	return () => vi.useRealTimers();
});

describe("circuits", () => {
	it("give up after thirty seconds of silence, and a late arrival still un-errs", () => {
		m.noteCircuit("roads", "transit", "asking");
		m.noteCircuit("roads", "transit", "asking again");
		expect(m.circuitOf("roads")!.note).toBe("asking");
		vi.advanceTimersByTime(29_999);
		expect(m.light("roads").state).toBe("transit");
		vi.advanceTimersByTime(1);
		expect(m.circuitOf("roads")).toMatchObject({ state: "err", note: "nothing after 30s — gave up waiting" });
		m.noteCircuit("roads", "ok", "bytes");
		expect(m.light("roads")).toMatchObject({ state: "ok", transitMs: 30_000 });
		m.noteCircuit("roads", "transit");
		expect(m.light("roads").state).toBe("ok");
		m.noteCircuit("roads", "err", "disk full");
		expect(m.light("roads")).toMatchObject({ state: "err", transitMs: null });
	});

	it("an answered ask cancels its give-up timer", () => {
		m.noteCircuit("fires", "transit");
		m.noteCircuit("fires", "ok");
		vi.advanceTimersByTime(60_000);
		expect(m.circuitOf("fires")!.state).toBe("ok");
	});

	it("a pin drop clears every circle, kills pending timers and ignores notes from another area", () => {
		m.noteCircuit("a", "transit");
		m.resetCircuits("pin-1");
		vi.advanceTimersByTime(60_000);
		expect(m.allCircuits()).toEqual([]);
		expect(m.light(undefined)).toEqual({ state: "idle", transitMs: null });
		m.noteCircuit("a", "transit", "", "pin-0");
		expect(m.circuitOf("a")).toBeUndefined();
		m.noteCircuit("a", "transit", "", "pin-1");
		m.noteCircuit("b", "ok", "untagged");
		expect(m.allCircuits().map((c) => c.key)).toEqual(["a", "b"]);
		expect(m.circuitOf("b")!.askedAt).toBeNull();
	});

	it("probes remember reachability and survive a counter reset", () => {
		expect(m.probeOf("cloud")).toBeUndefined();
		m.noteProbe("cloud", false);
		m.noteCircuit("x", "ok");
		m.resetWorkStats();
		expect(m.probeOf("cloud")).toBe(false);
		expect(m.allCircuits()).toEqual([]);
	});
});

describe("work brackets", () => {
	it("count runs, last, max, total and errors; a second close is a no-op", () => {
		let t = 0;
		vi.spyOn(performance, "now").mockImplementation(() => t);
		const end = m.beginWork("bake");
		expect(m.workStats()[0]!.startedAt).toBe(Date.now());
		t = 40;
		end();
		end(true);
		const again = m.beginWork("bake");
		t = 60;
		again(true);
		expect(m.workStats()).toEqual([{ name: "bake", runs: 2, lastMs: 20, maxMs: 40, totalMs: 60, startedAt: null, errors: 1 }]);
		const inFlight = m.beginWork("bake");
		m.resetWorkStats();
		expect(m.workStats()[0]).toMatchObject({ runs: 0, totalMs: 0, errors: 0, startedAt: Date.now() });
		inFlight();
		expect(m.workStats()[0]!.runs).toBe(1);
	});
});

describe("meterSnapshot", () => {
	it("hands out work, focus, circuits with ISO stamps and transit time, and probes", () => {
		m.resetCircuits("pin-9");
		m.noteCircuit("roads", "transit", "", "pin-9");
		vi.advanceTimersByTime(1500);
		m.noteCircuit("roads", "ok");
		m.noteCircuit("idle", "err", "boom");
		m.noteProbe("worker", true);
		m.beginWork("clip")();
		const snap = m.meterSnapshot();
		expect(snap.at).toBe("2026-10-23T12:00:01.500Z");
		expect(snap.focus).toBe("pin-9");
		expect(snap.work.map((w) => w.name)).toEqual(["clip"]);
		expect(snap.circuits[0]).toMatchObject({ key: "roads", askedAtIso: "2026-10-23T12:00:00.000Z", arrivedAtIso: "2026-10-23T12:00:01.500Z", transitMs: 1500 });
		expect(snap.circuits[1]).toMatchObject({ key: "idle", askedAtIso: null, arrivedAtIso: null, transitMs: null });
		expect(snap.probes).toEqual({ worker: true });
	});
});
