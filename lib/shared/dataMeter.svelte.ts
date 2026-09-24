/**
 * Bytes this device pulled off the network, by kind, per day; survives reloads.
 * Bytes are PerformanceResourceTiming.transferSize: the COMPRESSED wire size,
 * never a body length (fires is gzipped ~13:1), and it covers images and
 * scripts no fetch-site counter could see. transferSize is 0 for a cache hit
 * or a cross-origin response without Timing-Allow-Origin, so a total is a FLOOR.
 * Blind spot: satBakeWorker.ts fetches on its own thread with its own timeline.
 */

import { SvelteMap } from "svelte/reactivity";

const KEEP_DAYS = 60;

const DB = "rt-data-meter";
const STORE = "days";

// FIRST MATCH WINS: every Worker route shares one origin, so `/satellite/` must precede `/pack`.
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

export function kindOf(url: string): string {
	for (const [kind, test] of KINDS) if (test(url)) return kind;
	return "other";
}

/** Local date, not UTC: "today" must mean the user's today. */
function dayKey(at = new Date()): string {
	return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

export interface DayBytes {
	day: string;
	kinds: Record<string, number>;
}

const today = new SvelteMap<string, number>();
let todayKey = dayKey();
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

/** Past days, newest first; today is still moving and NOT included. */
export function pastDays(): DayBytes[] {
	return history.filter((d) => d.day !== todayKey).sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Averaged over the days actually recorded, not KEEP_DAYS. */
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
		// Settle on the TRANSACTION: an aborted tx leaves request callbacks silent forever.
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
			// codestyle-allow-swallow: a meter must never break the app it measures
		});
	}, 2000);
}

function note(url: string, bytes: number): void {
	if (bytes <= 0) return;
	// Midnight mid-session: bank the old day first.
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

/** Start counting. Idempotent. Reads the existing buffer first: an observer registered after boot sees none of the boot traffic. */
export function startDataMeter(): () => void {
	if (typeof window === "undefined" || observer) return () => undefined;

	void readAll()
		.then((days) => {
			history = days;
			const mine = days.find((d) => d.day === todayKey);
			if (mine) for (const [k, v] of Object.entries(mine.kinds)) today.set(k, (today.get(k) ?? 0) + v);
		})
		.catch(() => {
			// codestyle-allow-swallow: no history is a usable state
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
	// The buffer is capped (~250 entries); a minute of panning fills it.
	const clear = setInterval(() => performance.clearResourceTimings(), 30_000);

	return () => {
		observer?.disconnect();
		observer = undefined;
		clearInterval(clear);
		clearTimeout(flushTimer);
	};
}

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
