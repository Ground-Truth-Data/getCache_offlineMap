export const SANDBOX_SUFFIX = "-sandbox";

/** A world token must be safe inside an IndexedDB name and a localStorage key. */
const WORLD_TOKEN = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/** The world off `?sandbox=`: "1" the practice sandbox, any other token a NAMED world, null the real app. */
export function sandboxWorld(search?: string): string | null {
	const s =
		search ?? (typeof location === "undefined" ? "" : location.search);
	const v = new URLSearchParams(s).get("sandbox");
	if (v === null || v === "" || v === "0") return null;
	return WORLD_TOKEN.test(v) ? v : null;
}

/** `-sandbox` for the practice sandbox, `-sandbox-<name>` for a named world. */
export function worldSuffix(world: string): string {
	// A junk token here names a junk database on the origin for good.
	if (typeof world !== "string" || !WORLD_TOKEN.test(world)) {
		throw new Error(`[sandboxDbNames] not a world token: ${String(world)}`);
	}
	return world === "1" ? SANDBOX_SUFFIX : `${SANDBOX_SUFFIX}-${world}`;
}

/** Suffix for a localStorage key that must not cross worlds; "" in the real app. Read from the URL, not the storage flag, so a module-scope seed sees it. */
export function worldStorageSuffix(): string {
	const w = sandboxWorld();
	return w ? worldSuffix(w) : "";
}

// The world is a property of the page load, so it is named at module scope, never from a store's boot that a page might skip
const bornSuffix = worldStorageSuffix();
publishWorldSuffix(bornSuffix);

/** Published on window for the blob layer across the open-core wall, which cannot import this. */
function publishWorldSuffix(suffix: string): void {
	if (typeof window === "undefined") return;
	(window as { __rt_world_suffix?: string }).__rt_world_suffix = suffix;
}

let sandboxActive = bornSuffix !== "";
let activeSuffix = bornSuffix;

/** A caller that knows better than the URL; nothing has to call this for storage to be correct. */
export function setSandboxStorageActive(active: boolean, world = "1"): void {
	sandboxActive = active;
	activeSuffix = active ? worldSuffix(world) : "";
	publishWorldSuffix(activeSuffix);
}

export function isSandboxStorageActive(): boolean {
	return sandboxActive;
}

export function currentDbName(realName: string): string {
	return realName + activeSuffix;
}

const resetFns = new Set<() => void>();

/** Registers a fn that clears a module's cached open-DB handle. */
export function registerOfflineDbReset(fn: () => void): void {
	resetFns.add(fn);
}

/** Separate from `resetOfflineDbHandles`: a wipe needs reads to REFUSE reopening or `deleteDatabase` blocks. */
interface WipeLatch {
	latch: () => void;
	/** ONLY when the wipe did not happen. */
	unlatch: () => void;
}

const wipeLatchFns = new Set<WipeLatch>();

export function registerWipeLatch(l: WipeLatch): void {
	wipeLatchFns.add(l);
}

/** Latch every registered reader OFF before deleting; reads become misses. */
export function latchOfflineReadsForWipe(): void {
	for (const l of wipeLatchFns) {
		try {
			l.latch();
		} catch {
			/* codestyle-allow-swallow: a failed latch only means that delete may block */
		}
	}
}

/** Never after a successful wipe: a latched read returns null silently forever. */
export function unlatchOfflineReadsAfterFailedWipe(): void {
	for (const l of wipeLatchFns) {
		try {
			l.unlatch();
		} catch {
			/* codestyle-allow-swallow */
		}
	}
}

export function resetOfflineDbHandles(): void {
	for (const fn of resetFns) {
		try {
			fn();
		} catch {
			/* codestyle-allow-swallow: that module reopens lazily */
		}
	}
}
