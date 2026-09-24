/**
 * One JSON snapshot of the offline map. Geometry (corners, reach, offset) is
 * mandatory: every offline bug so far was correct bytes in the wrong box.
 * Each area is built from ITS OWN CoverageRecord — never a viewport query,
 * which would report a neighbour's roads as this pin's. No app imports: pins
 * arrive as a parameter (debugReport.portability.test.ts).
 */
import {
	BLOB_TILE_Z,
	GRID_RADIUS_KM,
	cellBox,
	cellOf,
	cellKey,
} from "../contract/grid";
import {
	PACK_LAYER_NAMES,
	describePackLayer,
	packShips,
} from "../contract/packLayers";
import { FIRE_REFRESH_ENABLED } from "./bakeFlags";
import { circuitOf, light, paintOf, type CircuitState } from "./workMeter.svelte";
import { LAYER_TOGGLES } from "../onPhone/render/wallLegend";
import { meterSnapshot } from "./workMeter.svelte";
import { kmBetween } from "./kmGeo";
import {
	OFFLINE_BUDGET_BYTES,
	allCoverage,
	type CoverageRecord,
} from "../onPhone/store/coverageRegistry";
import {
	getWorkerTarget,
	tilesHost,
	type WorkerTarget,
} from "../worker/worker-local-dev/tilesHost";
import {
	payloadStats,
	workStats,
	type PayloadStat,
	type WorkStat,
} from "./workMeter.svelte";

/** Bump when a field's MEANING changes, so an old file is never misread as a new one. */
export const DEBUG_REPORT_SCHEMA = 1 as const;

export interface LngLatPin {
	lng: number;
	lat: number;
}

/** Full geometry for ONE area (the newest); the rest are AreaSummary. */
export interface BlobGeometryReport {
	areaKey: string;
	pin: LngLatPin;
	/** `z_ix_iy`; z is not always BLOB_TILE_Z — an edge pin is promoted to a shallower tile. */
	cell: string;
	cellZoom: number;
	/** [w,s], [e,s], [e,n], [w,n] */
	corners: [number, number][];
	box: { w: number; s: number; e: number; n: number };
	/** Per edge, compare against gridRadiusKm. */
	reachKm: { n: number; s: number; e: number; w: number };
	/** Pin → centre-of-box; ~0 is healthy, tens of km is the mis-boxing bug. */
	offsetKm: number;
	bytes: number;
	photoBytes: number;
	lineBytes: number;
	lineCount: number;
	hasPhoto: boolean;
	hasLines: boolean;
	/** `null` = predates versioning, treated as stale. */
	blobVersion: string | null;
	lastTouched: string;
}

/** One line per area, no corners, so hundreds of areas stay paste-able. */
export interface AreaSummary {
	areaKey: string;
	lng: number;
	lat: number;
	offsetKm: number;
	bytes: number;
	lineCount: number;
	hasPhoto: boolean;
	hasLines: boolean;
	stale: boolean;
	lastTouched: string;
}

export interface DebugReport {
	schema: typeof DEBUG_REPORT_SCHEMA;
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
	/** A heap number means nothing without knowing whether satellite was on. */
	layers: { key: string; on: boolean }[];
	bake: {
		on: boolean;
		pending: number;
		failing: number;
		secs: number;
		stalled: boolean;
		note: string;
	};
	work: WorkStat[];
	payloads: PayloadStat[];
	budget: { usedBytes: number; totalBytes: number; areas: number };
	latest: BlobGeometryReport | null;
	areas: AreaSummary[];
	/** Pins with NO coverage record. Empty is healthy. */
	uncoveredPins: LngLatPin[];
}

export const HEAP_NOTE =
	"main thread only — workers NOT counted; see DevTools → Memory for the total";

