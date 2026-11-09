import { vi } from "vitest";

// vi.waitFor polls every 50 ms, so work that settles in 2 ms sleeps 48. Every getCache and offline test loads this file.
const waitFor = vi.waitFor;
vi.waitFor = ((check, opts) => waitFor(check, { interval: 1, ...(typeof opts === "number" ? { timeout: opts } : opts) })) as typeof vi.waitFor;

const store = new Map<string, string>();
globalThis.sessionStorage ??= {
	getItem: (k) => store.get(k) ?? null,
	setItem: (k, v) => void store.set(k, String(v)),
	removeItem: (k) => void store.delete(k),
	clear: () => store.clear(),
} as Storage;
