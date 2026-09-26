import { SvelteMap } from "svelte/reactivity";

export interface WorkStat {
	name: string;
	runs: number;
	lastMs: number;
	maxMs: number;
	totalMs: number;
	/** Wall-clock start of the in-flight run, or null when idle. */
	startedAt: number | null;
	errors: number;
}

// SvelteMap, not `$state(new Map())`: Svelte 5 does not proxy Map, so the key set would never re-run `workStats()`
const stats = new SvelteMap<string, WorkStat>();

/** idle grey · transit yellow · ok = bytes on disk, STILL yellow · drawn = seen in the viewport, green · err red. Only paintWatch.ts can turn a row green. */
export type CircuitState = "idle" | "transit" | "ok" | "drawn" | "err";
export interface CircuitStat {
	key: string;
	state: Exclude<CircuitState, "drawn">;
	/** Epoch ms of the last change. */
	at: number;
	note: string;
	askedAt: number | null;
	arrivedAt: number | null;
}

/** What the map ACTUALLY PAINTED for one layer row on the last idle. */
export interface PaintStat {
	key: string;
	count: number;
	at: number;
	/** First idle that saw count > 0 AFTER the feed's current arrivedAt; reset when a newer arrival lands. */
	drawnAt: number | null;
}

const circuits = new SvelteMap<string, CircuitStat>();
const paints = new SvelteMap<string, PaintStat>();
const probes = new SvelteMap<string, boolean>();

/** A transit unanswered this long is declared err so the badge stops counting; a late arrival still un-errs it. */
const GIVE_UP_MS = 30_000;
const giveUpTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** While set, notes tagged with a different area are ignored so a background reconcile cannot overwrite the pin just dropped; untagged notes always land. */
let focusArea: string | null = null;
export function noteCircuit(
	key: string,
	state: Exclude<CircuitState, "drawn">,
	note = "",
	areaKey?: string,
): void {
	if (focusArea && areaKey && areaKey !== focusArea) return;
	const prev = circuits.get(key);
	// Delivered latch: once bytes arrived, only an err or the next reset may touch this circuit, or background re-bakes restart the stopwatch.
	if (prev?.arrivedAt != null && state !== "err") return;
	// A repeat "asking…" while already yellow is the same ask; t0 stays.
	if (state === "transit" && prev?.state === "transit") return;
	const now = Date.now();
	const next: CircuitStat = {
		key,
		state,
		at: now,
		note,
		askedAt: state === "transit" ? now : (prev?.askedAt ?? null),
		// A new ask forgets the old arrival; an err un-delivers so a retry can measure again.
		arrivedAt: state === "ok" ? now : null,
	};
	circuits.set(key, next);
	clearTimeout(giveUpTimers.get(key));
	giveUpTimers.delete(key);
	if (state === "transit")
		giveUpTimers.set(
			key,
			setTimeout(() => {
				giveUpTimers.delete(key);
				if (circuits.get(key)?.state === "transit")
					noteCircuit(key, "err", `nothing after ${GIVE_UP_MS / 1000}s — gave up waiting`);
			}, GIVE_UP_MS),
		);
}
/** undefined = never called (render grey). */
export function circuitOf(key: string): CircuitStat | undefined {
	return circuits.get(key);
}
export function allCircuits(): CircuitStat[] {
	return [...circuits.values()];
}

/** `drawnAt` latches on the first non-zero count and drops when the feed's arrival is newer. */
export function notePaint(layerKey: string, feedKey: string | undefined, count: number): void {
	const now = Date.now();
	const prev = paints.get(layerKey);
	const arrivedAt = feedKey ? (circuits.get(feedKey)?.arrivedAt ?? null) : null;
	const stillValid =
		prev?.drawnAt != null && (arrivedAt == null || prev.drawnAt >= arrivedAt);
	const drawnAt = stillValid ? prev!.drawnAt : count > 0 ? now : null;
	paints.set(layerKey, { key: layerKey, count, at: now, drawnAt });
}
export function paintOf(layerKey: string): PaintStat | undefined {
	return paints.get(layerKey);
}
export function allPaints(): PaintStat[] {
	return [...paints.values()];
}

