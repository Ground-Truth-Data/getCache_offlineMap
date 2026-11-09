import { describe, expect, it, vi } from "vitest";

// freshGuard re-imports so module-level breaker state resets — the breaker is intentionally one-shot per module instance.
async function freshGuard() {
	vi.resetModules();
	return await import("./downloadGuard");
}

describe("downloadGuard circuit breaker", () => {
	it("lets a normal satellite bake grid through", async () => {
		const g = await freshGuard();
		expect(() => g.guardBakeGrid(60, { center: [0, 0] })).not.toThrow();
	});

	it("refuses an absurd single-bake grid (huge area)", async () => {
		const g = await freshGuard();
		expect(() => g.guardBakeGrid(5000, { center: [0, 0] })).toThrow(
			g.DownloadBudgetError,
		);
	});

	it("a refused bake blocks nothing after it: the next bake and pack still go", async () => {
		const g = await freshGuard();
		expect(() => g.guardBakeGrid(5000, { center: [0, 0] })).toThrow();
		expect(() => g.guardBakeGrid(520, {})).not.toThrow();
		expect(() => g.guardPackDownload({})).not.toThrow();
	});

	it("a tripped pack cap never blocks a photo bake the planter asked for", async () => {
		const g = await freshGuard();
		expect(() => {
			for (let i = 0; i < 100_000; i++) g.guardPackDownload({});
		}).toThrow(g.DownloadBudgetError);
		expect(() => g.guardBakeGrid(520, {})).not.toThrow();
	});

	it("TRIPS on too many pack downloads in one hour", async () => {
		const g = await freshGuard();
		// ⛔ READ THE CAP FROM THE SOURCE, NEVER HARD-CODE IT — a hard-coded assertion silently stopped testing anything when the constant changed twice under it.
		const { readFileSync } = await import("node:fs");
		const { fileURLToPath } = await import("node:url");
		const src = readFileSync(
			fileURLToPath(new URL("./downloadGuard.ts", import.meta.url)),
			"utf8",
		);
		const cap = Number(/const HOURLY_PACK_CAP = (\d+);/.exec(src)?.[1]);
		expect(Number.isFinite(cap)).toBe(true);

		let count = 0;
		let threw = false;
		try {
			for (let i = 0; i < cap + 10; i++) {
				g.guardPackDownload({ lng: 0, lat: 0 });
				count++;
			}
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);
		expect(count).toBeLessThanOrEqual(cap);
	});
});

// ⚠️ A tripped pack breaker is TERMINAL, never retryable — callers must stop, not retry (a caught-and-retried throw once flooded the console with retained errors).
describe("downloadGuard — a tripped pack breaker is TERMINAL, never retryable", () => {
	const tripPacks = (g: Awaited<ReturnType<typeof freshGuard>>) => {
		try {
			for (let i = 0; i < 100_000; i++) g.guardPackDownload({});
		} catch {
			// tripped
		}
	};

	it("stays tripped forever once tripped (retrying can never succeed)", async () => {
		const g = await freshGuard();
		tripPacks(g);
		for (let pass = 0; pass < 50; pass++) {
			expect(() => g.guardPackDownload({ center: [0, 0] })).toThrow(
				g.DownloadBudgetError,
			);
		}
	});

	it("logs ONCE no matter how many retries hammer it", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const g = await freshGuard();
		tripPacks(g);
		const afterTrip = error.mock.calls.length;
		for (let pass = 0; pass < 50; pass++) {
			try {
				g.guardPackDownload({});
			} catch {
				// expected — the breaker is latched
			}
		}
		expect(error.mock.calls.length).toBe(afterTrip);
		error.mockRestore();
	});

	it("an absurd bake retried every pass logs once, not once per retry", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const g = await freshGuard();
		for (let pass = 0; pass < 50; pass++) expect(() => g.guardBakeGrid(5000, { key: "k" })).toThrow();
		expect(error.mock.calls.length).toBe(1);
		error.mockRestore();
	});
});
