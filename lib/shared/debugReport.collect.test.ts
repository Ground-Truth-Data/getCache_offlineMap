// The export button's file: every legend row says whether its download is
// idle, out, broken or on disk and for how long; the heap and summary come
// from the readings passed in; the JSON is one line per flat object.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEBUG_REPORT_SCHEMA, HEAP_NOTE, collectFocusedBlobReport, compactJson, debugReportFilename } from "./debugReport";
import { noteCircuit, noteProbe, resetCircuits } from "./workMeter.svelte";
import { LAYER_TOGGLES } from "../onPhone/render/wallLegend";

beforeEach(() => {
	vi.useFakeTimers({ now: Date.UTC(2026, 9, 23, 12) });
	resetCircuits();
});
afterEach(() => vi.useRealTimers());

const row = (r: Awaited<ReturnType<typeof collectFocusedBlobReport>>, key: string) => r.layers.find((l) => l.key === key)!;

describe("collectFocusedBlobReport", () => {
	it("with nothing asked, every row is idle and the summary says the map drew from disk", async () => {
		const r = await collectFocusedBlobReport();
		expect(r.schema).toBe(DEBUG_REPORT_SCHEMA);
		expect(Object.keys(r)[0]).toBe("schema");
		expect(r.route).toBe("unknown");
		expect(r.capturedAt).toBe("2026-10-23T12:00:00.000Z");
		expect(r.heap).toEqual({ nowMb: null, lowMb: null, peakMb: null, sinceLoadMb: null, note: HEAP_NOTE });
		expect(r.env.devicePixelRatio).toBe(1);
		expect(r.layers.map((l) => l.key)).toEqual(LAYER_TOGGLES.map((t) => t.key));
		expect(row(r, "sat")).toMatchObject({ on: true, status: "idle", askedAt: null, reason: expect.stringContaining("not requested since this page loaded") });
		expect(row(r, "sat").expects).toContain("one satellite photo per pin");
		expect(row(r, "fires").expects).toContain("FIRE_RADIUS_KM");
		expect(row(r, "vector").expects).toContain("pack ships");
		expect(r.summary.timeToDownload).toContain("nothing downloaded since this page loaded");
		expect(r.summary.memory).toBe("no reading");
		expect(r.summary.workers).toBe("prod not checked · dev not checked · local not checked");
	});

	it("reports each feed's state, its transit time and the live panel readings", async () => {
		noteCircuit("sat", "transit");
		vi.advanceTimersByTime(2400);
		noteCircuit("sat", "ok", "1 photo");
		noteCircuit("pack", "transit");
		noteCircuit("fires", "err", "HTTP 503");
		vi.advanceTimersByTime(600);
		noteProbe("worker-cloud-prod", true);
		noteProbe("worker-local-dev", false);
		const r = await collectFocusedBlobReport({
			route: "offlinev10",
			heapNowMb: 50,
			heapAtLoadMb: 40,
			heapPeakMb: 61,
			heapLowMb: 39,
			layers: [{ key: "sat", on: false }],
		});
		expect(r.route).toBe("offlinev10");
		expect(r.heap).toMatchObject({ nowMb: 50, lowMb: 39, peakMb: 61, sinceLoadMb: 10 });
		expect(row(r, "sat")).toMatchObject({
			on: false,
			status: "ok",
			askedAt: "2026-10-23T12:00:00.000Z",
			arrivedAt: "2026-10-23T12:00:02.400Z",
			transitMs: 2400,
			reason: "on disk (1 photo) for 0.6s",
		});
		expect(row(r, "fires")).toMatchObject({ status: "err", reason: "fires download broke: HTTP 503" });
		const packRows = r.layers.filter((l) => l.feed === "pack");
		for (const p of packRows) expect(p.reason).toMatch(/pack request is out, nothing back yet|does not cover/);
		expect(r.summary.timeToDownload).toBe("satellite photo 2.4s (ask → bytes on disk, this session)");
		expect(r.summary.memory).toBe("50 MB now, peaked at 61 MB (main thread only)");
		expect(r.summary.workers).toBe("prod reachable · dev not checked · local not running");
		expect(r.meter.probes).toEqual({ "worker-cloud-prod": true, "worker-local-dev": false });
	});

	it("a broken feed with no note still says why", async () => {
		noteCircuit("fires", "err");
		expect(row(await collectFocusedBlobReport(), "fires").reason).toBe("fires download broke: no detail");
	});
});

describe("debugReportFilename", () => {
	it("is the capture time with no colon or dot in it", () => {
		expect(debugReportFilename(new Date(Date.UTC(2026, 9, 23, 7, 5, 9, 12)))).toBe("getcache-debug-2026-10-23T07-05-09-012Z.json");
		expect(debugReportFilename()).toBe("getcache-debug-2026-10-23T12-00-00-000Z.json");
	});
});

describe("compactJson", () => {
	it("puts a flat object or a flat array on one line and nests everything else", () => {
		expect(compactJson(7)).toBe("7");
		expect(compactJson([])).toBe("[]");
		expect(compactJson({})).toBe("{}");
		expect(compactJson([1, "a", null])).toBe('[1,"a",null]');
		expect(compactJson({ a: 1, b: [1, 2] })).toBe('{ "a": 1, "b": [1,2] }');
		expect(compactJson({ top: { a: 1 }, list: [{ x: 1 }, { y: [2] }] })).toBe(
			'{\n  "top": { "a": 1 },\n  "list": [\n    { "x": 1 },\n    { "y": [2] }\n  ]\n}',
		);
	});
});
