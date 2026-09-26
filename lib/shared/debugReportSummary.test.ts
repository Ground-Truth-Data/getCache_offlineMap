/**
 * THE SUMMARY MUST SAY IN ENGLISH WHAT THE SECTIONS SAY IN FIELDS.
 *
 * summarizeFocusedReport is a pure derivation over a finished report — these
 * feed it canned reports (shaped on a real 31 Aug 2026 export) and check the
 * sentences a non-technical reader gets, especially the two states of
 * timeToDownload: measured this session vs served from disk.
 */
import { describe, expect, it } from "vitest";
import { summarizeFocusedReport, type FocusedBlobReport } from "./debugReport";

type Body = Omit<FocusedBlobReport, "summary">;

function cannedReport(overrides: Partial<Body> = {}): Body {
	const base = {
		schema: 1,
		capturedAt: "2026-08-31T16:42:06.700Z",
		route: "debug/map",
		env: {
			tilesHost: "https://tiles-prod.getcache.org",
			workerTarget: "worker-cloud-prod",
			blobTileZ: 8,
			gridRadiusKm: 30,
			userAgent: "test",
			devicePixelRatio: 2,
		},
		heap: { nowMb: 46, lowMb: 46, peakMb: 59, sinceLoadMb: -13, note: "" },
		layers: [
			layer("sat", "Satellite", "sat"),
			layer("vector", "Roads/water", "pack"),
			layer("labels", "Labels", "pack"),
			layer("fires", "Fires", "fires"),
		],
		meter: {
			at: "2026-08-31T16:42:06.700Z",
			work: [],
			focus: null,
			circuits: [],
			probes: { "worker-cloud-prod": true, "worker-cloud-dev": true, "worker-local-dev": false },
		},
		...overrides,
	};
	return base as unknown as Body;
}

function layer(key: string, label: string, feed: string, transitMs: number | null = null) {
	return {
		key,
		label,
		on: true,
		feed,
		status: "idle",
		askedAt: null,
		arrivedAt: null,
		transitMs,
		reason: "",
		expects: "",
	};
}

describe("summarizeFocusedReport", () => {
	it("reports download durations per feed when this session measured them", () => {
		const r = cannedReport({
			layers: [
				layer("sat", "Satellite", "sat", 912),
				layer("vector", "Roads/water", "pack", 1834),
				// second pack layer must NOT duplicate the pack feed's entry
				layer("labels", "Labels", "pack", 1834),
			],
		} as Partial<Body>);
		const s = summarizeFocusedReport(r);
		expect(s.timeToDownload).toBe(
			"satellite photo 0.9s · road pack 1.8s (ask → bytes on disk, this session)",
		);
	});

	it("says served-from-disk when nothing downloaded", () => {
		const s = summarizeFocusedReport(cannedReport());
		expect(s.timeToDownload).toContain("nothing downloaded since this page loaded");
	});

	it("reports the workers and memory in plain words", () => {
		const s = summarizeFocusedReport(cannedReport());
		expect(s.workers).toBe("prod reachable · dev reachable · local not running");
		expect(s.memory).toBe("46 MB now, peaked at 59 MB (main thread only)");
	});

	it("never claims NOT reachable for a tier that was simply not probed", () => {
		const r = cannedReport();
		(r.meter as { probes: Record<string, boolean> }).probes = {};
		const s = summarizeFocusedReport(r);
		expect(s.workers).toBe("prod not checked · dev not checked · local not checked");
	});
});
