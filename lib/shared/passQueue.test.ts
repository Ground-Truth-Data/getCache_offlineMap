// `if (running) return running` DISCARDS a mid-flight ask: the running pass
// never sees its keys. Single-flight is right; it needs a queue behind it.

import { describe, expect, it, vi } from "vitest";

import { passQueue } from "./passQueue";

/** A pass we can hold open, so a second ask lands mid-flight — the real race. */
function heldPass() {
	const seen: string[][] = [];
	let release!: () => void;
	const held = new Promise<void>((r) => {
		release = r;
	});
	const run = async (keys: readonly string[]): Promise<number> => {
		seen.push([...keys]);
		await held;
		return keys.length;
	};
	return { seen, release, run };
}

describe("passQueue — a second ask is never dropped", () => {
	it("⛔ THE TRACTOR BUG: a centre asked for mid-pass still gets its turn", async () => {
		const { seen, release, run } = heldPass();
		const ask = passQueue(run);

		const skate = ask(["skate"]);
		const tractor = ask(["tractor"]);
		release();
		await Promise.all([skate, tractor]);

		expect(seen.flat()).toContain("tractor");
	});

	it("never runs two passes at once — the endpoint sees one caller", async () => {
		let live = 0;
		let peak = 0;
		const ask = passQueue(async (keys) => {
			live++;
			peak = Math.max(peak, live);
			await Promise.resolve();
			live--;
			return keys.length;
		});

		await Promise.all([ask(["a"]), ask(["b"]), ask(["c"])]);
		expect(peak).toBe(1);
	});

	it("coalesces the waiting asks into ONE follow-up pass, deduped", async () => {
		const { seen, release, run } = heldPass();
		const ask = passQueue(run);

		const first = ask(["a"]);
		const b = ask(["b"]);
		const c = ask(["c"]);
		// Already waiting — one turn, not two.
		const bAgain = ask(["b"]);
		release();
		await Promise.all([first, b, c, bAgain]);

		expect(seen).toHaveLength(2);
		expect([...seen[1]].sort()).toEqual(["b", "c"]);
	});

	it("a throwing pass does not wedge the queue — the next ask still runs", async () => {
		let calls = 0;
		const ask = passQueue(async (keys) => {
			calls++;
			if (calls === 1) throw new Error("feed down");
			return keys.length;
		});

		await expect(ask(["a"])).rejects.toThrow("feed down");
		await expect(ask(["b"])).resolves.toBe(1);
		expect(calls).toBe(2);
	});

	it("an empty ask is not a pass — nothing is called", async () => {
		const run = vi.fn(async (keys: readonly string[]) => keys.length);
		const ask = passQueue(run);
		expect(await ask([])).toBe(0);
		expect(run).not.toHaveBeenCalled();
	});

	// The queue, not a caller, starts a drained pass, so nobody is positioned
	// to catch its rejection.
	it("a drained follow-up pass that fails does not become an unhandled rejection", async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (e: PromiseRejectionEvent) => {
			e.preventDefault();
			unhandled.push(e.reason);
		};
		globalThis.addEventListener?.("unhandledrejection", onUnhandled);

		let calls = 0;
		const { release, run } = heldPass();
		const ask = passQueue(async (keys) => {
			calls++;
			// Hold pass 1 open so the DRAINED pass 2 is the one that fails.
			if (calls === 1) return run(keys);
			throw new Error("feed down");
		});

		const first = ask(["a"]);
		const second = ask(["b"]);
		release();
		await first;
		await second.catch(() => {});
		// Let the drain's rejection reach the microtask queue and the handler.
		await new Promise((r) => setTimeout(r, 10));

		globalThis.removeEventListener?.("unhandledrejection", onUnhandled);
		expect(unhandled).toEqual([]);
	});
});
