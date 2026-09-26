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

/** idle grey · transit yellow · ok = bytes on disk, STILL yellow · err red. */
export type CircuitState = "idle" | "transit" | "ok" | "err";
export interface CircuitStat {
	key: string;
	state: CircuitState;
	/** Epoch ms of the last change. */
	at: number;
	note: string;
	askedAt: number | null;
	arrivedAt: number | null;
}

const circuits = new SvelteMap<string, CircuitStat>();
const probes = new SvelteMap<string, boolean>();

/** A transit unanswered this long is declared err so the badge stops counting; a late arrival still un-errs it. */
const GIVE_UP_MS = 30_000;
const giveUpTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** While set, notes tagged with a different area are ignored so a background reconcile cannot overwrite the pin just dropped; untagged notes always land. */
let focusArea: string | null = null;
export function noteCircuit(
	key: string,
	state: CircuitState,
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

export interface Light {
	state: CircuitState;
	circuit?: CircuitStat;
	/** ask → bytes on disk */
	transitMs: number | null;
}
export function light(circuitKey: string | undefined): Light {
	const circuit = circuitKey ? circuits.get(circuitKey) : undefined;
	if (!circuit) return { state: "idle", transitMs: null };
	const transitMs =
		circuit.askedAt != null && circuit.arrivedAt != null ? circuit.arrivedAt - circuit.askedAt : null;
	return { state: circuit.state, circuit, transitMs };
}

/** Back to grey on pin drop, so circles describe THIS ask. */
export function resetCircuits(areaKey: string | null = null): void {
	focusArea = areaKey;
	// Or a stale timer reds out the NEXT ask early.
	for (const t of giveUpTimers.values()) clearTimeout(t);
	giveUpTimers.clear();
	circuits.clear();
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
}
