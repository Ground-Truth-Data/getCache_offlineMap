const store = new Map<string, string>();
globalThis.sessionStorage ??= {
	getItem: (k) => store.get(k) ?? null,
	setItem: (k, v) => void store.set(k, String(v)),
	removeItem: (k) => void store.delete(k),
	clear: () => store.clear(),
} as Storage;
