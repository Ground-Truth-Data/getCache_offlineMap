/**
 * One JSON snapshot of the offline preview's live session. No app imports: live
 * readings arrive as a parameter (debugReport.portability.test.ts).
 */
import { BLOB_TILE_Z, GRID_RADIUS_KM } from "../contract/grid";
import {
	PACK_LAYER_NAMES,
	describePackLayer,
	packShips,
} from "../contract/packLayers";
import { circuitOf, light, meterSnapshot, type CircuitState } from "./workMeter.svelte";
import { LAYER_TOGGLES } from "../onPhone/render/wallLegend";
import {
	getWorkerTarget,
	tilesHost,
	type WorkerTarget,
} from "../worker/worker-local-dev/tilesHost";

/** Bump when a field's MEANING changes, so an old file is never misread as a new one. */
export const DEBUG_REPORT_SCHEMA = 1 as const;

export const HEAP_NOTE =
	"main thread only — workers NOT counted; see DevTools → Memory for the total";

/** Live readings the panel holds, passed IN so this module stays portable. */
export interface LivePanelState {
	route?: string;
	heapNowMb?: number | null;
	heapLowMb?: number | null;
	heapPeakMb?: number | null;
	heapAtLoadMb?: number | null;
	layers?: { key: string; on: boolean }[];
}

/** The live session — what the export button calls. */
export interface FocusedBlobReport {
	schema: typeof DEBUG_REPORT_SCHEMA;
	/** DERIVED from the sections below, never measured separately, so headline and detail agree. */
	summary: ReportSummary;
	capturedAt: string;
	route: string;
	env: {
		/** "(unconfigured)" when no app called configureTilesHost(). */
		tilesHost: string;
		workerTarget: WorkerTarget;
		blobTileZ: number;
		gridRadiusKm: number;
		userAgent: string;
		devicePixelRatio: number;
	};
	heap: {
		nowMb: number | null;
		lowMb: number | null;
		peakMb: number | null;
		sinceLoadMb: number | null;
		/** performance.memory reports this realm only; the workers hold more than the page. */
		note: string;
	};
	layers: {
		key: string;
		label: string;
		on: boolean;
		feed: "sat" | "pack" | "fires" | null;
		status: CircuitState;
		askedAt: string | null;
		arrivedAt: string | null;
		transitMs: number | null;
		reason: string;
		/** What is MEANT to accompany a blob for this layer — MISSING vs never part of the deal. */
		expects: string;
	}[];
	meter: ReturnType<typeof meterSnapshot>;
}

// Pack rows are derived from contract/packLayers.ts, so they cannot disagree with the layers the map reads
const PACK_WHERE = "in the blob's z0–z13 tiles, keyed z/x/y in gc-offlineV10";
const EXPECTS_FIXED: Record<string, string> = {
	sat: "one satellite photo per pin, ~2 km around it, in IndexedDB gc-offlineSatellite (photoBytes)",
	fires: "hotspots within FIRE_RADIUS_KM of the pin, in the fires store",
};
function expectsFor(t: (typeof LAYER_TOGGLES)[number]): string {
	if (EXPECTS_FIXED[t.key]) return EXPECTS_FIXED[t.key];
	if (t.feed !== "pack" || !t.reads?.length) return "—";
	const reads = t.reads.map((r) => {
		const asks = r.kinds
			? `${r.layer} ${r.key ?? "kind"}∈{${r.kinds.join(",")}}`
			: `${r.layer} (all)`;
		return packShips(r)
			? `${asks} — pack ships ${describePackLayer(r.layer)}`
			: `${asks} — pack ships ${describePackLayer(r.layer)}: NOT covered`;
	});
	return `${reads.join("; ")} — ${PACK_WHERE} (pack layers: ${PACK_LAYER_NAMES.join(", ")})`;
}

/** Plain-English block at the top of a report; every value a sentence in human units. */
export interface ReportSummary {
	note: string;
	timeToDownload: string;
	workers: string;
	memory: string;
}

const FEED_LABEL: Record<string, string> = {
	sat: "satellite photo",
	pack: "road pack",
	fires: "fires",
};

/** Pure: reads ONLY the report, so a test can feed it a canned one. */
export function summarizeFocusedReport(
	r: Omit<FocusedBlobReport, "summary">,
): ReportSummary {
	const feeds = new Map<string, number>();
	for (const l of r.layers) {
		if (l.feed && l.transitMs != null && !feeds.has(l.feed))
			feeds.set(l.feed, l.transitMs);
	}
	const timeToDownload = feeds.size
		? [...feeds]
				.map(([f, ms]) => `${FEED_LABEL[f] ?? f} ${(ms / 1000).toFixed(1)}s`)
				.join(" · ") + " (ask → bytes on disk, this session)"
		: "nothing downloaded since this page loaded — the map drew from what was already on disk";

	const p: Record<string, boolean | undefined> = r.meter.probes ?? {};
	const probe = (v: boolean | undefined, up: string, down: string) =>
		v == null ? "not checked" : v ? up : down;
	const workers = [
		`prod ${probe(p["worker-cloud-prod"], "reachable", "NOT reachable")}`,
		`dev ${probe(p["worker-cloud-dev"], "reachable", "NOT reachable")}`,
		`local ${probe(p["worker-local-dev"], "running", "not running")}`,
	].join(" · ");

	return {
		note: "Plain-English rollup, derived from the detailed sections below — trust the sections if they ever seem to disagree.",
		timeToDownload,
		workers,
		memory:
			r.heap.nowMb != null
				? `${r.heap.nowMb} MB now, peaked at ${r.heap.peakMb ?? "?"} MB (main thread only)`
				: "no reading",
	};
}

