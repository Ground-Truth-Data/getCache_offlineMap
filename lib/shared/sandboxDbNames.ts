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
// Published for the blob layer across the open-core wall, which cannot import this.
if (typeof window !== "undefined") {
	(window as { __rt_world_suffix?: string }).__rt_world_suffix = bornSuffix;
}

export function isSandboxStorageActive(): boolean {
	return bornSuffix !== "";
}

export function currentDbName(realName: string): string {
	return realName + bornSuffix;
}