/** Geometry for ONE record, derived from ITS OWN key alone. */
export function geometryFor(rec: CoverageRecord): BlobGeometryReport {
	const c = cellOf(rec.lng, rec.lat);
	const b = cellBox(c);
	const centre: [number, number] = [(b.w + b.e) / 2, (b.s + b.n) / 2];
	const pin: [number, number] = [rec.lng, rec.lat];

	return {
		areaKey: rec.areaKey,
		pin: { lng: rec.lng, lat: rec.lat },
		cell: cellKey(c),
		cellZoom: c.z,
		corners: [
			[b.w, b.s],
			[b.e, b.s],
			[b.e, b.n],
			[b.w, b.n],
		],
		box: { w: b.w, s: b.s, e: b.e, n: b.n },
		reachKm: {
			n: kmBetween(pin, [rec.lng, b.n]),
			s: kmBetween(pin, [rec.lng, b.s]),
			e: kmBetween(pin, [b.e, rec.lat]),
			w: kmBetween(pin, [b.w, rec.lat]),
		},
		offsetKm: kmBetween(pin, centre),
		bytes: rec.bytes ?? 0,
		photoBytes: rec.photoBytes ?? 0,
		lineBytes: rec.lineBytes ?? 0,
		lineCount: rec.lineCount ?? 0,
		hasPhoto: !!rec.hasPhoto,
		hasLines: !!rec.hasLines,
		blobVersion: rec.blobVersion ?? null,
		lastTouched: new Date(rec.lastTouched).toISOString(),
	};
}

function summarise(rec: CoverageRecord, currentVersion: string | null): AreaSummary {
	const g = geometryFor(rec);
	return {
		areaKey: g.areaKey,
		lng: g.pin.lng,
		lat: g.pin.lat,
		offsetKm: g.offsetKm,
		bytes: g.bytes,
		lineCount: g.lineCount,
		hasPhoto: g.hasPhoto,
		hasLines: g.hasLines,
		stale:
			g.blobVersion === null ||
			(currentVersion !== null && g.blobVersion !== currentVersion),
		lastTouched: g.lastTouched,
	};
}

/** Live readings the panel holds, passed IN so this module stays portable. */
export interface LivePanelState {
	route?: string;
	heapNowMb?: number | null;
	heapLowMb?: number | null;
	heapPeakMb?: number | null;
	heapAtLoadMb?: number | null;
	bakeOn?: boolean;
	bakePending?: number;
	bakeFailing?: number;
	bakeSecs?: number;
	bakeStalled?: boolean;
	bakeNote?: string;
	layers?: { key: string; on: boolean }[];
	/** Used ONLY to report which pins lack coverage. */
	pins?: LngLatPin[];
	/** The blob signature areas SHOULD hold, for the stale flag. */
	currentBlobVersion?: string | null;
}

