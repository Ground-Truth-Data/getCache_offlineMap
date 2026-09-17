/**
 * dataMeter — how many bytes this device pulled off the network, by kind, per day.
 *
 * The question it answers: "how much data does the app use in a day, a week, a
 * month, and which feature is responsible" — without DevTools and without
 * catching it in the act. Every other reading available here is a snapshot of
 * one page load; this one survives reloads, so a spike is still visible
 * tomorrow.
 *
 * ⚠️ Bytes come from PerformanceResourceTiming.transferSize — the COMPRESSED
 * wire size, the number the phone bill is computed from. Never substitute a
 * body length: the fires route is gzipped ~13:1, so text.length reads as a
 * runaway fetch when the true cost is 150 KB. transferSize also covers images
 * and scripts, which no fetch-site instrumentation can see — satellite tiles
 * arrive as bitmaps, so a counter placed at the fetch call sites would have
 * missed 99% of the traffic.
 *
 * ⚠️ transferSize is 0 for a cache hit and for cross-origin responses that do
 * not send Timing-Allow-Origin. Zero therefore means "free or unmeasurable",
 * never "no request" — a total is a FLOOR, not a ceiling.
 *
 * ⚠️ KNOWN BLIND SPOT: satBakeWorker.ts fetches satellite tiles on its OWN
 * thread, and a worker keeps its own performance timeline — those bytes never
 * reach this observer. The satellite row therefore reads low whenever the
 * OffscreenCanvas path is taken (it is, on every browser that supports it; the
 * main-thread path in satelliteImage.ts is the fallback). Closing it means
 * posting transferSize out of the worker, which is worth doing only if the
 * satellite row ever needs to be exact — for "which feature costs me data",
 * the main-thread fallback plus every other row already answers it.
 */

import { SvelteMap } from "svelte/reactivity";

/** Rolling window kept on disk. A month of days is what makes a daily average honest. */
const KEEP_DAYS = 60;

const DB = "rt-data-meter";
const STORE = "days";

/**
 * The buckets, verified against the real URL builders (tilesHost.ts,
 * photoSources.ts) rather than guessed. FIRST MATCH WINS, so order matters:
 * every Worker route shares one origin, and `/satellite/z/x/y.jpg` would fall
 * into a naive "tiles host" bucket if that came first.
 *
 * ⚠️ Satellite does NOT come from api.mapbox.com. Three sources: USGS
 * (basemap.nationalmap.gov), MapTiler proxied through OUR Worker as
 * `/satellite/…` (the key is the Worker's), and EOX (tiles.maps.eox.at).
 * Bucketing satellite by "mapbox" would report zero for the heaviest feature.
 */
const KINDS: ReadonlyArray<readonly [kind: string, test: (u: string) => boolean]> = [
	["fires", (u) => u.includes("/fires")],
	["hospitals", (u) => u.includes("/hospitals")],
	[
		"satellite",
		(u) =>
			u.includes("/satellite/") ||
			u.includes("basemap.nationalmap.gov") ||
			u.includes("tiles.maps.eox.at"),
	],
	["map tiles", (u) => u.includes("/pack") || /\/\d+\/\d+\/\d+\.pbf/.test(u)],
	["directions", (u) => u.includes("api.mapbox.com/directions")],
	["mapbox", (u) => u.includes("api.mapbox.com") || u.includes("mapbox-gl")],
	["app", (u) => u.includes("/_app/") || u.endsWith(".js") || u.endsWith(".css")],
];

/** Which feature a URL's bytes belong to. Exported so the test pins the REAL table, not a copy of it. */
export function kindOf(url: string): string {
	for (const [kind, test] of KINDS) if (test(url)) return kind;
	return "other";
}