export async function collectFocusedBlobReport(
	live: LivePanelState = {},
): Promise<FocusedBlobReport> {
	const report: Omit<FocusedBlobReport, "summary"> = {
		schema: DEBUG_REPORT_SCHEMA,
		capturedAt: new Date().toISOString(),
		route: live.route ?? "unknown",
		env: {
			tilesHost: tilesHost() ?? "(unconfigured)",
			workerTarget: getWorkerTarget(),
			blobTileZ: BLOB_TILE_Z,
			gridRadiusKm: GRID_RADIUS_KM,
			userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
			devicePixelRatio:
				typeof window === "undefined" ? 1 : window.devicePixelRatio,
		},
		heap: {
			nowMb: live.heapNowMb ?? null,
			lowMb: live.heapLowMb ?? null,
			peakMb: live.heapPeakMb ?? null,
			sinceLoadMb:
				live.heapNowMb != null && live.heapAtLoadMb != null
					? live.heapNowMb - live.heapAtLoadMb
					: null,
			note: HEAP_NOTE,
		},
		layers: LAYER_TOGGLES.map((t) => {
			const on = live.layers?.find((l) => l.key === t.key)?.on ?? true;
			const feed = t.feed ?? null;
			const c = feed ? circuitOf(feed) : undefined;
			const lt = light(feed ?? undefined);
			const status: CircuitState = lt.state;
			// Every source-layer + kind this toggle reads must survive the Worker's allowlist.
			const unshipped = (t.reads ?? []).filter((r) => !packShips(r));
			const packHoldsThisLayer =
				feed === "pack" && (t.reads?.length ?? 0) > 0 && unshipped.length === 0;
			let reason: string;
			if (!feed) reason = "no download feeds this layer";
			else if (feed === "pack" && !packHoldsThisLayer)
				reason = `the pack contract (contract/packLayers.ts) does not cover what ${t.label} reads: ${
					unshipped.length
						? unshipped.map((r) => `${r.layer}${r.kinds ? ` ${r.key ?? "kind"}∈{${r.kinds.join(",")}}` : ""}`).join(", ")
						: "no reads declared in wallLegend.ts"
				} — pack ships ${PACK_LAYER_NAMES.map(describePackLayer).join("; ")}`;
			else if (status === "err") reason = `${feed} download broke: ${c?.note || "no detail"}`;
			else if (status === "transit") reason = `${feed} request is out, nothing back yet`;
			else if (status === "idle") reason = `not requested since this page loaded — nothing has asked the ${feed} download yet`;
			else reason = `on disk (${c?.note || "ok"}) for ${((Date.now() - (c?.arrivedAt ?? Date.now())) / 1000).toFixed(1)}s`;
			const expects = expectsFor(t);
			const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());
			return {
				key: t.key,
				label: t.label,
				on,
				feed,
				status,
				askedAt: iso(c?.askedAt),
				arrivedAt: iso(c?.arrivedAt),
				transitMs: lt.transitMs,
				reason,
				expects,
			};
		}),
		meter: meterSnapshot(),
	};
	const { schema, ...rest } = report;
	return { schema, summary: summarizeFocusedReport(report), ...rest };
}

/** Stable filename for a saved report. */
export function debugReportFilename(at = new Date()): string {
	return `getcache-debug-${at.toISOString().replace(/[:.]/g, "-")}.json`;
}

/** JSON with all-primitive objects on ONE line; a third the height of a pretty-print. */
export function compactJson(v: unknown, indent = ""): string {
	const isLeaf = (x: unknown) =>
		x === null || typeof x !== "object";
	if (isLeaf(v)) return JSON.stringify(v);
	const pad = indent + "  ";
	if (Array.isArray(v)) {
		if (v.length === 0) return "[]";
		if (v.every(isLeaf)) return JSON.stringify(v);
		return "[\n" + v.map((x) => pad + compactJson(x, pad)).join(",\n") + "\n" + indent + "]";
	}
	const entries = Object.entries(v as Record<string, unknown>);
	if (entries.length === 0) return "{}";
	if (entries.every(([, x]) => isLeaf(x) || (Array.isArray(x) && x.every(isLeaf)))) {
		return "{ " + entries.map(([k, x]) => JSON.stringify(k) + ": " + JSON.stringify(x)).join(", ") + " }";
	}
	return (
		"{\n" +
		entries.map(([k, x]) => pad + JSON.stringify(k) + ": " + compactJson(x, pad)).join(",\n") +
		"\n" + indent + "}"
	);
}
