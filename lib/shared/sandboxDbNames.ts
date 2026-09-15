export const SANDBOX_SUFFIX = "-sandbox";

/** A world token must be safe inside an IndexedDB name and a localStorage key. */
const WORLD_TOKEN = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/**
 * The world this page load runs in, read off `?sandbox=`: "1" is the practice
 * sandbox, any other token a NAMED world (`?sandbox=blue`) — a second full app
 * on the same origin with its own databases, used to play two phones against
 * each other. null = the real app. Reads `location.search` unless given one.
 */
export function sandboxWorld(search?: string): string | null {
	const s =
		search ?? (typeof location === "undefined" ? "" : location.search);
	const v = new URLSearchParams(s).get("sandbox");
	if (v === null || v === "" || v === "0") return null;
	return WORLD_TOKEN.test(v) ? v : null;
}

/** The suffix a world adds to every DB name: `-sandbox` for the practice
 *  sandbox, `-sandbox-<name>` for a named world. */
export function worldSuffix(world: string): string {
	// Fail loud: a junk token here names a junk database on the origin for good.
	if (typeof world !== "string" || !WORLD_TOKEN.test(world)) {
		throw new Error(`[sandboxDbNames] not a world token: ${String(world)}`);
	}
	return world === "1" ? SANDBOX_SUFFIX : `${SANDBOX_SUFFIX}-${world}`;
}

/** Suffix for a localStorage key that must not cross worlds; "" in the real
 *  app. Read from the URL, not the storage flag, so a module-scope seed sees
 *  it before boot has set the flag. */
export function worldStorageSuffix(): string {
	const w = sandboxWorld();
	return w ? worldSuffix(w) : "";
}

let sandboxActive = false;
let activeSuffix = "";

/** Called at boot to point offline storage at this page load's world. */
export function setSandboxStorageActive(active: boolean, world = "1"): void {
	sandboxActive = active;
	activeSuffix = active ? worldSuffix(world) : "";
	// Mirror onto a window global so rapper (must NOT import proprietary $lib/mobile — open-core rule) can read sandbox state and redirect "maps" → "maps-sandbox".
	if (typeof window !== "undefined") {
		(window as { __rt_sandbox_active?: boolean }).__rt_sandbox_active = active;
	}
}

export function isSandboxStorageActive(): boolean {
	return sandboxActive;
}

/** Resolve the live DB name for a base name — `<name>-sandbox` in the
 *  practice sandbox, `<name>-sandbox-<world>` in a named world. */
export function currentDbName(realName: string): string {
	return realName + activeSuffix;
}

const resetFns = new Set<() => void>();

/** Offline module registers a fn that clears its cached open-DB handle. */
export function registerOfflineDbReset(fn: () => void): void {
	resetFns.add(fn);
}

/** ⛔ SEPARATE FROM `resetOfflineDbHandles`, DELIBERATELY — sandbox toggling needs reopen, but a wipe needs reads to refuse reopening or `deleteDatabase` blocks. */
interface WipeLatch {
	/** Stop this module's reads reopening the DB. */
	latch: () => void;
	/** Allow reads again — ONLY when the wipe did not happen. */
	unlatch: () => void;
}

const wipeLatchFns = new Set<WipeLatch>();

/** A module registers the pair that stops, and restores, its reads during a wipe. */
export function registerWipeLatch(l: WipeLatch): void {
	wipeLatchFns.add(l);
}

/** Latch every registered reader OFF before deleting. Reads become misses. */
export function latchOfflineReadsForWipe(): void {
	for (const l of wipeLatchFns) {
		try {
			l.latch();
		} catch {
			/* best-effort: a failed latch just means that delete may block */
		}
	}
}

/** ⛔ Never call after a successful wipe — this is the only escape from a permanent blackout: a latched read returns null silently forever ("roads disappeared and never came back"). */
export function unlatchOfflineReadsAfterFailedWipe(): void {
	for (const l of wipeLatchFns) {
		try {
			l.unlatch();
		} catch {
			/* best-effort */
		}
	}
}

/** Drop every cached offline-DB handle so the next open() reopens correctly. */
export function resetOfflineDbHandles(): void {
	for (const fn of resetFns) {
		try {
			fn();
		} catch {
			/* best-effort: a failed reset just means that module reopens lazily */
		}
	}
}

/** Delete every "<name>-sandbox" offline DB — wipes the sandbox's offline cache without touching the real ones. */
export async function deleteSandboxOfflineDbs(): Promise<void> {
	if (typeof indexedDB === "undefined") return;
	const bases = ["rt-tiles-v3", "rt-satellite", "rt-vectors", "rt-mapRegistry"];
	await Promise.all(
		bases.map(
			(b) =>
				new Promise<void>((resolve) => {
					const req = indexedDB.deleteDatabase(b + SANDBOX_SUFFIX);
					req.onsuccess = () => resolve();
					req.onerror = () => resolve();
					req.onblocked = () => resolve();
				}),
		),
	);
}