/** Build the whole report; everything not in the coverage registry or work meter arrives via `live`. */
export async function collectDebugReport(
	live: LivePanelState = {},
): Promise<DebugReport> {
	const records = await allCoverage();
	// Same order as OfflineBlobPanel's `focused`: bytes landed, newest bakedAt.
	const sorted = records
		.filter((r) => r.hasPhoto || r.hasLines)
		.sort(
			(a, b) =>
				(b.bakedAt ?? b.lastTouched ?? 0) - (a.bakedAt ?? a.lastTouched ?? 0),
		);
	const version = live.currentBlobVersion ?? null;

	const usedBytes = sorted.reduce((n, r) => n + (r.bytes ?? 0), 0);

	// Same 4dp key the satellite baker writes.
	const haveKeys = new Set(sorted.map((r) => r.areaKey));
	const uncoveredPins = (live.pins ?? []).filter(
		(p) => !haveKeys.has(`${p.lng.toFixed(4)},${p.lat.toFixed(4)}`),
	);


	return {
		schema: DEBUG_REPORT_SCHEMA,
		capturedAt: new Date().toISOString(),
		route: live.route ?? "unknown",
		env: {
			tilesHost: tilesHost() ?? "(unconfigured)",
			workerTarget: getWorkerTarget(),
			blobTileZ: BLOB_TILE_Z,
			gridRadiusKm: GRID_RADIUS_KM,
			userAgent:
				typeof navigator === "undefined" ? "" : navigator.userAgent,
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
		layers: live.layers ?? [],
		bake: {
			on: live.bakeOn ?? false,
			pending: live.bakePending ?? 0,
			failing: live.bakeFailing ?? 0,
			secs: live.bakeSecs ?? 0,
			stalled: live.bakeStalled ?? false,
			note: live.bakeNote ?? "",
		},
		work: workStats(),
		payloads: payloadStats(),
		budget: {
			usedBytes,
			totalBytes: OFFLINE_BUDGET_BYTES,
			areas: sorted.length,
		},
		latest: sorted.length > 0 ? geometryFor(sorted[0]) : null,
		areas: sorted.map((r) => summarise(r, version)),
		uncoveredPins,
	};
}

/** ONE blob + the live session — what the export button calls; the full
 *  `areas` inventory runs to thousands of lines. */
export interface FocusedBlobReport {
	schema: typeof DEBUG_REPORT_SCHEMA;
	/** DERIVED from the sections below, never measured separately, so headline and detail agree. */
	summary: ReportSummary;
	capturedAt: string;
	route: string;
	env: DebugReport["env"];
	heap: DebugReport["heap"];
	/** `arrived:false` with `status:"ok"` = the download landed but carried nothing for this layer. */
	layers: {
		key: string;
		label: string;
		on: boolean;
		feed: "sat" | "pack" | "fires" | null;
		status: CircuitState;
		arrived: boolean;
		onScreen: boolean;
		askedAt: string | null;
		arrivedAt: string | null;
		drawnAt: string | null;
		transitMs: number | null;
		paintLagMs: number | null;
		paintedCount: number | null;
		reason: string;
		/** What is MEANT to accompany a blob for this layer — MISSING vs never part of the deal. */
		expects: string;
	}[];
	blob: BlobGeometryReport | null;
	meter: ReturnType<typeof meterSnapshot>;
	disk: {
		areas: number;
		bytes: number;
		recentImports: {
			areaKey: string;
			bakedAt: string;
			bytes: number;
			tiles: number;
			photo: boolean;
		}[];
	};
}

// Pack rows are derived from contract/packLayers.ts, the table the Worker
// filters by, so they cannot disagree with what ships.
const PACK_WHERE = `inside the z${BLOB_TILE_Z} blob tile(s), keyed pin/<lng>,<lat>/${BLOB_TILE_Z}/x/y in gc-offlineTiles`;
const EXPECTS_FIXED: Record<string, string> = {
	sat: "one satellite photo per pin, ~2 km around it, in IndexedDB gc-offlineSatellite (photoBytes)",
	fires: `hotspots within FIRE_RADIUS_KM of the pin, in the fires store — per-pin fire refresh is ${FIRE_REFRESH_ENABLED ? "ON" : "OFF (FIRE_REFRESH_ENABLED=false in bakeService): fires are not baked per pin at the moment, so this row stays grey by design"}`,
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
	onDisk: string;
	latestArea: string;
	onScreen: string;
	workers: string;
	memory: string;
}

const FEED_LABEL: Record<string, string> = {
	sat: "satellite photo",
	pack: "road pack",
	fires: "fires",
};

function fmtMb(b: number): string {
	return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function agoText(iso: string | null | undefined, from: Date): string {
	if (!iso) return "never";
	const mins = Math.round((from.getTime() - new Date(iso).getTime()) / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins} min ago`;
	if (mins < 60 * 48) return `${Math.round(mins / 60)} h ago`;
	return `${Math.round(mins / 60 / 24)} days ago`;
}

/** Pure: reads ONLY the report, so a test can feed it a canned one. */
export function summarizeFocusedReport(
	r: Omit<FocusedBlobReport, "summary">,
): ReportSummary {
	const now = new Date(r.capturedAt);

	const feeds = new Map<string, number>();
	for (const l of r.layers) {
		if (l.feed && l.transitMs != null && !feeds.has(l.feed))
			feeds.set(l.feed, l.transitMs);
	}
	const newest = r.disk.recentImports[0];
	const timeToDownload = feeds.size
		? [...feeds]
				.map(([f, ms]) => `${FEED_LABEL[f] ?? f} ${(ms / 1000).toFixed(1)}s`)
				.join(" · ") + " (ask → bytes on disk, this session)"
		: newest
			? `nothing downloaded since this page loaded — the map drew from what was already on disk (newest area landed ${agoText(newest.bakedAt, now)})`
			: "nothing has ever been downloaded on this device";

	const paint = new Map(r.meter.paints.map((p) => [p.key, p.count]));
	const drawn = r.layers.filter((l) => (paint.get(l.key) ?? 0) > 0);
	const empty = r.layers.filter((l) => l.on && (paint.get(l.key) ?? 0) === 0);
	const onScreen =
		(drawn.length
			? `on screen: ${drawn.map((l) => `${l.label} (${(paint.get(l.key) ?? 0).toLocaleString()})`).join(", ")}`
			: "nothing painted yet") +
		(empty.length ? ` — nothing to draw for ${empty.map((l) => l.label).join(", ")}` : "");

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
		onDisk: `${r.disk.areas} areas cached, ${fmtMb(r.disk.bytes)} of the ${fmtMb(OFFLINE_BUDGET_BYTES)} budget`,
		latestArea: r.blob
			? `${fmtMb(r.blob.bytes)} around (${r.blob.pin.lng.toFixed(3)}, ${r.blob.pin.lat.toFixed(3)}) — ${r.blob.hasPhoto ? "photo" : "NO photo"} + ${r.blob.lineCount} road tiles, landed ${agoText(newest?.bakedAt, now)}`
			: "no areas cached yet",
		onScreen,
		workers,
		memory:
			r.heap.nowMb != null
				? `${r.heap.nowMb} MB now, peaked at ${r.heap.peakMb ?? "?"} MB (main thread only)`
				: "no reading",
	};
}

/** Report scoped to the LAST SUCCESSFUL IMPORT, the row the blob panel hoists as FOCUSED. */
export async function collectFocusedBlobReport(
	live: LivePanelState = {},
): Promise<FocusedBlobReport> {
	const records = await allCoverage();
	// Same order as OfflineBlobPanel's `focused`: bytes landed, newest bakedAt.
	const sorted = records
		.filter((r) => r.hasPhoto || r.hasLines)
		.sort(
			(a, b) =>
				(b.bakedAt ?? b.lastTouched ?? 0) - (a.bakedAt ?? a.lastTouched ?? 0),
		);

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
			const lt = light(feed ?? undefined, [t.key]);
			const status: CircuitState = lt.state;
			const top = sorted[0];
			// Every source-layer + kind this toggle reads must survive the Worker's allowlist.
			const unshipped = (t.reads ?? []).filter((r) => !packShips(r));
			const packHoldsThisLayer =
				feed === "pack" && (t.reads?.length ?? 0) > 0 && unshipped.length === 0;
			const arrived =
				feed === "sat"
					? top?.hasPhoto === true
					: feed === "pack"
						? packHoldsThisLayer && top?.hasLines === true && (top.lineCount ?? 0) > 0
						: feed === "fires"
							? status === "ok"
							: false;
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
			else if (status === "idle" && arrived) reason = "on disk from an earlier session — not requested since this page loaded";
			else if (status === "idle") reason = `never requested — nothing has asked the ${feed} download yet`;
			else if (!arrived) reason = `${feed} download landed (${c?.note || "ok"}) but the focused blob holds no ${t.label} data`;
			else if (status === "ok")
				reason = `on disk (${c?.note || "ok"}) for ${((Date.now() - (c?.arrivedAt ?? Date.now())) / 1000).toFixed(1)}s but NOT painted in the viewport yet — last idle counted ${paintOf(t.key)?.count ?? 0} ${t.label} features on screen`;
			else reason = `on screen — ${lt.paint?.count ?? 0} drawn, ${((lt.paintLagMs ?? 0) / 1000).toFixed(1)}s after the bytes landed`;
			const expects = expectsFor(t);
			const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());
			return {
				key: t.key,
				label: t.label,
				on,
				feed,
				status,
				arrived,
				onScreen: status === "drawn",
				askedAt: iso(c?.askedAt),
				arrivedAt: iso(c?.arrivedAt),
				drawnAt: iso(lt.paint?.drawnAt),
				transitMs: lt.transitMs,
				paintLagMs: lt.paintLagMs,
				paintedCount: lt.paint?.count ?? null,
				reason,
				expects,
			};
		}),
		meter: meterSnapshot(),
		disk: {
			areas: records.length,
			bytes: records.reduce((n, r) => n + (r.bytes || 0), 0),
			recentImports: sorted.slice(0, 5).map((r) => ({
				areaKey: r.areaKey,
				bakedAt: new Date(r.bakedAt ?? r.lastTouched ?? 0).toISOString(),
				bytes: r.bytes,
				tiles: r.lineCount ?? 0,
				photo: r.hasPhoto,
			})),
		},
		blob: sorted.length > 0 ? geometryFor(sorted[0]) : null,
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
