import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
});

describe("worker tiers", () => {
	it("offers exactly worker-cloud-prod and worker-cloud-dev — worker-local-dev is gone from the switch", async () => {
		const m = await import("./worker-local-dev/tilesHost");
		m.configureTilesHost("https://prod.example.test");
		m.configureTilesDevHost("https://dev.example.test");

		m.setWorkerTarget("worker-cloud-prod");
		expect(m.tilesHost()).toBe("https://prod.example.test");

		m.setWorkerTarget("worker-cloud-dev");
		expect(m.tilesHost()).toBe("https://dev.example.test");
	});

	it("worker-cloud-dev is null until an app configures it — never a silent fallback to prod", async () => {
		const m = await import("./worker-local-dev/tilesHost");
		m.configureTilesHost("https://prod.example.test");
		m.setWorkerTarget("worker-cloud-dev");
		expect(m.tilesHost()).toBeNull();
		expect(m.packUrl()).toBeNull();
	});

	it("defaults to worker-cloud-dev in a dev build — a shipped phone is locked to production by the !DEV early return, not by this constant", async () => {
		const m = await import("./worker-local-dev/tilesHost");
		expect(m.DEFAULT_TARGET).toBe("worker-cloud-dev");
	});

	it("only a human click moves the target — the machine-fallback mode is gone", async () => {
		const store = new Map<string, string>();
		vi.stubGlobal("sessionStorage", {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
		});
		const m = await import("./worker-local-dev/tilesHost");
		expect(m.getWorkerTarget()).toBe(m.DEFAULT_TARGET);
		// No second parameter: a machine fallback would auto-select production.
		expect(m.setWorkerTarget.length).toBe(1);
		m.setWorkerTarget("worker-cloud-dev");
		expect(store.get("rt_worker_target")).toBe("worker-cloud-dev");
		expect(m.getWorkerTarget()).toBe("worker-cloud-dev");
		vi.unstubAllGlobals();
	});

	it("keeps every worker copy identical on the tier surface", async () => {
		const [a, b, c] = await Promise.all([
			import("./worker-local-dev/tilesHost"),
			import("./worker-cloud-dev/tilesHost"),
			import("./worker-cloud-prod/tilesHost"),
		]);
		expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
		expect(Object.keys(a).sort()).toEqual(Object.keys(c).sort());
	});
});