export interface Light {
	state: CircuitState;
	circuit?: CircuitStat;
	paint?: PaintStat;
	/** ask → bytes on disk */
	transitMs: number | null;
	/** bytes on disk → first sighting in the viewport */
	paintLagMs: number | null;
	/** ask → first sighting on screen; null until drawn */
	seenMs: number | null;
	/** Bytes arrived and a LATER idle counted ZERO of this row's features: the area holds none, so stop counting. */
	settledEmpty?: boolean;
}
/** The colour of a row: `drawn` ONLY when one of `layerKeys` was painted after the feed's current arrival. */
export function light(circuitKey: string | undefined, layerKeys: readonly string[]): Light {
	const circuit = circuitKey ? circuits.get(circuitKey) : undefined;
	if (!circuit) return { state: "idle", transitMs: null, paintLagMs: null, seenMs: null };
	const transitMs =
		circuit.askedAt != null && circuit.arrivedAt != null ? circuit.arrivedAt - circuit.askedAt : null;
	if (circuit.state !== "ok") return { state: circuit.state, circuit, transitMs, paintLagMs: null, seenMs: null };
	let paint: PaintStat | undefined;
	for (const k of layerKeys) {
		const p = paints.get(k);
		if (p?.drawnAt != null && circuit.arrivedAt != null && p.drawnAt >= circuit.arrivedAt && (!paint || p.drawnAt < paint.drawnAt!)) paint = p;
	}
	if (!paint) {
		let settledEmpty = false;
		if (circuit.arrivedAt != null)
			for (const k of layerKeys) {
				const p = paints.get(k);
				if (p && p.at >= circuit.arrivedAt) settledEmpty = true;
			}
		return { state: "ok", circuit, transitMs, paintLagMs: null, seenMs: null, settledEmpty };
	}
	return {
		state: "drawn",
		circuit,
		paint,
		transitMs,
		paintLagMs: paint.drawnAt! - circuit.arrivedAt!,
		seenMs: circuit.askedAt != null ? paint.drawnAt! - circuit.askedAt : null,
	};
}

/** Back to grey on pin drop, so circles describe THIS ask. */
export function resetCircuits(areaKey: string | null = null): void {
	focusArea = areaKey;
	// Or a stale timer reds out the NEXT ask early.
	for (const t of giveUpTimers.values()) clearTimeout(t);
	giveUpTimers.clear();
	circuits.clear();
	paints.clear();
}

/** Reachability, for greying/retry ONLY. */
export function noteProbe(tier: string, ok: boolean): void {
	probes.set(tier, ok);
}
export function probeOf(tier: string): boolean | undefined {
	return probes.get(tier);
}

/** The whole panel as one plain object; window.__meter() and the panel's "copy JSON" hand out exactly this. */
export function meterSnapshot() {
	return {
		at: new Date().toISOString(),
		work: workStats().map((s) => ({ ...s })),
		focus: focusArea,
		circuits: allCircuits().map((c) => ({
			...c,
			askedAtIso: c.askedAt == null ? null : new Date(c.askedAt).toISOString(),
			arrivedAtIso: c.arrivedAt == null ? null : new Date(c.arrivedAt).toISOString(),
			transitMs: c.askedAt != null && c.arrivedAt != null ? c.arrivedAt - c.askedAt : null,
		})),
		paints: allPaints().map((p) => ({
			...p,
			atIso: new Date(p.at).toISOString(),
			drawnAtIso: p.drawnAt == null ? null : new Date(p.drawnAt).toISOString(),
		})),
		probes: Object.fromEntries(probes),
	};
}

if (import.meta.env.DEV && typeof window !== "undefined") {
	(window as unknown as { __meter: () => unknown }).__meter = meterSnapshot;
}

function slot(name: string): WorkStat {
	const have = stats.get(name);
	if (have) return have;
	const fresh: WorkStat = $state({
		name,
		runs: 0,
		lastMs: 0,
		maxMs: 0,
		totalMs: 0,
		startedAt: null,
		errors: 0,
	});
	stats.set(name, fresh);
	return fresh;
}

export function workStats(): WorkStat[] {
	return [...stats.values()];
}

/** Time one run of fn; a throw is recorded and re-thrown. */
export async function track<T>(name: string, fn: () => Promise<T>): Promise<T> {
	const s = slot(name);
	s.startedAt = Date.now();
	const t0 = performance.now();
	try {
		return await fn();
	} catch (err) {
		s.errors++;
		throw err;
	} finally {
		const ms = performance.now() - t0;
		s.runs++;
		s.lastMs = ms;
		if (ms > s.maxMs) s.maxMs = ms;
		s.totalMs += ms;
		s.startedAt = null;
	}
}

/** Manual bracket for code that can't wrap in a callback; call the returned fn in finally. */
export function beginWork(name: string): (failed?: boolean) => void {
	const s = slot(name);
	s.startedAt = Date.now();
	const t0 = performance.now();
	let closed = false;
	return (failed = false) => {
		if (closed) return;
		closed = true;
		const ms = performance.now() - t0;
		s.runs++;
		s.lastMs = ms;
		if (ms > s.maxMs) s.maxMs = ms;
		s.totalMs += ms;
		if (failed) s.errors++;
		s.startedAt = null;
	};
}

/** Zero the counters; the in-flight run is untouched. */
export function resetWorkStats(): void {
	for (const s of stats.values()) {
		s.runs = 0;
		s.lastMs = 0;
		s.maxMs = 0;
		s.totalMs = 0;
		s.errors = 0;
	}
	// Probes stay: a fact about the network, not a counter.
	circuits.clear();
	paints.clear();
}