/** Local date, not UTC — "today" must mean the user's today or the daily number is wrong by a timezone. */
function dayKey(at = new Date()): string {
	return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

export interface DayBytes {
	day: string;
	/** kind → bytes. */
	kinds: Record<string, number>;
}

/** Today's tally, live. Written through to IndexedDB on a debounce. */
const today = new SvelteMap<string, number>();
let todayKey = dayKey();
/** Every earlier day read back from disk at start(). */
let history: DayBytes[] = [];

export function todayBytes(): Array<{ kind: string; bytes: number }> {
	return [...today.entries()]
		.map(([kind, bytes]) => ({ kind, bytes }))
		.sort((a, b) => b.bytes - a.bytes);
}

export function todayTotal(): number {
	let n = 0;
	for (const b of today.values()) n += b;
	return n;
}

/** Past days, newest first — today is NOT included (it is still moving). */
export function pastDays(): DayBytes[] {
	return history.filter((d) => d.day !== todayKey).sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Bytes per day averaged over the days actually recorded — not over KEEP_DAYS, which would read low until the window fills. */
export function dailyAverage(): { bytesPerDay: number; days: number } {
	const days = pastDays();
	if (days.length === 0) return { bytesPerDay: 0, days: 0 };
	let n = 0;
	for (const d of days) for (const b of Object.values(d.kinds)) n += b;
	return { bytesPerDay: Math.round(n / days.length), days: days.length };
}

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE))
				req.result.createObjectStore(STORE, { keyPath: "day" });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function readAll(): Promise<DayBytes[]> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readonly");
		const req = tx.objectStore(STORE).getAll();
		let out: DayBytes[] = [];
		req.onsuccess = () => {
			out = req.result as DayBytes[];
		};
		// ⚠️ settle on the TRANSACTION, never the request — an aborted tx leaves
		// request callbacks silent forever and the promise never resolves.
		tx.oncomplete = () => resolve(out);
		tx.onabort = () => reject(tx.error);
		tx.onerror = () => reject(tx.error);
	});
}

async function writeDay(day: DayBytes, cutoff: string): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		const store = tx.objectStore(STORE);
		store.put(day);
		// Prune in the same transaction — a separate pass is a second failure mode
		// for no benefit, and the window must never be trimmed without the write.
		const cur = store.openCursor();
		cur.onsuccess = () => {
			const c = cur.result;
			if (!c) return;
			if (String(c.key) < cutoff) c.delete();
			c.continue();
		};
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error);
		tx.onerror = () => reject(tx.error);
	});
}

function cutoffDay(): string {
	const d = new Date();
	d.setDate(d.getDate() - KEEP_DAYS);
	return dayKey(d);
}

let flushTimer: ReturnType<typeof setTimeout> | undefined;
function flushSoon(): void {
	clearTimeout(flushTimer);
	flushTimer = setTimeout(() => {
		void writeDay(
			{ day: todayKey, kinds: Object.fromEntries(today) },
			cutoffDay(),
		).catch(() => {
			// A meter that breaks the app it measures is worse than no meter.
		});
	}, 2000);
}

function note(url: string, bytes: number): void {
	if (bytes <= 0) return;
	// Midnight mid-session: bank the old day before the new one starts counting.
	const now = dayKey();
	if (now !== todayKey) {
		history = [...history.filter((d) => d.day !== todayKey), { day: todayKey, kinds: Object.fromEntries(today) }];
		today.clear();
		todayKey = now;
	}
	const kind = kindOf(url);
	today.set(kind, (today.get(kind) ?? 0) + bytes);
	flushSoon();
}

let observer: PerformanceObserver | undefined;

/**
 * Start counting. Idempotent; safe to call from any page.
 *
 * ⚠️ Reads the buffer that already exists BEFORE observing — a PerformanceObserver
 * registered after boot sees none of the boot traffic, which is most of it.
 */
export function startDataMeter(): () => void {
	if (typeof window === "undefined" || observer) return () => undefined;

	void readAll()
		.then((days) => {
			history = days;
			const mine = days.find((d) => d.day === todayKey);
			// Resume today's tally rather than restarting it — a reload must not zero the day.
			if (mine) for (const [k, v] of Object.entries(mine.kinds)) today.set(k, (today.get(k) ?? 0) + v);
		})
		.catch(() => {
			// No history is a usable state; today still counts.
		});

	const take = (entries: PerformanceEntryList): void => {
		for (const e of entries) {
			const r = e as PerformanceResourceTiming;
			if (typeof r.transferSize === "number") note(r.name, r.transferSize);
		}
	};
	take(performance.getEntriesByType("resource"));
	observer = new PerformanceObserver((list) => take(list.getEntries()));
	observer.observe({ type: "resource", buffered: true });
	// The buffer is capped (~250 entries) and this app blows past it in a minute
	// of panning; dropping what has been counted is what keeps later tiles visible.
	const clear = setInterval(() => performance.clearResourceTimings(), 30_000);

	return () => {
		observer?.disconnect();
		observer = undefined;
		clearInterval(clear);
		clearTimeout(flushTimer);
	};
}

/** The whole meter as one plain object — window.__data() in dev, and the panel's copy button. */
export function dataSnapshot() {
	const avg = dailyAverage();
	return {
		today: { day: todayKey, total: todayTotal(), kinds: Object.fromEntries(today) },
		averagePerDay: avg.bytesPerDay,
		daysRecorded: avg.days,
		history: pastDays(),
	};
}

if (import.meta.env.DEV && typeof window !== "undefined") {
	(window as unknown as { __data: () => unknown }).__data = dataSnapshot;
}
