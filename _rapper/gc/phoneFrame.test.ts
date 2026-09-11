/**
 * A PAGE WITH NO PHONE STILL GETS AN ANSWER.
 *
 * The watcher reports `null` for "there is no frame here", and a caller holds
 * `undefined` for "I have not been told yet". Those were briefly the same value
 * INSIDE the watcher, so on a frameless page the first look was mistaken for
 * "nothing changed" and nothing was ever reported — SideCard stayed
 * `--unplaced`, which is `visibility: hidden`, and every card on every
 * frameless page vanished instead of centring.
 *
 * rapper's runner has no DOM, so the document is stubbed to exactly the three
 * things the watcher touches. That keeps the test on the logic that broke —
 * whether the first look reports — rather than on jsdom's layout.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const stubDom = (frame: unknown) => {
	const prev = globalThis.document;
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { querySelector: () => frame, body: {} },
	});
	Object.defineProperty(globalThis, "MutationObserver", {
		configurable: true,
		value: class {
			observe() {}
			disconnect() {}
		},
	});
	return () => Object.defineProperty(globalThis, "document", { configurable: true, value: prev });
};

afterEach(() => vi.resetModules());

describe("watchPhoneFrame", () => {
	it("reports null on a page that never had a frame", async () => {
		const restore = stubDom(null);
		const { watchPhoneFrame } = await import("./phoneFrame.svelte");
		const onChange = vi.fn();
		const stop = watchPhoneFrame(onChange);
		expect(onChange).toHaveBeenCalledWith(null);
		stop();
		restore();
	});
});
